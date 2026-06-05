// Agent tools (Gemini function-calling). Granted least-privilege per department.
// Development gets http_request (to test APIs) + request_credentials (to ask the
// human for sandbox keys). Network access is SSRF-guarded and secrets are
// substituted server-side via {{NAME}} placeholders and redacted from results.

import { addEvent, createIssue } from "./store.js";

const PRIVATE = /^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|0\.0\.0\.0$|.*\.local$|.*\.internal$)/i;

function urlAllowed(raw) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (!/^https?:$/.test(url.protocol)) return false;
  if (PRIVATE.test(url.hostname)) return false;
  const allow = (process.env.TOOLS_ALLOW_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length && !allow.some((h) => url.hostname === h || url.hostname.endsWith("." + h))) return false;
  return true;
}

export function toolsFor(department) {
  if (department !== "development") return null; // least privilege
  return [{
    functionDeclarations: [
      {
        name: "http_request",
        description: "Call an HTTP API endpoint to test it. For any secret (API key, token), put a {{NAME}} placeholder in the url/headers/body — it's substituted server-side and never exposed. Returns status, headers, and a truncated body.",
        parameters: {
          type: "object",
          properties: {
            method: { type: "string", description: "GET, POST, PUT, PATCH, or DELETE" },
            url: { type: "string" },
            headers: { type: "array", items: { type: "object", properties: { name: { type: "string" }, value: { type: "string" } }, required: ["name", "value"] } },
            body: { type: "string", description: "Request body (e.g. JSON)" },
          },
          required: ["method", "url"],
        },
      },
      {
        name: "request_credentials",
        description: "Ask the human for sandbox credentials you don't have yet. Give the exact names you need and why. Returns whether they are now available.",
        parameters: {
          type: "object",
          properties: {
            names: { type: "array", items: { type: "string" } },
            reason: { type: "string" },
          },
          required: ["names"],
        },
      },
    ],
  }];
}

const subst = (s, creds) => String(s || "").replace(/\{\{(\w+)\}\}/g, (m, k) => (k in creds ? creds[k] : m));
function redact(text, creds) {
  let t = String(text || "");
  for (const v of Object.values(creds)) if (v && v.length >= 4) t = t.split(v).join("«redacted»");
  return t;
}

export async function executeTool(name, args, ctx) {
  if (name === "http_request") return httpRequest(args, ctx);
  if (name === "request_credentials") return requestCredentials(args, ctx);
  return { error: "unknown tool" };
}

async function httpRequest(args, ctx) {
  const creds = ctx.credentials || {};
  const method = String(args.method || "GET").toUpperCase();
  const url = subst(args.url, creds);
  if (!urlAllowed(url)) {
    addEvent({ kind: "tool", text: `⚠️ ${ctx.agentName}: blocked request to ${String(args.url).slice(0, 80)}`, taskId: ctx.taskId, agentId: ctx.agentId });
    return { error: "URL not allowed — must be a public http/https host (private/loopback blocked; optional TOOLS_ALLOW_HOSTS allow-list)." };
  }
  const blob = `${args.url}|${JSON.stringify(args.headers || [])}|${args.body || ""}`;
  const missing = [...new Set([...blob.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].filter((k) => !(k in creds));
  if (missing.length) return { error: "missing_credentials", missing, hint: "Call request_credentials for these names first." };
  const headers = {};
  for (const h of args.headers || []) headers[h.name] = subst(h.value, creds);
  addEvent({ kind: "tool", text: `${ctx.agentName} → ${method} ${url.replace(/\?.*$/, "")}`, taskId: ctx.taskId, agentId: ctx.agentId });
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { method, headers, body: ["GET", "HEAD"].includes(method) ? undefined : subst(args.body, creds), signal: ctrl.signal, redirect: "follow" });
    clearTimeout(to);
    const body = redact((await res.text()).slice(0, 4000), creds);
    const hdrs = {}; res.headers.forEach((v, k) => { hdrs[k] = v; });
    return { status: res.status, ok: res.ok, headers: hdrs, body };
  } catch (e) {
    return { error: "request_failed: " + (e.name === "AbortError" ? "timeout (15s)" : e.message) };
  }
}

function requestCredentials(args, ctx) {
  const names = (args.names || []).map(String);
  const have = ctx.credentials || {};
  const missing = names.filter((n) => !(n in have));
  if (!missing.length) return { available: true, message: "All requested credentials are available — proceed." };
  createIssue({
    kind: "credentials",
    title: `Sandbox credentials needed: ${missing.join(", ")}`,
    detail: `${ctx.agentName} needs these to test the API: ${missing.join(", ")}.\nReason: ${args.reason || "(none given)"}\n\nOpen the task, add them under "Sandbox credentials", then press Continue.`,
    taskId: ctx.taskId, agentId: ctx.agentId,
  });
  return { available: false, missing, message: "Requested from the human — NOT available yet. Produce a clear test plan now and note that live execution is pending these credentials." };
}
