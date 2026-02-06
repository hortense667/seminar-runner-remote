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
 *   students: Map(clientId -> { name, code, logs: string[], lastSeen }),
 *   teachers: Set(ws)
 * })
 */
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { students: new Map(), teachers: new Set() });
  }
  return rooms.get(roomId);
}

function broadcastToTeachers(roomId, msgObj) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(msgObj);
  for (const ws of room.teachers) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

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
        room.teachers.add(ws);
        const students = [...room.students.entries()].map(([id, s]) => ({
          clientId: id,
          name: s.name,
          code: s.code || "",
          logs: s.logs || [],
          lastSeen: s.lastSeen || Date.now()
        }));
        ws.send(JSON.stringify({ type: "snapshot", room: roomId, students }));
      } else {
        if (!clientId) return;
        const prev = room.students.get(clientId);
        room.students.set(clientId, {
          name,
          code: prev?.code || "",
          logs: prev?.logs || [],
          lastSeen: Date.now()
        });
        broadcastToTeachers(roomId, {
          type: "student_joined",
          clientId,
          name,
          lastSeen: Date.now()
        });
      }
      return;
    }

    if (!ws.roomId) return;
    const room = getRoom(ws.roomId);

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
  });
});

const extractBtn = document.getElementById("extractBtn");

extractBtn?.addEventListener("click", () => {
  const text = codeEl.value || "";
  // HTMLっぽくなければ何もしない
  if (!/<script[\s>]/i.test(text)) return;

  const doc = new DOMParser().parseFromString(text, "text/html");

  // src付きは無視（安全）
  const scripts = Array.from(doc.querySelectorAll("script"))
    .filter(s => !s.src)
    .map(s => (s.textContent || "").trim())
    .filter(Boolean);

  if (!scripts.length) {
    appendLog("[warn] scriptが見つかりませんでした");
    return;
  }

  const js = scripts.join("\n\n");
  codeEl.value = js;

  // 共有も更新
  if (ws && ws.readyState === WebSocket.OPEN && role === "student") {
    ws.send(JSON.stringify({ type: "code_update", code: codeEl.value }));
  }

  appendLog("[info] HTMLからJSを抽出しました（Runで実行してください）");
});

const PORT = process.env.PORT || 8787;
server.listen(PORT, () => {
  console.log(`Seminar runner listening on http://localhost:${PORT}`);
  console.log(`Teacher view: http://localhost:${PORT}/?role=teacher&room=demo`);
  console.log(`QR page: http://localhost:${PORT}/qr.html?room=demo`);
});
