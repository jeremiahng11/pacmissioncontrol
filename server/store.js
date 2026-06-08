// Runtime state store. In-memory maps are the source of truth for the live
// loop; Postgres (when DATABASE_URL is set) is the durable backing store:
// loaded on boot, written through on every change. Mutations emit on `bus`
// so the WebSocket layer can broadcast them.

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { AGENT_DEFS } from "./agents.js";
import { DATABASE_URL } from "./config.js";

const { Pool } = pg;
export const bus = new EventEmitter();
bus.setMaxListeners(50);

const MAX_EVENTS = 200;
const state = {
  agents: new Map(), // id -> agent (includes persona/department; not serialized)
  tasks: new Map(), // id -> task
  events: [], // newest-first, capped
  documents: [], // newest-first deliverables (durable, not pruned with the queue)
  memory: new Map(), // scope (department) -> rolling knowledge base
  issues: [], // newest-first; system/quality problems raised to the Group CTO
  attachments: new Map(), // id -> {id, taskId, filename, mime, data(base64), size}
  routines: new Map(), // id -> scheduled/recurring task definition
  credentials: new Map(), // taskId -> { name: value } (sandbox creds; values never sent to clients)
  usage: null, // daily token/cost + outcome stats (set on first use)
  memNotes: [], // structured memory notes {id, scope, text, embedding, taskId, createdAt} for semantic recall
};

/* ---------- usage / cost metrics (in-memory, resets daily at UTC midnight) ---------- */
const todayUTC = () => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; };
const freshUsage = () => ({ day: todayUTC(), pro: { calls: 0, inTok: 0, outTok: 0 }, flash: { calls: 0, inTok: 0, outTok: 0 }, tasksDone: 0, tasksFailed: 0 });
// Rough public per-1M-token pricing (USD) — clearly an estimate, edit to taste.
const RATES = { pro: { in: 1.25, out: 10 }, flash: { in: 0.3, out: 2.5 } };
function rollDay() { if (!state.usage || state.usage.day !== todayUTC()) state.usage = freshUsage(); return state.usage; }

export function recordUsage(model, meta) {
  const u = rollDay();
  const b = /flash/i.test(model || "") ? "flash" : "pro";
  u[b].calls++;
  u[b].inTok += meta?.promptTokenCount || 0;
  u[b].outTok += meta?.candidatesTokenCount || (meta?.totalTokenCount ? meta.totalTokenCount - (meta.promptTokenCount || 0) : 0) || 0;
  bus.emit("stats", getStats());
}
export function recordOutcome(ok) { const u = rollDay(); if (ok) u.tasksDone++; else u.tasksFailed++; bus.emit("stats", getStats()); }
export function getStats() {
  const u = rollDay();
  const cost = (b) => u[b].inTok / 1e6 * RATES[b].in + u[b].outTok / 1e6 * RATES[b].out;
  const estCostPro = cost("pro"), estCostFlash = cost("flash");
  return { day: u.day, pro: u.pro, flash: u.flash, tasksDone: u.tasksDone, tasksFailed: u.tasksFailed, estCostPro, estCostFlash, estCostTotal: estCostPro + estCostFlash };
}
let eventSeq = 1;
let pool = null;

function needsSsl(url) {
  return /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false };
}

