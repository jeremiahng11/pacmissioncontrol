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

import { PORT, HOST, SESSION_SECRET, AUTH_USERNAME, GEMINI_MODEL, GEMINI_DEMO_MODEL, GEMINI_FLASH_API_KEY, GEMINI_FLASH_MODEL } from "./config.js";
import { VALID_DEPARTMENTS } from "./agents.js";
import {
  initStore, snapshot, bus, createTask, deleteTask, clearTasks, getTask, updateTask, addEvent,
  getDocument, deleteDocument, deleteMemory, resolveIssue, clearIssues,
  createAttachment, getAttachment, getAttachments, serializeAttachment,
  createRoutine, updateRoutine, deleteRoutine, VALID_CADENCE,
  setTaskCredential, getTaskCredentials,
} from "./store.js";
import { startScheduler, seedRoutines } from "./schedule.js";
import multipart from "@fastify/multipart";
import {
  startOrchestrator, dispatchNow, allHands, clockOut, getSettings, setSetting, reviewForImprovements,
} from "./orchestrator.js";
import {
  verifyCredentials, setSession, clearSession, isAuthed, isAuthedFromHeader, loginPage,
} from "./auth.js";
import { toWordDoc, safeFilename } from "./wordExport.js";
import { extractFiles, buildZip, extractCodeBlocks, langExt, mimeForExt, baseName, extOf } from "./zipExport.js";
import { DEPARTMENTS } from "./agents.js";
import { getAgent } from "./store.js";
import { usingGemini, embed } from "./gemini.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");
const INDEX_HTML = existsSync(join(DIST, "index.html"))
  ? readFileSync(join(DIST, "index.html"), "utf8")
  : null;

const app = Fastify({ logger: false, trustProxy: true });

await app.register(cookie, { secret: SESSION_SECRET });
await app.register(formbody);
await app.register(multipart, { limits: { fileSize: 12 * 1024 * 1024, files: 6 } });
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

app.post("/api/tasks", async (req, reply) => {
  let title, prompt, department, assignedTo, plan, priority;
  const files = [];
  if (req.isMultipart()) {
    for await (const part of req.parts()) {
      if (part.type === "file") {
        const buf = await part.toBuffer();
        files.push({ filename: part.filename, mime: part.mimetype, data: buf.toString("base64"), size: buf.length });
      } else if (part.fieldname === "title") title = part.value;
      else if (part.fieldname === "prompt") prompt = part.value;
      else if (part.fieldname === "department") department = part.value;
      else if (part.fieldname === "plan") plan = part.value === "true" || part.value === true;
      else if (part.fieldname === "priority") priority = part.value;
    }
  } else {
    ({ title, prompt, department, assignedTo, plan, priority } = req.body || {});
  }
  if (!title || !String(title).trim()) return reply.code(400).send({ error: "title required" });
  const dept = department && VALID_DEPARTMENTS.has(department) ? department : null;
  const task = createTask({ title: String(title).trim(), prompt, department: dept, assignedTo: assignedTo || null, createdBy: "user", isPlan: !!plan, priority });
  for (const f of files) createAttachment({ taskId: task.id, ...f });
  // Re-broadcast so the task carries its attachments to all clients.
  bus.emit("task", serializeTaskWithAttachments(task.id));
  reply.code(201).send({ ...task, attachments: getAttachments(task.id).map(serializeAttachment) });
});

function serializeTaskWithAttachments(id) {
  const t = getTask(id);
  return { ...t, attachments: getAttachments(id).map(serializeAttachment) };
}

app.get("/api/attachments/:id", (req, reply) => {
  const a = getAttachment(req.params.id);
  if (!a) return reply.code(404).send({ error: "not found" });
  reply
    .header("Content-Type", a.mime || "application/octet-stream")
    .header("Content-Disposition", `inline; filename="${a.filename}"`)
    .send(Buffer.from(a.data, "base64"));
});

