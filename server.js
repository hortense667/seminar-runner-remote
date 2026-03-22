import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import QRCode from "qrcode";
import { readFile, writeFile, mkdir } from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, "data", "state.json");

/**
 * QR生成API
 * GET /api/qr?text=<url>
 * => { dataUrl: "data:image/png;base64,..." }
 */
app.get("/api/qr", async (req, res) => {
  try {
    const text = String(req.query.text || "");
    if (!text) return res.status(400).json({ error: "missing text" });

    const dataUrl = await QRCode.toDataURL(text, { margin: 1, width: 280 });
    res.json({ dataUrl });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * Users guide (markdown) for in-app help
 * GET /api/users_guide
 */
app.get("/api/users_guide", async (req, res) => {
  try {
    const p = path.join(__dirname, "USERS_GUIDE.MD");
    const txt = await readFile(p, "utf-8");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(txt);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * Export all rooms' student programs (for teacher bulk download)
 * GET /api/export_all_rooms
 */
app.get("/api/export_all_rooms", (req, res) => {
  try {
    const all = [];
    for (const [roomId, room] of rooms.entries()) {
      const students = [...room.students.entries()].map(([clientId, s]) => ({
        clientId,
        name: s.name || "",
        programName: s.programName || "",
        code: s.code || "",
        lastSeen: s.lastSeen || 0
      }));
      all.push({ room: roomId, students });
    }
    res.json({ rooms: all });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/**
 * rooms = Map(roomId -> {
 *   students: Map(clientId -> { name, programName?: string, code, logs: string[], memo?: string, url1?: string, url2?: string, lastSeen }),
 *   teachers: Set(ws),
 *   sockets: Set(ws),
 *   studentSockets: Map(clientId -> Set(ws)),
 *   resources: Array<{ title: string, url: string }>,
 *   teacherMessage: string,
 *   nameLock: boolean,
 *   seatPlan: { count: number, seats: Array<{ clientId: string|null, memo: string, url1: string, url2: string }> }
 * })
 */
const rooms = new Map();

function normalizeSeatCount(input) {
  const n = Math.floor(Number(input));
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 200) return 200;
  return n;
}

function ensureSeatPlan(room, nextCount = null) {
  if (!room.seatPlan) room.seatPlan = { count: 20, seats: [] };
  if (!Array.isArray(room.seatPlan.seats)) room.seatPlan.seats = [];
  const count = normalizeSeatCount(nextCount == null ? room.seatPlan.count : nextCount);
  room.seatPlan.count = count;
  while (room.seatPlan.seats.length < count) {
    room.seatPlan.seats.push({ clientId: null, memo: "", url1: "", url2: "" });
  }
  room.seatPlan.seats.length = count;
  for (let i = 0; i < room.seatPlan.seats.length; i++) {
    const s = room.seatPlan.seats[i] || {};
    room.seatPlan.seats[i] = {
      clientId: s.clientId ? String(s.clientId) : null,
      memo: String(s.memo || "").slice(0, 1000),
      url1: String(s.url1 || "").trim().slice(0, 2000),
      url2: String(s.url2 || "").trim().slice(0, 2000)
    };
  }
}

function buildSeatPlanState(room) {
  ensureSeatPlan(room);
  return {
    type: "seat_plan_state",
    count: room.seatPlan.count,
    seats: room.seatPlan.seats.map(s => ({
      clientId: s.clientId || null,
      memo: s.memo || "",
      url1: s.url1 || "",
      url2: s.url2 || ""
    }))
  };
}

function findSeatIndexByClientId(room, clientId) {
  ensureSeatPlan(room);
  return room.seatPlan.seats.findIndex(s => s.clientId === clientId);
}

function assignSeatForClient(room, clientId) {
  ensureSeatPlan(room);
  let idx = findSeatIndexByClientId(room, clientId);
  if (idx >= 0) return idx;
  idx = room.seatPlan.seats.findIndex(s => !s.clientId);
  if (idx < 0) {
    ensureSeatPlan(room, room.seatPlan.count + 1);
    idx = room.seatPlan.seats.length - 1;
  }
  room.seatPlan.seats[idx].clientId = clientId;
  return idx;
}

/** Drop seat clientIds that have no matching room.students entry (TTL ghosts, clear_room, bad persist). Clears memo/urls for that seat — no live student, so notes/links are stale. */
function pruneOrphanSeatClients(room) {
  ensureSeatPlan(room);
  let touched = false;
  for (const seat of room.seatPlan.seats) {
    const cid = seat.clientId;
    if (!cid) continue;
    if (!room.students.has(cid)) {
      seat.clientId = null;
      seat.memo = "";
      seat.url1 = "";
      seat.url2 = "";
      touched = true;
    }
  }
  return touched;
}

/** Teacher "受講者一覧リセット": every seat empty (no clientId, no memo/urls). Seat count unchanged. */
function wipeSeatPlanAssignments(room) {
  ensureSeatPlan(room);
  for (const seat of room.seatPlan.seats) {
    seat.clientId = null;
    seat.memo = "";
    seat.url1 = "";
    seat.url2 = "";
  }
}

// Remove inactive students automatically (ms)
const STUDENT_TTL_MS = Number(process.env.STUDENT_TTL_MS || 1000 * 60 * 60 * 24 * 30); // default 30 days (~1 month)
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS || 1000 * 60); // default 60s

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { students: new Map(), teachers: new Set(), sockets: new Set(), studentSockets: new Map(), resources: [], teacherMessage: "", nameLock: false, seatPlan: { count: 20, seats: [] } });
  }
  const room = rooms.get(roomId);
  ensureSeatPlan(room);
  return room;
}

function normalizeTeacherMessage(input) {
  let s = String(input ?? "");
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // keep it single-line for header display
  s = s.replace(/\n+/g, " ").trim();
  if (s.length > 200) s = s.slice(0, 200);
  return s;
}

function normalizeResources(input) {
  const arr = Array.isArray(input) ? input : [];
  const out = [];
  for (const it of arr.slice(0, 50)) {
    const title = String(it?.title || "").trim().slice(0, 80);
    const url = String(it?.url || "").trim().slice(0, 2000);
    if (!title || !url) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({ title, url });
  }
  return out;
}

function normalizeName(input, fallback = "Student") {
  let s = String(input || "").trim();
  if (!s) s = fallback;
  if (s.length > 40) s = s.slice(0, 40);
  return s;
}

function ensureUniqueName(room, desiredName, clientId) {
  const exists = (name) => {
    for (const [id, s] of room.students.entries()) {
      if (id === clientId) continue;
      if (s?.name === name) return true;
    }
    return false;
  };
  let base = desiredName || "Student";
  if (!exists(base)) return base;
  let i = 2;
  while (i < 1000) {
    const suffix = ` ${i}`;
    let candidate = base;
    if (candidate.length + suffix.length > 40) {
      candidate = candidate.slice(0, Math.max(1, 40 - suffix.length));
    }
    candidate = `${candidate}${suffix}`;
    if (!exists(candidate)) return candidate;
    i += 1;
  }
  return `${base.slice(0, 30)}_${Date.now()}`;
}

function buildStudentsSnapshot(room) {
  return [...room.students.entries()].map(([id, s]) => ({
    clientId: id,
    name: s.name,
    programName: s.programName || "",
    code: s.code || "",
    logs: s.logs || [],
    memo: s.memo || "",
    url1: s.url1 || "",
    url2: s.url2 || "",
    signal: s.signal || "",
    lastSeen: s.lastSeen || Date.now()
  }));
}

function broadcastToTeachers(roomId, msgObj) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(msgObj);
  for (const ws of room.teachers) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function broadcastToRoom(roomId, msgObj) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(msgObj);
  for (const ws of room.sockets) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function broadcastSeatPlanToTeachers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  broadcastToTeachers(roomId, buildSeatPlanState(room));
}

function sendToStudent(roomId, clientId, msgObj) {
  const room = rooms.get(roomId);
  if (!room) return;
  const set = room.studentSockets?.get(clientId);
  if (!set || !set.size) return;
  const data = JSON.stringify(msgObj);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function broadcastSnapshotToTeachers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  broadcastToTeachers(roomId, { type: "snapshot", room: roomId, students: buildStudentsSnapshot(room) });
}

let persistTimer = null;
let persistInFlight = false;
let persistRequestedAgain = false;

function serializeRooms() {
  const out = {};
  for (const [roomId, room] of rooms.entries()) {
    ensureSeatPlan(room);
    out[roomId] = {
      students: [...room.students.entries()].map(([clientId, s]) => ({
        clientId,
        name: s.name || "",
        programName: s.programName || "",
        code: s.code || "",
        logs: s.logs || [],
        memo: s.memo || "",
        url1: s.url1 || "",
        url2: s.url2 || "",
        signal: s.signal || "",
        lastSeen: s.lastSeen || Date.now()
      })),
      resources: room.resources || [],
      teacherMessage: room.teacherMessage || "",
      nameLock: !!room.nameLock,
      seatPlan: {
        count: room.seatPlan.count,
        seats: room.seatPlan.seats.map(s => ({
          clientId: s.clientId || null,
          memo: s.memo || "",
          url1: s.url1 || "",
          url2: s.url2 || ""
        }))
      }
    };
  }
  return { version: 1, rooms: out };
}

function hydrateRooms(payload) {
  const allRooms = payload?.rooms || {};
  let prunedAnySeat = false;
  for (const [roomId, raw] of Object.entries(allRooms)) {
    const room = getRoom(roomId);
    room.students.clear();
    for (const st of (raw.students || [])) {
      const cid = String(st?.clientId || "").trim();
      if (!cid) continue;
      room.students.set(cid, {
        name: normalizeName(st?.name, "Student"),
        programName: String(st?.programName || ""),
        code: String(st?.code || ""),
        logs: Array.isArray(st?.logs) ? st.logs.map(x => String(x || "")).slice(-400) : [],
        memo: String(st?.memo || "").slice(0, 1000),
        url1: String(st?.url1 || "").trim().slice(0, 2000),
        url2: String(st?.url2 || "").trim().slice(0, 2000),
        signal: (st?.signal === "done" || st?.signal === "question") ? st.signal : "",
        lastSeen: Number(st?.lastSeen || Date.now())
      });
    }
    room.resources = normalizeResources(raw.resources);
    room.teacherMessage = normalizeTeacherMessage(raw.teacherMessage);
    room.nameLock = !!raw.nameLock;
    room.seatPlan = {
      count: normalizeSeatCount(raw?.seatPlan?.count || 20),
      seats: Array.isArray(raw?.seatPlan?.seats) ? raw.seatPlan.seats : []
    };
    ensureSeatPlan(room);
    if (pruneOrphanSeatClients(room)) prunedAnySeat = true;
  }
  if (prunedAnySeat) schedulePersistState();
}

async function persistStateNow() {
  if (persistInFlight) {
    persistRequestedAgain = true;
    return;
  }
  persistInFlight = true;
  try {
    await mkdir(path.dirname(STATE_FILE), { recursive: true });
    const json = JSON.stringify(serializeRooms());
    await writeFile(STATE_FILE, json, "utf-8");
  } catch (e) {
    console.error("[persist] failed:", String(e?.message || e));
  } finally {
    persistInFlight = false;
    if (persistRequestedAgain) {
      persistRequestedAgain = false;
      await persistStateNow();
    }
  }
}

function schedulePersistState() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistStateNow();
  }, 250);
}

