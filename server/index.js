// Mission Control server: serves the built React app, the REST API, and the
// live WebSocket feed, and runs the CTO orchestration loop — one process.

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import { WebSocketServer } from "ws";

import { PORT, HOST, SESSION_SECRET, AUTH_USERNAME, GEMINI_MODEL, GEMINI_DEMO_MODEL } from "./config.js";
import { VALID_DEPARTMENTS } from "./agents.js";
import {
  initStore, snapshot, bus, createTask, deleteTask, clearTasks, getTask,
  getDocument, deleteDocument, deleteMemory, resolveIssue,
} from "./store.js";
import {
  startOrchestrator, dispatchNow, allHands, clockOut, getSettings, setSetting,
} from "./orchestrator.js";
import {
  verifyCredentials, setSession, clearSession, isAuthed, isAuthedFromHeader, loginPage,
} from "./auth.js";
import { toWordDoc, safeFilename } from "./wordExport.js";
import { DEPARTMENTS } from "./agents.js";
import { getAgent } from "./store.js";
import { usingGemini } from "./gemini.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");
const INDEX_HTML = existsSync(join(DIST, "index.html"))
  ? readFileSync(join(DIST, "index.html"), "utf8")
  : null;

const app = Fastify({ logger: false, trustProxy: true });

await app.register(cookie, { secret: SESSION_SECRET });
await app.register(formbody);
if (existsSync(DIST)) {
  await app.register(fastifyStatic, { root: DIST, prefix: "/", index: false, wildcard: false });
}

const redirect = (reply, to) => reply.code(302).header("location", to).send();

/* ---------- auth gate for /api/* (except login) ---------- */
app.addHook("preHandler", (req, reply, done) => {
  const url = req.raw.url.split("?")[0];
  if (url.startsWith("/api/") && url !== "/api/login") {
    if (!isAuthed(req)) return reply.code(401).send({ error: "unauthorized" });
  }
  done();
});

/* ---------- auth routes ---------- */
app.get("/login", (req, reply) => {
  if (isAuthed(req)) return redirect(reply, "/");
  reply.type("text/html").send(loginPage());
});

app.post("/api/login", (req, reply) => {
  const { username, password, next } = req.body || {};
  if (!verifyCredentials(username, password)) {
    return reply.code(401).type("text/html").send(loginPage({ error: "Invalid credentials" }));
  }
  setSession(reply);
  redirect(reply, next && next.startsWith("/") ? next : "/");
});

app.post("/api/logout", (req, reply) => {
  clearSession(reply);
  reply.send({ ok: true });
});

app.get("/api/me", (req, reply) => {
  reply.send({ username: AUTH_USERNAME, gemini: usingGemini, model: GEMINI_MODEL });
});

/* ---------- state + actions ---------- */
app.get("/api/state", (req, reply) => {
  reply.send({ ...snapshot(), settings: getSettings(), gemini: usingGemini, model: GEMINI_MODEL, demoModel: GEMINI_DEMO_MODEL });
});

app.post("/api/tasks", (req, reply) => {
  const { title, prompt, department, assignedTo } = req.body || {};
  if (!title || !String(title).trim()) return reply.code(400).send({ error: "title required" });
  const dept = department && VALID_DEPARTMENTS.has(department) ? department : null;
  const task = createTask({ title: String(title).trim(), prompt, department: dept, assignedTo: assignedTo || null, createdBy: "user" });
  reply.code(201).send(task);
});

app.get("/api/tasks/:id", (req, reply) => {
  const t = getTask(req.params.id);
  if (!t) return reply.code(404).send({ error: "not found" });
  reply.send(t);
});

app.get("/api/documents/:id", (req, reply) => {
  const d = getDocument(req.params.id);
  if (!d) return reply.code(404).send({ error: "not found" });
  reply.send(d);
});

