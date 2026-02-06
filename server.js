import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import QRCode from "qrcode";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "public")));

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

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/**
 * rooms = Map(roomId -> {
 *   students: Map(clientId -> { name, code, logs: string[], memo?: string, lastSeen }),
 *   teachers: Set(ws),
 *   sockets: Set(ws),
 *   nameLock: boolean
 * })
 */
const rooms = new Map();

// Remove inactive students automatically (ms)
const STUDENT_TTL_MS = Number(process.env.STUDENT_TTL_MS || 1000 * 60 * 60 * 6); // default 6 hours
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS || 1000 * 60); // default 60s

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { students: new Map(), teachers: new Set(), sockets: new Set(), nameLock: false });
  }
  return rooms.get(roomId);
}

function buildStudentsSnapshot(room) {
  return [...room.students.entries()].map(([id, s]) => ({
    clientId: id,
    name: s.name,
    code: s.code || "",
    logs: s.logs || [],
    memo: s.memo || "",
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

function broadcastSnapshotToTeachers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  broadcastToTeachers(roomId, { type: "snapshot", room: roomId, students: buildStudentsSnapshot(room) });
}

// Periodic cleanup for inactive students
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
    if (changed) broadcastSnapshotToTeachers(roomId);
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
      const name = String(msg.name || "").trim() || (role === "teacher" ? "Teacher" : "Student");

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
      } else {
        if (!clientId) return;
        room.sockets.add(ws);
        const prev = room.students.get(clientId);
        room.students.set(clientId, {
          name,
          code: prev?.code || "",
          logs: prev?.logs || [],
          memo: prev?.memo || "",
          lastSeen: Date.now()
        });
        broadcastToTeachers(roomId, {
          type: "student_joined",
          clientId,
          name,
          lastSeen: Date.now()
        });
        ws.send(JSON.stringify({ type: "room_state", room: roomId, nameLock: !!room.nameLock }));
      }
      return;
    }

    if (!ws.roomId) return;
    const room = getRoom(ws.roomId);

    if (msg.type === "clear_room" && ws.role === "teacher") {
      room.students.clear();
      // optionally also unlock name changes on clear
      room.nameLock = false;
      broadcastToRoom(ws.roomId, { type: "room_state", room: ws.roomId, nameLock: !!room.nameLock });
      broadcastSnapshotToTeachers(ws.roomId);
      return;
    }

    if (msg.type === "set_name_lock" && ws.role === "teacher") {
      room.nameLock = !!msg.locked;
      broadcastToRoom(ws.roomId, { type: "room_state", room: ws.roomId, nameLock: !!room.nameLock });
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

      broadcastToTeachers(ws.roomId, { type: "memo_update", clientId, memo });
      return;
    }

    if (msg.type === "name_update" && ws.role === "student") {
      const clientId = ws.clientId;
      if (!clientId) return;
      if (room.nameLock) {
        ws.send(JSON.stringify({ type: "name_update_rejected", reason: "locked" }));
        return;
      }
      const s = room.students.get(clientId) || { name: "Student", code: "", logs: [], lastSeen: Date.now() };
      s.name = String(msg.name || "").trim() || s.name || "Student";
      s.lastSeen = Date.now();
      room.students.set(clientId, s);
      broadcastToTeachers(ws.roomId, {
        type: "name_update",
        clientId,
        name: s.name,
        lastSeen: s.lastSeen
      });
      return;
    }

    if (msg.type === "code_update" && ws.role === "student") {
      const clientId = ws.clientId;
      if (!clientId) return;
      const s = room.students.get(clientId) || { name: "Student", code: "", logs: [], lastSeen: Date.now() };
      s.code = String(msg.code || "");
      s.lastSeen = Date.now();
      room.students.set(clientId, s);

      broadcastToTeachers(ws.roomId, {
        type: "code_update",
        clientId,
        name: s.name,
        code: s.code,
        lastSeen: s.lastSeen
      });
      return;
    }

    if (msg.type === "log" && ws.role === "student") {
      const clientId = ws.clientId;
      if (!clientId) return;
      const s = room.students.get(clientId) || { name: "Student", code: "", logs: [], lastSeen: Date.now() };
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
    }
    room.sockets.delete(ws);
  });
});

const PORT = process.env.PORT || 8787;
server.listen(PORT, () => {
  console.log(`Seminar runner listening on http://localhost:${PORT}`);
  console.log(`Teacher view: http://localhost:${PORT}/?role=teacher&room=demo`);
  console.log(`QR page: http://localhost:${PORT}/qr.html?room=demo`);
});