function timeAgo(ms) {
  if (!ms) return "—";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ---------- attachments (files for the agent to work with) ---------- */
export const getAttachments = (taskId) => [...state.attachments.values()].filter((a) => a.taskId === taskId);
export const getAttachment = (id) => state.attachments.get(id);
export const serializeAttachment = (a) => ({ id: a.id, taskId: a.taskId, filename: a.filename, mime: a.mime, size: a.size });
export function createAttachment({ taskId, filename, mime, data, size }) {
  const att = { id: randomUUID(), taskId, filename: filename || "file", mime: mime || "application/octet-stream", data, size: size || 0 };
  state.attachments.set(att.id, att);
  if (pool) pool.query(
    "INSERT INTO attachments (id,task_id,filename,mime,data,size) VALUES ($1,$2,$3,$4,$5,$6)",
    [att.id, att.taskId, att.filename, att.mime, att.data, att.size]
  ).catch((e) => console.error("[store] persistAttachment", e.message));
  return att;
}
function deleteAttachmentsForTask(taskId) {
  for (const a of getAttachments(taskId)) state.attachments.delete(a.id);
  if (pool) pool.query("DELETE FROM attachments WHERE task_id=$1", [taskId]).catch(() => {});
}

/* ---------- serialization (what clients see) ---------- */
export function serializeAgent(a) {
  return {
    id: a.id,
    name: a.name,
    role: a.role,
    room: a.room,
    department: a.department,
    color: a.color,
    cto: a.cto,
    status: a.status,
    task: a.task,
    currentTaskId: a.currentTaskId || null,
    last: a.cto ? "" : timeAgo(a.lastRunAt),
    lastRunAt: a.cto ? null : (a.lastRunAt || null), // timestamp so the UI can keep it live
  };
}
export function serializeTask(t) {
  // credentialNames only — values are never sent to clients.
  return { ...t, attachments: getAttachments(t.id).map(serializeAttachment), credentialNames: Object.keys(state.credentials.get(t.id) || {}) };
}

/* ---------- per-task sandbox credentials (values stay server-side) ---------- */
export const getTaskCredentials = (taskId) => state.credentials.get(taskId) || {};
export function setTaskCredential(taskId, name, value) {
  if (!state.credentials.has(taskId)) state.credentials.set(taskId, {});
  state.credentials.get(taskId)[name] = value;
  if (pool) pool.query(
    "INSERT INTO task_credentials (task_id,name,value) VALUES ($1,$2,$3) ON CONFLICT (task_id,name) DO UPDATE SET value=$3",
    [taskId, name, value]
  ).catch((e) => console.error("[store] setTaskCredential", e.message));
  const t = state.tasks.get(taskId);
  if (t) bus.emit("task", serializeTask(t)); // refresh credentialNames
}
function deleteCredentialsForTask(taskId) {
  state.credentials.delete(taskId);
  if (pool) pool.query("DELETE FROM task_credentials WHERE task_id=$1", [taskId]).catch(() => {});
}

/* ---------- boot ---------- */
const SCHEMA = process.env.DB_SCHEMA || "mission_control";

export async function initStore() {
  if (DATABASE_URL) {
    // Keep our tables in their own schema so the DB can be safely shared with
    // another app (Render free tier allows only one Postgres per account).
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: needsSsl(DATABASE_URL),
      max: 5,
      options: `-c search_path=${SCHEMA}`,
    });
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    await migrate();
  }
  await loadAgents();
  // Issues are session-scoped (in-memory) on purpose — not reloaded from the DB,
  // so a dismissed/cleared issue can never resurrect on restart.
  if (pool) { await loadTasks(); await loadDocuments(); await loadMemory(); await loadAttachments(); await loadRoutines(); await loadCredentials(); await loadMemNotes(); }
  if (pool) pool.query("DELETE FROM issues").catch(() => {}); // clear any stale persisted issues
  console.log(`[store] ready (${pool ? "postgres" : "in-memory"})`);
}