app.get("/api/documents/:id/download", (req, reply) => {
  const d = getDocument(req.params.id);
  if (!d) return reply.code(404).send({ error: "not found" });
  const who = d.agentId && getAgent(d.agentId);
  const dept = d.department && DEPARTMENTS[d.department]?.label;
  const subtitle = [who && who.name, dept, new Date(d.createdAt).toLocaleString()].filter(Boolean).join("  ·  ");
  const md = (d.prompt ? `> **Task:** ${d.prompt}\n\n` : "") + (d.content || "");
  const html = toWordDoc({ title: d.title, subtitle, markdown: md });
  reply
    .header("Content-Type", "application/msword")
    .header("Content-Disposition", `attachment; filename="${safeFilename(d.title)}"`)
    .send(html);
});

app.delete("/api/documents/:id", (req, reply) => {
  reply.code(deleteDocument(req.params.id) ? 204 : 404).send();
});

app.delete("/api/memory/:scope", (req, reply) => {
  reply.code(deleteMemory(req.params.scope) ? 204 : 404).send();
});

app.post("/api/issues/:id/resolve", (req, reply) => {
  reply.send({ ok: resolveIssue(req.params.id) });
});

app.post("/api/tasks/clear", (req, reply) => {
  const scope = (req.body && req.body.scope) || "done";
  if (!["auto", "done", "all"].includes(scope)) return reply.code(400).send({ error: "bad scope" });
  reply.send({ removed: clearTasks(scope) });
});

app.delete("/api/tasks/:id", (req, reply) => {
  const ok = deleteTask(req.params.id);
  reply.code(ok ? 204 : 404).send();
});

app.post("/api/control", async (req, reply) => {
  const { action, autonomous } = req.body || {};
  switch (action) {
    case "dispatch": await dispatchNow(); break;
    case "all_hands": await allHands(); break;
    case "clock_out": clockOut(); break;
    case "pause": setSetting("paused", true); break;
    case "resume": setSetting("paused", false); await dispatchNow(); break;
    case "toggle_autonomous":
      setSetting("autonomous", typeof autonomous === "boolean" ? autonomous : !getSettings().autonomous);
      if (getSettings().autonomous) await dispatchNow();
      break;
    default: return reply.code(400).send({ error: "unknown action" });
  }
  reply.send(getSettings());
});

/* ---------- SPA fallback (gated) ---------- */
app.setNotFoundHandler((req, reply) => {
  const url = req.raw.url.split("?")[0];
  if (url.startsWith("/api/") || url === "/ws") return reply.code(404).send({ error: "not found" });
  if (!isAuthed(req)) return redirect(reply, "/login");
  if (!INDEX_HTML) return reply.code(503).type("text/plain").send("Frontend not built. Run: npm run build");
  reply.type("text/html").send(INDEX_HTML);
});

/* ---------- WebSocket live feed ---------- */
const sockets = new Set();
const wss = new WebSocketServer({ noServer: true });

const broadcast = (frame) => { for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(frame); };
for (const type of ["agent", "task", "event", "settings", "document", "memory", "issue"]) {
  bus.on(type, (payload) => {
    broadcast(JSON.stringify(type === "settings" ? { type, settings: payload } : { type, [type]: payload }));
  });
}
// Bulk task replacement (after a clear).
bus.on("tasksReset", (tasks) => broadcast(JSON.stringify({ type: "tasks", tasks })));

wss.on("connection", (ws) => {
  sockets.add(ws);
  ws.send(JSON.stringify({ type: "snapshot", ...snapshot(), settings: getSettings(), gemini: usingGemini, model: GEMINI_MODEL, demoModel: GEMINI_DEMO_MODEL }));
  ws.on("close", () => sockets.delete(ws));
  ws.on("error", () => sockets.delete(ws));
});

await app.ready();
app.server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname !== "/ws") return socket.destroy();
  if (!isAuthedFromHeader(req.headers.cookie, app)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

/* ---------- boot ---------- */
await initStore();
startOrchestrator();
await app.listen({ port: PORT, host: HOST });
console.log(`[mission-control] http://${HOST}:${PORT}  (gemini: ${usingGemini ? "live" : "simulated"})`);