async function loadPersistedState() {
  try {
    const text = await readFile(STATE_FILE, "utf-8");
    const data = JSON.parse(text);
    hydrateRooms(data);
    console.log(`[persist] loaded: ${STATE_FILE}`);
  } catch (e) {
    if (String(e?.code || "") !== "ENOENT") {
      console.error("[persist] load failed:", String(e?.message || e));
    }
  }
}

// Periodic cleanup for inactive students; also prune ghost seat clientIds
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    let changed = false;
    for (const [clientId, s] of room.students.entries()) {
      const last = Number(s?.lastSeen || 0);
      if (last && now - last > STUDENT_TTL_MS) {
        room.students.delete(clientId);
        changed = true;
      }
    }
    const pruned = pruneOrphanSeatClients(room);
    if (changed || pruned) {
      broadcastSnapshotToTeachers(roomId);
      if (pruned) broadcastSeatPlanToTeachers(roomId);
      schedulePersistState();
    }
  }
}, CLEANUP_INTERVAL_MS).unref?.();

wss.on("connection", (ws) => {
  ws.roomId = null;
  ws.role = null;
  ws.clientId = null;

  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString("utf-8"));
    } catch {
      return;
    }

    if (msg.type === "join") {
      const roomId = String(msg.room || "").trim() || "default";
      const role = msg.role === "teacher" ? "teacher" : "student";
      const clientId = String(msg.clientId || "").trim() || null;
      const name = normalizeName(msg.name, role === "teacher" ? "Teacher" : "Student");

      ws.roomId = roomId;
      ws.role = role;
      ws.clientId = clientId;

      const room = getRoom(roomId);

      if (role === "teacher") {
        room.sockets.add(ws);
        room.teachers.add(ws);
        const students = buildStudentsSnapshot(room);
        ws.send(JSON.stringify({ type: "snapshot", room: roomId, students }));
        ws.send(JSON.stringify({ type: "room_state", room: roomId, nameLock: !!room.nameLock }));
        ws.send(JSON.stringify({ type: "resources_state", room: roomId, resources: room.resources || [] }));
        ws.send(JSON.stringify({ type: "teacher_message_state", room: roomId, message: room.teacherMessage || "" }));
        ws.send(JSON.stringify(buildSeatPlanState(room)));
      } else {
        if (!clientId) return;
        room.sockets.add(ws);
        if (!room.studentSockets.has(clientId)) room.studentSockets.set(clientId, new Set());
        room.studentSockets.get(clientId).add(ws);
        const prev = room.students.get(clientId);
        const seatIndex = assignSeatForClient(room, clientId);
        const seat = room.seatPlan.seats[seatIndex] || { memo: "", url1: "", url2: "" };
        const assigned = ensureUniqueName(room, name, clientId);
        if (assigned !== name) {
          try { ws.send(JSON.stringify({ type: "name_assigned", name: assigned })); } catch {}
        }
        room.students.set(clientId, {
          name: assigned,
          programName: prev?.programName || "",
          code: prev?.code || "",
          logs: prev?.logs || [],
          memo: prev?.memo || seat.memo || "",
          url1: prev?.url1 || seat.url1 || "",
          url2: prev?.url2 || seat.url2 || "",
          signal: prev?.signal || "",
          lastSeen: Date.now()
        });
        const merged = room.students.get(clientId);
        room.seatPlan.seats[seatIndex] = {
          clientId,
          memo: merged.memo || seat.memo || "",
          url1: merged.url1 || seat.url1 || "",
          url2: merged.url2 || seat.url2 || ""
        };
        broadcastToTeachers(roomId, {
          type: "student_joined",
          clientId,
          name: assigned,
          url1: merged.url1 || "",
          url2: merged.url2 || "",
          seatIndex,
          lastSeen: Date.now()
        });
        broadcastSeatPlanToTeachers(roomId);
        ws.send(JSON.stringify({ type: "room_state", room: roomId, nameLock: !!room.nameLock }));
        ws.send(JSON.stringify({ type: "resources_state", room: roomId, resources: room.resources || [] }));
        ws.send(JSON.stringify({ type: "teacher_message_state", room: roomId, message: room.teacherMessage || "" }));
        ws.send(JSON.stringify({ type: "url_update", url1: merged.url1 || "", url2: merged.url2 || "" }));
      }
      schedulePersistState();
      return;
    }

    if (!ws.roomId) return;
    const room = getRoom(ws.roomId);

    if (msg.type === "clear_room" && ws.role === "teacher") {
      room.students.clear();
      // optionally also unlock name changes on clear
      room.nameLock = false;
      wipeSeatPlanAssignments(room);
      broadcastToRoom(ws.roomId, { type: "room_state", room: ws.roomId, nameLock: !!room.nameLock });
      broadcastSnapshotToTeachers(ws.roomId);
      broadcastSeatPlanToTeachers(ws.roomId);
      schedulePersistState();
      return;
    }

    if (msg.type === "set_name_lock" && ws.role === "teacher") {
      room.nameLock = !!msg.locked;
      broadcastToRoom(ws.roomId, { type: "room_state", room: ws.roomId, nameLock: !!room.nameLock });
      schedulePersistState();
      return;
    }

    if (msg.type === "resources_update" && ws.role === "teacher") {
      room.resources = normalizeResources(msg.resources);
      broadcastToRoom(ws.roomId, { type: "resources_state", room: ws.roomId, resources: room.resources || [] });
      schedulePersistState();
      return;
    }

    if (msg.type === "teacher_message_update" && ws.role === "teacher") {
      room.teacherMessage = normalizeTeacherMessage(msg.message);
      broadcastToRoom(ws.roomId, { type: "teacher_message_state", room: ws.roomId, message: room.teacherMessage || "" });
      schedulePersistState();
      return;
    }

    if (msg.type === "seat_plan_update" && ws.role === "teacher") {
      if (msg.count !== undefined) ensureSeatPlan(room, msg.count);
      const idx = Number(msg.seatIndex);
      if (Number.isInteger(idx) && idx >= 0) {
        ensureSeatPlan(room);
        if (idx >= room.seatPlan.count) ensureSeatPlan(room, idx + 1);
        const seat = room.seatPlan.seats[idx] || { clientId: null, memo: "", url1: "", url2: "" };
        if (msg.memo !== undefined) seat.memo = String(msg.memo || "").slice(0, 1000);
        if (msg.url1 !== undefined) seat.url1 = String(msg.url1 || "").trim().slice(0, 2000);
        if (msg.url2 !== undefined) seat.url2 = String(msg.url2 || "").trim().slice(0, 2000);
        room.seatPlan.seats[idx] = seat;

        if (seat.clientId) {
          const s = room.students.get(seat.clientId);
          if (s) {
            if (msg.memo !== undefined) s.memo = seat.memo || "";
            if (msg.url1 !== undefined) s.url1 = seat.url1 || "";
            if (msg.url2 !== undefined) s.url2 = seat.url2 || "";
            s.lastSeen = Date.now();
            room.students.set(seat.clientId, s);
            if (msg.memo !== undefined) {
              broadcastToTeachers(ws.roomId, { type: "memo_update", clientId: seat.clientId, memo: s.memo || "" });
            }
            if (msg.url1 !== undefined || msg.url2 !== undefined) {
              broadcastToTeachers(ws.roomId, {
                type: "url_update",
                clientId: seat.clientId,
                url1: s.url1 || "",
                url2: s.url2 || "",
                lastSeen: s.lastSeen
              });
              sendToStudent(ws.roomId, seat.clientId, { type: "url_update", url1: s.url1 || "", url2: s.url2 || "" });
            }
          }
        }
      }
      broadcastSeatPlanToTeachers(ws.roomId);
      schedulePersistState();
      return;
    }

    if (msg.type === "memo_update" && ws.role === "teacher") {
      const clientId = String(msg.clientId || "").trim();
      if (!clientId) return;
      const s = room.students.get(clientId);
      if (!s) return;

      let memo = String(msg.memo || "");
      if (memo.length > 1000) memo = memo.slice(0, 1000);
      s.memo = memo;
      room.students.set(clientId, s);
      const seatIdx = findSeatIndexByClientId(room, clientId);
      if (seatIdx >= 0) room.seatPlan.seats[seatIdx].memo = memo;

      broadcastToTeachers(ws.roomId, { type: "memo_update", clientId, memo });
      schedulePersistState();
      return;
    }

    if (msg.type === "force_code" && ws.role === "teacher") {
      const clientId = String(msg.clientId || "").trim();
      if (!clientId) {
        try { ws.send(JSON.stringify({ type: "force_code_result", ok: false, reason: "missing_clientId" })); } catch {}
        return;
      }
      const s = room.students.get(clientId);
      if (!s) {
        try { ws.send(JSON.stringify({ type: "force_code_result", ok: false, clientId, reason: "student_not_found" })); } catch {}
        return;
      }

      let code = String(msg.code || "");
      if (code.length > 200_000) code = code.slice(0, 200_000); // safety limit
      s.code = code;
      s.lastSeen = Date.now();
      room.students.set(clientId, s);

      // update teacher views
      broadcastToTeachers(ws.roomId, {
        type: "code_update",
        clientId,
        name: s.name,
        code: s.code,
        lastSeen: s.lastSeen
      });

      // push to student's UI (no auto-run)
      sendToStudent(ws.roomId, clientId, { type: "force_code", code: s.code });
      try { ws.send(JSON.stringify({ type: "force_code_result", ok: true, clientId, lastSeen: s.lastSeen })); } catch {}
      schedulePersistState();
      return;
    }

    if (msg.type === "url_update") {
      const url1 = String(msg.url1 || "").trim().slice(0, 2000);
      const url2 = String(msg.url2 || "").trim().slice(0, 2000);

      if (ws.role === "teacher") {
        const clientId = String(msg.clientId || "").trim();
        if (!clientId) return;
        const s = room.students.get(clientId);
        if (!s) return;
        s.url1 = url1;
        s.url2 = url2;
        s.lastSeen = Date.now();
        room.students.set(clientId, s);
        const seatIdx = findSeatIndexByClientId(room, clientId);
        if (seatIdx >= 0) {
          room.seatPlan.seats[seatIdx].url1 = s.url1 || "";
          room.seatPlan.seats[seatIdx].url2 = s.url2 || "";
        }
        broadcastToTeachers(ws.roomId, {
          type: "url_update",
          clientId,
          url1: s.url1 || "",
          url2: s.url2 || "",
          lastSeen: s.lastSeen
        });
        sendToStudent(ws.roomId, clientId, { type: "url_update", url1: s.url1 || "", url2: s.url2 || "" });
        schedulePersistState();
        return;
      }

      if (ws.role === "student") {
        const clientId = ws.clientId;
        if (!clientId) return;
        const s = room.students.get(clientId) || { name: "Student", code: "", logs: [], memo: "", lastSeen: Date.now() };
        s.url1 = url1;
        s.url2 = url2;
        s.lastSeen = Date.now();
        room.students.set(clientId, s);
        const seatIdx = assignSeatForClient(room, clientId);
        room.seatPlan.seats[seatIdx].url1 = s.url1 || "";
        room.seatPlan.seats[seatIdx].url2 = s.url2 || "";
        broadcastToTeachers(ws.roomId, {
          type: "url_update",
          clientId,
          url1: s.url1 || "",
          url2: s.url2 || "",
          lastSeen: s.lastSeen
        });
        broadcastSeatPlanToTeachers(ws.roomId);
        schedulePersistState();
        return;
      }
    }

    if (msg.type === "signal_update" && ws.role === "student") {
      const clientId = ws.clientId;
      if (!clientId) return;
      const s = room.students.get(clientId) || { name: "Student", code: "", logs: [], memo: "", url1: "", url2: "", signal: "", lastSeen: Date.now() };
      const next = String(msg.signal || "");
      const signal = (next === "done" || next === "question") ? next : "";
      s.signal = signal;
      s.lastSeen = Date.now();
      room.students.set(clientId, s);
      broadcastToTeachers(ws.roomId, {
        type: "signal_update",
        clientId,
        name: s.name,
        signal: s.signal,
        lastSeen: s.lastSeen
      });
      schedulePersistState();
      return;
    }

    if (msg.type === "name_update" && ws.role === "student") {
      const clientId = ws.clientId;
      if (!clientId) return;
      if (room.nameLock) {
        ws.send(JSON.stringify({ type: "name_update_rejected", reason: "locked" }));
        return;
      }
      const s = room.students.get(clientId) || { name: "Student", code: "", logs: [], url1: "", url2: "", lastSeen: Date.now() };
      const desired = normalizeName(msg.name, s.name || "Student");
      const assigned = ensureUniqueName(room, desired, clientId);
      if (assigned !== desired) {
        try { ws.send(JSON.stringify({ type: "name_assigned", name: assigned })); } catch {}
      }
      s.name = assigned;
      s.lastSeen = Date.now();
      room.students.set(clientId, s);
      broadcastToTeachers(ws.roomId, {
        type: "name_update",
        clientId,
        name: s.name,
        lastSeen: s.lastSeen
      });
      schedulePersistState();
      return;
    }

    if (msg.type === "program_update" && ws.role === "student") {
      const clientId = ws.clientId;
      if (!clientId) return;
      const s = room.students.get(clientId) || { name: "Student", code: "", logs: [], url1: "", url2: "", lastSeen: Date.now() };
      s.programName = String(msg.programName || "").trim();
      s.lastSeen = Date.now();
      room.students.set(clientId, s);
      broadcastToTeachers(ws.roomId, {
        type: "program_update",
        clientId,
        programName: s.programName,
        lastSeen: s.lastSeen
      });
      schedulePersistState();
      return;
    }

    if (msg.type === "code_update" && ws.role === "student") {
      const clientId = ws.clientId;
      if (!clientId) return;
      const s = room.students.get(clientId) || { name: "Student", code: "", logs: [], url1: "", url2: "", lastSeen: Date.now() };
      s.code = String(msg.code || "");
      if (msg.programName !== undefined) {
        s.programName = String(msg.programName || "").trim();
      }
      s.lastSeen = Date.now();
      room.students.set(clientId, s);

      broadcastToTeachers(ws.roomId, {
        type: "code_update",
        clientId,
        name: s.name,
        code: s.code,
        programName: s.programName || "",
        lastSeen: s.lastSeen
      });
      schedulePersistState();
      return;
    }

    if (msg.type === "log" && ws.role === "student") {
      const clientId = ws.clientId;
      if (!clientId) return;
      const s = room.students.get(clientId) || { name: "Student", code: "", logs: [], url1: "", url2: "", lastSeen: Date.now() };
      const line = String(msg.line || "");
      s.logs = (s.logs || []).slice(-400);
      s.logs.push(line);
      s.lastSeen = Date.now();
      room.students.set(clientId, s);

      broadcastToTeachers(ws.roomId, {
        type: "log",
        clientId,
        name: s.name,
        line,
        lastSeen: s.lastSeen
      });
      schedulePersistState();
      return;
    }

    if (msg.type === "clear_logs" && ws.role === "student") {
      const clientId = ws.clientId;
      if (!clientId) return;
      const s = room.students.get(clientId);
      if (s) {
        s.logs = [];
        s.lastSeen = Date.now();
        broadcastToTeachers(ws.roomId, { type: "clear_logs", clientId, lastSeen: s.lastSeen });
      }
      schedulePersistState();
      return;
    }
  });

  ws.on("close", () => {
    if (!ws.roomId) return;
    const room = rooms.get(ws.roomId);
    if (!room) return;

    if (ws.role === "teacher") {
      room.teachers.delete(ws);
    } else if (ws.role === "student" && ws.clientId) {
      const set = room.studentSockets?.get(ws.clientId);
      let hasOtherStudentSockets = false;
      if (set) {
        set.delete(ws);
        hasOtherStudentSockets = set.size > 0;
        if (!set.size) room.studentSockets.delete(ws.clientId);
      }
      // Notify "left" only when ALL tabs/windows for this clientId are closed.
      if (!hasOtherStudentSockets) {
        const s = room.students.get(ws.clientId);
        if (s) {
          s.lastSeen = Date.now();
          broadcastToTeachers(ws.roomId, {
            type: "student_left",
            clientId: ws.clientId,
            name: s.name,
            lastSeen: s.lastSeen
          });
        }
        schedulePersistState();
      }
    }
    room.sockets.delete(ws);
  });
});

const PORT = process.env.PORT || 8787;
await loadPersistedState();

server.listen(PORT, () => {
  console.log(`Seminar runner listening on http://localhost:${PORT}`);
  console.log(`Teacher view: http://localhost:${PORT}/?role=teacher&room=demo`);
  console.log(`QR page: http://localhost:${PORT}/qr.html?room=demo`);
});