app.post("/api/missions", (req, reply) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  const defaultDept = b.department && VALID_DEPARTMENTS.has(b.department) ? b.department : null;
  const items = (Array.isArray(b.tasks) ? b.tasks : String(b.tasks || "").split("\n")).slice(0, 50);
  const sequential = !!b.sequential; // run in order, each building on the previous
  const created = [];
  let prevId = null;
  for (const it of items) {
    let title, prompt, dept;
    if (typeof it === "string") { title = it.trim(); prompt = title; dept = defaultDept; }
    else {
      title = String(it.title || "").trim();
      prompt = String(it.prompt || it.description || title).trim();
      dept = it.department && VALID_DEPARTMENTS.has(it.department) ? it.department : defaultDept;
    }
    if (!title) continue;
    const t = createTask({ title, prompt: prompt || title, department: dept, createdBy: "user", mission: name || null, dependsOn: sequential && prevId ? [prevId] : [] });
    created.push(t);
    prevId = t.id;
  }
  if (!created.length) return reply.code(400).send({ error: "no tasks" });
  reply.code(201).send({ count: created.length });
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

app.post("/api/tasks/:id/credentials", (req, reply) => {
  const t = getTask(req.params.id);
  if (!t) return reply.code(404).send({ error: "not found" });
  const { name, value } = req.body || {};
  if (!name || value == null || !String(name).trim()) return reply.code(400).send({ error: "name and value required" });
  setTaskCredential(t.id, String(name).trim(), String(value));
  reply.send({ ok: true, names: Object.keys(getTaskCredentials(t.id)) });
});

app.get("/api/documents/:id/zip", async (req, reply) => {
  const d = getDocument(req.params.id);
  if (!d) return reply.code(404).send({ error: "not found" });
  const files = extractFiles(d.content || "");
  const buf = await buildZip(files, d.title, d.content);
  const name = safeFilename(d.title).replace(/\.doc$/, "");
  reply.header("Content-Type", "application/zip").header("Content-Disposition", `attachment; filename="${name}.zip"`).send(buf);
});

// Smart code download: single file -> its real extension (.html/.py/.dart/...);
// multiple files -> .zip.
app.get("/api/documents/:id/code", async (req, reply) => {
  const d = getDocument(req.params.id);
  if (!d) return reply.code(404).send({ error: "not found" });
  const base = safeFilename(d.title).replace(/\.doc$/, "");
  const sendFileOut = (filename, content) =>
    reply.header("Content-Type", mimeForExt(extOf(filename))).header("Content-Disposition", `attachment; filename="${filename}"`).send(content);
  const sendZipOut = async (files) =>
    reply.header("Content-Type", "application/zip").header("Content-Disposition", `attachment; filename="${base}.zip"`).send(await buildZip(files, d.title, d.content));

  const named = extractFiles(d.content || "");
  if (named.length >= 2) return sendZipOut(named);
  if (named.length === 1) return sendFileOut(baseName(named[0].path), named[0].content);

  const blocks = extractCodeBlocks(d.content || "");
  if (blocks.length >= 2) return sendZipOut(blocks.map((b, i) => ({ path: `${base}-${i + 1}.${langExt(b.lang)}`, content: b.content })));
  if (blocks.length === 1) return sendFileOut(`${base}.${langExt(blocks[0].lang)}`, blocks[0].content);
  return sendFileOut(`${base}.txt`, d.content || "");
});

// Live preview: serve a web deliverable's files so the UI can render it in a
// sandboxed iframe. Entry is index.html; relative css/js/manifest resolve
// against /preview/.
function previewFiles(d) {
  let files = extractFiles(d.content || "");
  if (!files.length) {
    const blocks = extractCodeBlocks(d.content || "");
    const html = blocks.find((b) => /html?$/i.test(b.lang)) || (blocks.length === 1 ? blocks[0] : null);
    if (html) files = [{ path: "index.html", content: html.content }];
  }
  return files;
}
const normPath = (p) => String(p).replace(/^\.?\/+/, "").toLowerCase();
app.get("/api/documents/:id/preview", (req, reply) => reply.redirect(`/api/documents/${req.params.id}/preview/`));
app.get("/api/documents/:id/preview/*", (req, reply) => {
  const d = getDocument(req.params.id);
  if (!d) return reply.code(404).type("text/html").send("<p>Not found.</p>");
  const files = previewFiles(d);
  if (!files.length) return reply.code(404).type("text/html").send("<p style=\"font-family:sans-serif;padding:24px;color:#555\">Nothing to preview — this deliverable has no web files.</p>");
  let sub = req.params["*"] || "";
  if (sub === "" || sub.endsWith("/")) sub += "index.html";
  let f = files.find((x) => normPath(x.path) === normPath(sub));
  if (!f && normPath(sub) === "index.html") f = files.find((x) => /(^|\/)index\.html?$/i.test(x.path)) || files.find((x) => /\.html?$/i.test(x.path));
  if (!f) return reply.code(404).type("text/plain").send("Not in project: " + sub);
  reply.header("Content-Type", mimeForExt(extOf(f.path))).send(f.content);
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

app.post("/api/issues/clear", (req, reply) => {
  reply.send({ removed: clearIssues() });
});

/* ---------- routines (Calendar / standing duties) ---------- */
app.post("/api/routines", (req, reply) => {
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) return reply.code(400).send({ error: "title required" });
  if (!VALID_CADENCE.has(b.cadenceType)) return reply.code(400).send({ error: "bad cadenceType" });
  const dept = b.department && VALID_DEPARTMENTS.has(b.department) ? b.department : null;
  const r = createRoutine({
    title: String(b.title).trim(), prompt: b.prompt, department: dept, cadenceType: b.cadenceType,
    everyMinutes: b.everyMinutes ? Number(b.everyMinutes) : null, dailyTime: b.dailyTime || null,
    runAt: b.runAt ? new Date(b.runAt).getTime() : null, estimateMinutes: b.estimateMinutes ? Number(b.estimateMinutes) : null,
    enabled: b.enabled !== false, createdBy: "user",
  });
  reply.code(201).send(r);
});
app.patch("/api/routines/:id", (req, reply) => {
  const r = updateRoutine(req.params.id, req.body || {});
  if (!r) return reply.code(404).send({ error: "not found" });
  reply.send(r);
});
app.delete("/api/routines/:id", (req, reply) => {
  reply.code(deleteRoutine(req.params.id) ? 204 : 404).send();
});

app.post("/api/tasks/clear", (req, reply) => {
  const scope = (req.body && req.body.scope) || "done";
  if (!["auto", "done", "all"].includes(scope)) return reply.code(400).send({ error: "bad scope" });
  reply.send({ removed: clearTasks(scope) });
});

app.post("/api/tasks/:id/retry", async (req, reply) => {
  const t = getTask(req.params.id);
  if (!t) return reply.code(404).send({ error: "not found" });
  if (!["failed", "blocked"].includes(t.status)) return reply.code(400).send({ error: "only failed or blocked tasks can be continued" });
  // Keep the partial result so the agent continues from it. Also resume if the
  // office was clocked out, log it, and kick a dispatch so it picks up now.
  if (getSettings().paused) setSetting("paused", false);
  updateTask(t.id, { status: "queued", attempts: 0, startedAt: null, completedAt: null, reviewNotes: "continuing from previous attempt" });
  addEvent({ kind: "system", text: `Jay Jay re-dispatching: ${t.title}`, taskId: t.id });
  await dispatchNow();
  reply.send({ ok: true });
});

app.post("/api/tasks/:id/suggest", (req, reply) => {
  const t = getTask(req.params.id);
  if (!t) return reply.code(404).send({ error: "not found" });
  if (t.status !== "done") return reply.code(400).send({ error: "only completed tasks can be reviewed" });
  reviewForImprovements(t.id).catch((e) => console.error("[api] suggest", e.message)); // async
  reply.send({ ok: true });
});

app.post("/api/tasks/:id/autoimprove", (req, reply) => {
  const t = getTask(req.params.id);
  if (!t) return reply.code(404).send({ error: "not found" });
  const on = !!(req.body || {}).on;
  updateTask(t.id, { autoImprove: on, ...(on ? {} : {}) });
  reply.send({ ok: true, autoImprove: on });
});

app.post("/api/tasks/:id/followup", async (req, reply) => {
  const t = getTask(req.params.id);
  if (!t) return reply.code(404).send({ error: "not found" });
  // Accept files (e.g. a design reference to match) on a follow-up; since this
  // re-runs the SAME task, the attachment is available to the re-build.
  let instruction = "";
  const files = [];
  if (req.isMultipart()) {
    for await (const part of req.parts()) {
      if (part.type === "file") { const buf = await part.toBuffer(); files.push({ filename: part.filename, mime: part.mimetype, data: buf.toString("base64"), size: buf.length }); }
      else if (part.fieldname === "instruction") instruction = part.value;
    }
  } else {
    instruction = String((req.body || {}).instruction || "");
  }
  instruction = instruction.trim();
  if (!instruction) return reply.code(400).send({ error: "instruction required" });
  for (const f of files) createAttachment({ taskId: t.id, ...f });
  // Re-run the SAME task (same thread/project): append the instruction and
  // re-queue, keeping the current result so the agent builds on it. Its
  // document updates in place rather than spawning a new task/project.
  updateTask(t.id, {
    prompt: `${t.prompt}\n\nFOLLOW-UP (revise the previous deliverable accordingly): ${instruction}`,
    status: "queued",
    attempts: 0,
    startedAt: null,
    completedAt: null,
    revisions: (t.revisions || 0) + 1,
    reviewNotes: "follow-up requested",
  });
  addEvent({ kind: "system", text: `Jay Jay re-dispatching (revision): ${t.title}`, taskId: t.id });
  reply.send({ ok: true });
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
for (const type of ["agent", "task", "event", "settings", "document", "memory", "issue", "routine", "stats"]) {
  bus.on(type, (payload) => {
    broadcast(JSON.stringify(type === "settings" ? { type, settings: payload } : { type, [type]: payload }));
  });
}
// Bulk task replacement (after a clear).
bus.on("tasksReset", (tasks) => broadcast(JSON.stringify({ type: "tasks", tasks })));
bus.on("issuesReset", () => broadcast(JSON.stringify({ type: "issues", issues: [] })));

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
  // Complete the handshake even when unauthed, then close with code 4001 so the
  // client gets a real WS close code (a rejected handshake only yields 1006,
  // which the client can't tell from a network blip — that left PWAs stuck on a
  // blank app shell, reconnecting forever instead of redirecting to /login).
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (!isAuthedFromHeader(req.headers.cookie, app)) {
      try { ws.close(4001, "unauthorized"); } catch { socket.destroy(); }
      return;
    }
    wss.emit("connection", ws, req);
  });
});

/* ---------- boot ---------- */
await initStore();
seedRoutines();
startOrchestrator();
startScheduler();
await app.listen({ port: PORT, host: HOST });
console.log(`[mission-control] http://${HOST}:${PORT}  (gemini: ${usingGemini ? "live" : "simulated"})`);
console.log(`[mission-control] models — work/plan/synthesis: ${GEMINI_MODEL} (Pro key) | review/notes/demo: ${GEMINI_FLASH_MODEL} (${GEMINI_FLASH_API_KEY ? "separate Flash key" : "same key — no Flash key set"})`);
if (usingGemini) embed("ping").then((v) => console.log(`[rag] ${v ? `semantic memory active (${v.length}-dim embeddings)` : "embeddings unavailable — using keyword recall (set GEMINI_EMBED_MODEL?)"}`)).catch(() => {});