// Drop issues whose task is gone or no longer failing (e.g. it later completed),
// so stale issues don't linger across restarts.
function reconcileIssues() {
  const liveIds = new Set(state.tasks.keys());
  const stale = state.issues.filter((i) => i.taskId && !liveIds.has(i.taskId));
  if (!stale.length) return;
  state.issues = state.issues.filter((i) => !i.taskId || liveIds.has(i.taskId));
  if (pool) pool.query("DELETE FROM issues WHERE task_id = ANY($1::text[])", [stale.map((i) => i.taskId)]).catch((e) => console.error("[store] reconcileIssues", e.message));
  console.log(`[store] cleared ${stale.length} stale issue(s)`);
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id text PRIMARY KEY, name text, role text, room text, department text,
      color text, cto boolean, status text, task text,
      current_task_id text, last_run_at timestamptz, updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id text PRIMARY KEY, title text NOT NULL, prompt text NOT NULL,
      department text, assigned_to text, status text NOT NULL DEFAULT 'queued',
      result text, review_notes text, attempts int NOT NULL DEFAULT 0,
      created_by text DEFAULT 'user',
      created_at timestamptz DEFAULT now(), started_at timestamptz, completed_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS events (
      id bigserial PRIMARY KEY, ts timestamptz DEFAULT now(),
      kind text, text text, agent_id text, task_id text
    );
    CREATE TABLE IF NOT EXISTS documents (
      id text PRIMARY KEY, task_id text, title text, prompt text,
      department text, agent_id text, content text, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS memory (
      scope text PRIMARY KEY, title text, content text,
      updated_at timestamptz DEFAULT now(), updated_by text
    );
    CREATE TABLE IF NOT EXISTS issues (
      id text PRIMARY KEY, kind text, title text, detail text,
      task_id text, agent_id text, resolved boolean DEFAULT false,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id text PRIMARY KEY, task_id text, filename text, mime text,
      data text, size int, created_at timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);
    CREATE TABLE IF NOT EXISTS routines (
      id text PRIMARY KEY, title text, prompt text, department text,
      cadence_type text, every_minutes int, daily_time text, run_at timestamptz,
      estimate_minutes int, enabled boolean DEFAULT true,
      next_run_at timestamptz, last_run_at timestamptz,
      created_by text, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS task_credentials (
      task_id text, name text, value text, PRIMARY KEY (task_id, name)
    );
    CREATE TABLE IF NOT EXISTS mem_notes (
      id text PRIMARY KEY, scope text, text text, embedding text,
      task_id text, created_at timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_mem_notes_scope ON mem_notes(scope);
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS prior_work text;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_id text;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS mission text;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_plan boolean DEFAULT false;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority text DEFAULT 'normal';
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS depends_on text;
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);
  `);
}

async function loadDocuments() {
  const { rows } = await pool.query("SELECT * FROM documents ORDER BY created_at DESC LIMIT 300");
  for (const r of rows) state.documents.push({
    id: r.id, taskId: r.task_id, title: r.title, prompt: r.prompt,
    department: r.department, agentId: r.agent_id, content: r.content,
    createdAt: new Date(r.created_at).getTime(),
  });
}
async function loadMemory() {
  const { rows } = await pool.query("SELECT * FROM memory");
  for (const r of rows) state.memory.set(r.scope, {
    scope: r.scope, title: r.title, content: r.content,
    updatedAt: new Date(r.updated_at).getTime(), updatedBy: r.updated_by,
  });
}
async function loadIssues() {
  const { rows } = await pool.query("SELECT * FROM issues WHERE resolved=false ORDER BY created_at DESC LIMIT 100");
  for (const r of rows) state.issues.push({
    id: r.id, kind: r.kind, title: r.title, detail: r.detail,
    taskId: r.task_id, agentId: r.agent_id, resolved: r.resolved,
    createdAt: new Date(r.created_at).getTime(),
  });
}
async function loadAttachments() {
  // Load metadata only (data is fetched on demand) for tasks still around.
  const { rows } = await pool.query("SELECT id, task_id, filename, mime, data, size FROM attachments");
  for (const r of rows) state.attachments.set(r.id, { id: r.id, taskId: r.task_id, filename: r.filename, mime: r.mime, data: r.data, size: r.size });
}
async function loadMemNotes() {
  const { rows } = await pool.query("SELECT id, scope, text, embedding, task_id, created_at FROM mem_notes ORDER BY created_at");
  state.memNotes = rows.map((r) => ({
    id: r.id, scope: r.scope, text: r.text, taskId: r.task_id,
    createdAt: new Date(r.created_at).getTime(),
    embedding: (() => { try { return r.embedding ? JSON.parse(r.embedding) : null; } catch { return null; } })(),
  }));
}
async function loadCredentials() {
  const { rows } = await pool.query("SELECT task_id, name, value FROM task_credentials");
  for (const r of rows) {
    if (!state.credentials.has(r.task_id)) state.credentials.set(r.task_id, {});
    state.credentials.get(r.task_id)[r.name] = r.value;
  }
}
async function loadRoutines() {
  const { rows } = await pool.query("SELECT * FROM routines");
  for (const r of rows) state.routines.set(r.id, {
    id: r.id, title: r.title, prompt: r.prompt, department: r.department,
    cadenceType: r.cadence_type, everyMinutes: r.every_minutes, dailyTime: r.daily_time,
    runAt: r.run_at ? new Date(r.run_at).getTime() : null, estimateMinutes: r.estimate_minutes,
    enabled: r.enabled, nextRunAt: r.next_run_at ? new Date(r.next_run_at).getTime() : null,
    lastRunAt: r.last_run_at ? new Date(r.last_run_at).getTime() : null,
    createdBy: r.created_by, createdAt: new Date(r.created_at).getTime(),
  });
}

async function loadAgents() {
  let rows = [];
  if (pool) rows = (await pool.query("SELECT * FROM agents")).rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const def of AGENT_DEFS) {
    const row = byId.get(def.id);
    // Status/task are transient (driven by the live loop). Always boot agents
    // at rest — never restore a mid-task "thinking"/"working" state from the
    // DB, or a restart leaves them stuck with no task actually running.
    const agent = {
      ...def,
      status: def.cto ? "command" : "idle",
      task: def.cto ? "running the office" : "standing by",
      currentTaskId: null,
      lastRunAt: row?.last_run_at ? new Date(row.last_run_at).getTime() : null,
    };
    state.agents.set(def.id, agent);
    if (pool) await persistAgent(agent);
  }
}

async function loadTasks() {
  const { rows } = await pool.query(
    "SELECT * FROM tasks WHERE status <> 'done' OR completed_at > now() - interval '1 day' ORDER BY created_at"
  );
  for (const r of rows) {
    state.tasks.set(r.id, {
      id: r.id,
      title: r.title,
      prompt: r.prompt,
      department: r.department,
      assignedTo: r.assigned_to,
      status: r.status === "in_progress" || r.status === "review" ? "queued" : r.status,
      result: r.result,
      reviewNotes: r.review_notes,
      attempts: r.attempts,
      createdBy: r.created_by,
      priorWork: r.prior_work || null,
      parentId: r.parent_id || null,
      mission: r.mission || null,
      isPlan: r.is_plan || false,
      priority: r.priority || "normal",
      dependsOn: (() => { try { return r.depends_on ? JSON.parse(r.depends_on) : []; } catch { return []; } })(),
      createdAt: new Date(r.created_at).getTime(),
      startedAt: r.started_at ? new Date(r.started_at).getTime() : null,
      completedAt: r.completed_at ? new Date(r.completed_at).getTime() : null,
    });
  }
}

/* ---------- persistence helpers (no-ops without pg) ---------- */
async function persistAgent(a) {
  if (!pool) return;
  await pool
    .query(
      `INSERT INTO agents (id,name,role,room,department,color,cto,status,task,current_task_id,last_run_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
       ON CONFLICT (id) DO UPDATE SET status=$8, task=$9, current_task_id=$10, last_run_at=$11, updated_at=now()`,
      [a.id, a.name, a.role, a.room, a.department, a.color, a.cto, a.status, a.task,
       a.currentTaskId, a.lastRunAt ? new Date(a.lastRunAt) : null]
    )
    .catch((e) => console.error("[store] persistAgent", e.message));
}
async function persistTask(t) {
  if (!pool) return;
  await pool
    .query(
      `INSERT INTO tasks (id,title,prompt,department,assigned_to,status,result,review_notes,attempts,created_by,created_at,started_at,completed_at,prior_work,parent_id,mission,is_plan,priority,depends_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (id) DO UPDATE SET title=$2,prompt=$3,department=$4,assigned_to=$5,status=$6,result=$7,review_notes=$8,attempts=$9,started_at=$12,completed_at=$13,prior_work=$14,parent_id=$15,mission=$16,is_plan=$17,priority=$18,depends_on=$19`,
      [t.id, t.title, t.prompt, t.department, t.assignedTo, t.status, t.result,
       t.reviewNotes, t.attempts, t.createdBy,
       new Date(t.createdAt), t.startedAt ? new Date(t.startedAt) : null,
       t.completedAt ? new Date(t.completedAt) : null, t.priorWork || null, t.parentId || null, t.mission || null, !!t.isPlan, t.priority || "normal", JSON.stringify(t.dependsOn || [])]
    )
    .catch((e) => console.error("[store] persistTask", e.message));
}
async function persistEvent(e) {
  if (!pool) return;
  await pool
    .query("INSERT INTO events (kind,text,agent_id,task_id) VALUES ($1,$2,$3,$4)",
      [e.kind, e.text, e.agentId || null, e.taskId || null])
    .catch((err) => console.error("[store] persistEvent", err.message));
}
async function persistDocument(d) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO documents (id,task_id,title,prompt,department,agent_id,content,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO UPDATE SET title=$3, prompt=$4, content=$7, created_at=$8`,
    [d.id, d.taskId, d.title, d.prompt, d.department, d.agentId, d.content, new Date(d.createdAt)]
  ).catch((e) => console.error("[store] persistDocument", e.message));
}
async function persistMemory(m) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO memory (scope,title,content,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (scope) DO UPDATE SET title=$2, content=$3, updated_at=$4, updated_by=$5`,
    [m.scope, m.title, m.content, new Date(m.updatedAt), m.updatedBy]
  ).catch((e) => console.error("[store] persistMemory", e.message));
}
async function persistIssue(i) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO issues (id,kind,title,detail,task_id,agent_id,resolved,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET resolved=$7`,
    [i.id, i.kind, i.title, i.detail, i.taskId, i.agentId, i.resolved, new Date(i.createdAt)]
  ).catch((e) => console.error("[store] persistIssue", e.message));
}

/* ---------- reads ---------- */
export const getAgent = (id) => state.agents.get(id);
export const getAgents = () => [...state.agents.values()];
export const getWorkers = () => getAgents().filter((a) => !a.cto);
export const getTasks = () => [...state.tasks.values()];
export const getTask = (id) => state.tasks.get(id);

const serializeDocMeta = (d) => ({
  id: d.id, taskId: d.taskId, title: d.title, department: d.department,
  agentId: d.agentId, createdAt: d.createdAt, snippet: (d.content || "").slice(0, 160),
  hasCode: /```|=+\s*FILE:/.test(d.content || ""), // so the UI can offer code/zip download + list it in Projects
  previewable: /=+\s*FILE:\s*[^\n]*\.html?\b/i.test(d.content || "") || /```html\b/i.test(d.content || "") || /<!doctype html|<html[\s>]/i.test(d.content || ""), // a renderable web deliverable
});
const serializeMemory = (m) => ({ scope: m.scope, title: m.title, content: m.content, updatedAt: m.updatedAt, updatedBy: m.updatedBy });
const serializeIssue = (i) => ({ id: i.id, kind: i.kind, title: i.title, detail: (i.detail || "").slice(0, 600), taskId: i.taskId, agentId: i.agentId, createdAt: i.createdAt });

const serializeRoutine = (r) => ({
  id: r.id, title: r.title, prompt: r.prompt, department: r.department,
  cadenceType: r.cadenceType, everyMinutes: r.everyMinutes, dailyTime: r.dailyTime,
  runAt: r.runAt, estimateMinutes: r.estimateMinutes, enabled: r.enabled,
  nextRunAt: r.nextRunAt, lastRunAt: r.lastRunAt, createdBy: r.createdBy,
});

export function snapshot() {
  return {
    agents: getAgents().map(serializeAgent),
    tasks: getTasks().map(serializeTask),
    events: state.events.slice(0, 60),
    documents: state.documents.slice(0, 60).map(serializeDocMeta),
    memory: [...state.memory.values()].map(serializeMemory),
    issues: getIssues().map(serializeIssue),
    routines: [...state.routines.values()].map(serializeRoutine),
    stats: getStats(),
  };
}

/* ---------- routines (scheduled / recurring tasks) ---------- */
export const VALID_CADENCE = new Set(["once", "interval", "daily"]);
export function computeNextRun(r, fromMs) {
  const from = fromMs || Date.now();
  if (r.cadenceType === "once") return r.runAt || null;
  if (r.cadenceType === "interval") return from + Math.max(1, r.everyMinutes || 60) * 60000;
  if (r.cadenceType === "daily") {
    const [hh, mm] = String(r.dailyTime || "09:00").split(":").map(Number);
    const d = new Date(from);
    let next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh || 0, mm || 0, 0, 0);
    if (next <= from) next += 86400000;
    return next;
  }
  return null;
}
export const getRoutines = () => [...state.routines.values()];
export const getRoutine = (id) => state.routines.get(id);
function persistRoutine(r) {
  if (!pool) return;
  pool.query(
    `INSERT INTO routines (id,title,prompt,department,cadence_type,every_minutes,daily_time,run_at,estimate_minutes,enabled,next_run_at,last_run_at,created_by,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO UPDATE SET title=$2,prompt=$3,department=$4,cadence_type=$5,every_minutes=$6,daily_time=$7,run_at=$8,estimate_minutes=$9,enabled=$10,next_run_at=$11,last_run_at=$12`,
    [r.id, r.title, r.prompt, r.department, r.cadenceType, r.everyMinutes, r.dailyTime,
     r.runAt ? new Date(r.runAt) : null, r.estimateMinutes, r.enabled,
     r.nextRunAt ? new Date(r.nextRunAt) : null, r.lastRunAt ? new Date(r.lastRunAt) : null,
     r.createdBy, new Date(r.createdAt)]
  ).catch((e) => console.error("[store] persistRoutine", e.message));
}
export function createRoutine(input) {
  const r = {
    id: randomUUID(), title: String(input.title).slice(0, 120), prompt: String(input.prompt || input.title).slice(0, 4000),
    department: input.department || null, cadenceType: input.cadenceType, everyMinutes: input.everyMinutes || null,
    dailyTime: input.dailyTime || null, runAt: input.runAt || null, estimateMinutes: input.estimateMinutes || null,
    enabled: input.enabled !== false, nextRunAt: null, lastRunAt: null, createdBy: input.createdBy || "user", createdAt: Date.now(),
  };
  r.nextRunAt = r.enabled ? computeNextRun(r) : null;
  state.routines.set(r.id, r);
  persistRoutine(r);
  bus.emit("routine", serializeRoutine(r));
  return r;
}
export function updateRoutine(id, patch) {
  const r = state.routines.get(id);
  if (!r) return null;
  Object.assign(r, patch);
  if ("enabled" in patch || "cadenceType" in patch || "everyMinutes" in patch || "dailyTime" in patch || "runAt" in patch) {
    r.nextRunAt = r.enabled ? computeNextRun(r) : null;
  }
  persistRoutine(r);
  bus.emit("routine", serializeRoutine(r));
  return r;
}
export function markRoutineRan(id) {
  const r = state.routines.get(id);
  if (!r) return;
  r.lastRunAt = Date.now();
  if (r.cadenceType === "once") { r.enabled = false; r.nextRunAt = null; }
  else r.nextRunAt = computeNextRun(r);
  persistRoutine(r);
  bus.emit("routine", serializeRoutine(r));
}
export function deleteRoutine(id) {
  if (!state.routines.has(id)) return false;
  state.routines.delete(id);
  if (pool) pool.query("DELETE FROM routines WHERE id=$1", [id]).catch(() => {});
  bus.emit("routine", { id, deleted: true });
  return true;
}

/* ---------- issues (raised to the Group CTO) ---------- */
export const getIssues = () => state.issues.filter((i) => !i.resolved);
export function createIssue({ kind, title, detail, taskId, agentId }) {
  // Dedupe: one open issue per kind+title (don't spam 100 identical quota errors).
  const existing = state.issues.find((i) => !i.resolved && i.kind === kind && i.title === title);
  if (existing) return existing;
  const issue = { id: randomUUID(), kind, title, detail: detail || "", taskId: taskId || null, agentId: agentId || null, resolved: false, createdAt: Date.now() };
  state.issues.unshift(issue);
  if (state.issues.length > 200) state.issues.length = 200;
  persistIssue(issue);
  bus.emit("issue", serializeIssue(issue));
  return issue;
}
export function resolveIssue(id) {
  const idx = state.issues.findIndex((x) => x.id === id);
  if (idx < 0) return false;
  state.issues.splice(idx, 1); // dismiss = delete permanently
  if (pool) pool.query("DELETE FROM issues WHERE id=$1", [id]).catch((e) => console.error("[store] resolveIssue DB", e.message));
  bus.emit("issue", { id, resolved: true });
  return true;
}
export function deleteIssuesForTask(taskId) {
  const removed = state.issues.filter((i) => i.taskId === taskId);
  if (!removed.length) return;
  state.issues = state.issues.filter((i) => i.taskId !== taskId);
  if (pool) pool.query("DELETE FROM issues WHERE task_id=$1", [taskId]).catch(() => {});
  for (const i of removed) bus.emit("issue", { id: i.id, resolved: true });
}
export function clearIssues() {
  const n = state.issues.length;
  state.issues = [];
  if (pool) pool.query("DELETE FROM issues").catch((e) => console.error("[store] clearIssues DB", e.message));
  bus.emit("issuesReset", []);
  return n;
}

/* ---------- documents (deliverables) ---------- */
export const getDocument = (id) => state.documents.find((d) => d.id === id);
// Update the task's existing document in place (same project/thread), or create
// it if this is the first deliverable. Keeps follow-ups in one thread.
export function upsertDocument({ taskId, title, prompt, department, agentId, content }) {
  const existing = taskId ? state.documents.find((d) => d.taskId === taskId) : null;
  if (!existing) return createDocument({ taskId, title, prompt, department, agentId, content });
  Object.assign(existing, { title, prompt: prompt || existing.prompt, content, createdAt: Date.now() });
  state.documents = [existing, ...state.documents.filter((d) => d.id !== existing.id)];
  persistDocument(existing);
  bus.emit("document", serializeDocMeta(existing));
  return existing;
}
export function createDocument({ taskId, title, prompt, department, agentId, content }) {
  const doc = {
    id: randomUUID(), taskId: taskId || null, title, prompt: prompt || "",
    department: department || null, agentId: agentId || null, content: content || "",
    createdAt: Date.now(),
  };
  state.documents.unshift(doc);
  if (state.documents.length > 400) state.documents.length = 400;
  persistDocument(doc);
  bus.emit("document", serializeDocMeta(doc));
  return doc;
}

export function deleteDocument(id) {
  const i = state.documents.findIndex((d) => d.id === id);
  if (i < 0) return false;
  state.documents.splice(i, 1);
  if (pool) pool.query("DELETE FROM documents WHERE id=$1", [id]).catch(() => {});
  bus.emit("document", { id, deleted: true });
  return true;
}

/* ---------- memory (rolling knowledge base per department) ---------- */
export const getMemoryText = (scope) => state.memory.get(scope)?.content || "";

/* ---------- semantic memory (RAG) ---------- */
const MEM_STOP = new Set("this that these those with from your you our their have been will would should could about into over under more most very just than then them they what task agent provide using used make made create build report note notes work done complete completed result the and for".split(" "));
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

// Store a memory note with its (optional) embedding for later semantic recall.
export function addMemoryNote(scope, text, taskId = null, embedding = null) {
  const note = { id: randomUUID(), scope, text: String(text).slice(0, 1000), taskId, createdAt: Date.now(), embedding: Array.isArray(embedding) ? embedding : null };
  state.memNotes.push(note);
  // Keep memory bounded per scope (most recent 400 notes).
  const same = state.memNotes.filter((n) => n.scope === scope);
  if (same.length > 400) { const drop = same[0]; state.memNotes = state.memNotes.filter((n) => n.id !== drop.id); if (pool) pool.query("DELETE FROM mem_notes WHERE id=$1", [drop.id]).catch(() => {}); }
  if (pool) pool.query(
    "INSERT INTO mem_notes (id,scope,text,embedding,task_id,created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING",
    [note.id, scope, note.text, note.embedding ? JSON.stringify(note.embedding) : null, taskId, new Date(note.createdAt)]
  ).catch((e) => console.error("[store] addMemoryNote", e.message));
  return note;
}

// Keyword + recency retrieval over the per-department blob (fallback path).
function recallByKeyword(scope, query = "", limit = 8) {
  const m = state.memory.get(scope);
  if (!m || !m.content) return "";
  const notes = m.content.split("\n").map((s) => s.trim()).filter(Boolean);
  if (notes.length <= limit) return notes.join("\n");
  const words = [...new Set(String(query).toLowerCase().match(/[a-z0-9]{4,}/g) || [])].filter((w) => !MEM_STOP.has(w));
  const scored = notes.map((n, i) => ({ n, i, rel: words.reduce((s, w) => s + (n.toLowerCase().includes(w) ? 1 : 0), 0) }));
  scored.sort((a, b) => b.rel - a.rel || b.i - a.i);
  return scored.slice(0, limit).sort((a, b) => a.i - b.i).map((s) => s.n).join("\n");
}

// Semantic recall: rank a scope's notes by cosine similarity to the query
// embedding (with a light recency tiebreak). Falls back to keyword/recency when
// embeddings aren't available. `queryEmbedding` is computed by the caller.
export function recallMemory(scope, query = "", queryEmbedding = null, limit = 8) {
  const out = [];
  const seen = new Set();
  const add = (t) => { const k = String(t).replace(/^-\s*/, "").trim().toLowerCase(); if (k && !seen.has(k) && out.length < limit) { seen.add(k); out.push(String(t).replace(/^-\s*/, "").trim()); } };
  // 1) Semantic: rank embedded notes by cosine similarity (+ light recency).
  const notes = state.memNotes.filter((n) => n.scope === scope && Array.isArray(n.embedding));
  if (queryEmbedding && notes.length) {
    const minT = Math.min(...notes.map((n) => n.createdAt));
    const span = (Math.max(...notes.map((n) => n.createdAt)) - minT) || 1;
    notes.map((n) => { const c = cosine(queryEmbedding, n.embedding); return { n, c, s: c + 0.04 * ((n.createdAt - minT) / span) }; })
      .filter((x) => x.c >= 0.25) // drop clearly-unrelated notes
      .sort((a, b) => b.s - a.s).slice(0, limit).forEach((x) => add(x.n.text));
  }
  // 2) Fill remaining slots from the legacy blob (keyword/recency), de-duped —
  //    so pre-RAG memory and sparse scopes still contribute.
  if (out.length < limit) recallByKeyword(scope, query, limit).split("\n").forEach(add);
  return out.join("\n");
}
export function deleteMemory(scope) {
  if (!state.memory.has(scope)) return false;
  state.memory.delete(scope);
  if (pool) pool.query("DELETE FROM memory WHERE scope=$1", [scope]).catch(() => {});
  bus.emit("memory", { scope, deleted: true });
  return true;
}
export function upsertMemory(scope, { title, content, updatedBy }) {
  let m = state.memory.get(scope);
  if (!m) { m = { scope, title: title || scope, content: content || "", updatedAt: Date.now(), updatedBy: updatedBy || "system" }; state.memory.set(scope, m); }
  else { if (title) m.title = title; m.content = content; m.updatedAt = Date.now(); m.updatedBy = updatedBy || m.updatedBy; }
  if (m.content.length > 4000) m.content = m.content.slice(m.content.length - 4000); // keep recent
  persistMemory(m);
  bus.emit("memory", serializeMemory(m));
  return m;
}
export function appendMemory(scope, line, title, updatedBy) {
  const cur = getMemoryText(scope);
  return upsertMemory(scope, { title, content: (cur ? cur + "\n" : "") + line, updatedBy });
}

/* ---------- mutations (memory + persist + emit) ---------- */
export function setAgent(id, patch) {
  const a = state.agents.get(id);
  if (!a) return;
  Object.assign(a, patch);
  persistAgent(a);
  bus.emit("agent", serializeAgent(a));
  return a;
}

export function addEvent({ kind, text, agentId = null, taskId = null }) {
  const ev = { id: eventSeq++, ts: Date.now(), kind, text, agentId, taskId };
  state.events.unshift(ev);
  if (state.events.length > MAX_EVENTS) state.events.length = MAX_EVENTS;
  persistEvent(ev);
  bus.emit("event", ev);
  return ev;
}

// Full activity history for one task (every event incl. agent-to-agent
// communication), from the DB so it isn't limited by the in-memory cap.
export async function getEventsForTask(taskId) {
  if (pool) {
    try {
      const { rows } = await pool.query("SELECT id, ts, kind, text, agent_id FROM events WHERE task_id=$1 ORDER BY id", [taskId]);
      return rows.map((r) => ({ id: `db${r.id}`, ts: new Date(r.ts).getTime(), kind: r.kind, text: r.text, agentId: r.agent_id, taskId }));
    } catch (e) { console.error("[store] getEventsForTask", e.message); }
  }
  return state.events.filter((e) => e.taskId === taskId).slice().reverse();
}

export function createTask({ title, prompt, department = null, assignedTo = null, createdBy = "user", priorWork = null, parentId = null, mission = null, isPlan = false, priority = "normal", dependsOn = [] }) {
  const task = {
    id: randomUUID(),
    title: String(title).slice(0, 120),
    prompt: String(prompt || title).slice(0, 4000),
    department: department || null,
    assignedTo: assignedTo || null,
    status: "queued",
    result: null,
    reviewNotes: null,
    attempts: 0,
    createdBy,
    priorWork: priorWork || null,
    parentId: parentId || null,
    mission: mission || null,
    isPlan: !!isPlan,
    priority: ["high", "normal", "low"].includes(priority) ? priority : "normal",
    dependsOn: Array.isArray(dependsOn) ? dependsOn : [],
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
  };
  state.tasks.set(task.id, task);
  persistTask(task);
  bus.emit("task", serializeTask(task));
  pruneTasks();
  return task;
}

// Keep memory bounded: drop the oldest finished tasks once we exceed a cap.
function pruneTasks() {
  const MAX = 150, KEEP = 100;
  if (state.tasks.size <= MAX) return;
  const finished = [...state.tasks.values()]
    .filter((t) => t.status === "done" || t.status === "failed")
    .sort((a, b) => a.createdAt - b.createdAt);
  let toRemove = state.tasks.size - KEEP;
  for (const t of finished) {
    if (toRemove-- <= 0) break;
    state.tasks.delete(t.id);
    if (pool) pool.query("DELETE FROM tasks WHERE id=$1", [t.id]).catch(() => {});
    bus.emit("task", { id: t.id, deleted: true });
  }
}

export function updateTask(id, patch) {
  const t = state.tasks.get(id);
  if (!t) return;
  Object.assign(t, patch);
  persistTask(t);
  bus.emit("task", serializeTask(t));
  return t;
}

export function deleteTask(id) {
  const t = state.tasks.get(id);
  if (!t) return false;
  state.tasks.delete(id);
  deleteAttachmentsForTask(id);
  deleteIssuesForTask(id);
  deleteCredentialsForTask(id);
  if (pool) pool.query("DELETE FROM tasks WHERE id=$1", [id]).catch((e) => console.error("[store] deleteTask DB", e.message));
  bus.emit("task", { id, deleted: true });
  return true;
}

// Bulk clear. Never removes tasks an agent is actively working (in_progress/
// review). Broadcasts the remaining list so clients replace in one frame.
export function clearTasks(scope = "done") {
  const match = (t) => {
    if (t.status === "in_progress" || t.status === "review") return false;
    if (scope === "auto") return t.createdBy !== "user";
    if (scope === "done") return t.status === "done" || t.status === "failed";
    if (scope === "all") return true;
    return false;
  };
  const ids = getTasks().filter(match).map((t) => t.id);
  for (const id of ids) {
    state.tasks.delete(id);
    deleteAttachmentsForTask(id);
    deleteIssuesForTask(id);
    if (pool) pool.query("DELETE FROM tasks WHERE id=$1", [id]).catch(() => {});
  }
  if (ids.length) bus.emit("tasksReset", getTasks().map(serializeTask));
  return ids.length;
}
