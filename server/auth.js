// Single-user auth: credentials from env, a signed httpOnly session cookie.

import { timingSafeEqual } from "node:crypto";
import { AUTH_USERNAME, AUTH_PASSWORD, COOKIE_NAME } from "./config.js";

const SESSION_VALUE = "authed";
const COOKIE_OPTS = {
  signed: true,
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 7, // 7 days
};

function safeEq(a, b) {
  const ba = Buffer.from(a || "");
  const bb = Buffer.from(b || "");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function verifyCredentials(username, password) {
  return safeEq(username, AUTH_USERNAME) && safeEq(password, AUTH_PASSWORD);
}

export function setSession(reply) {
  reply.setCookie(COOKIE_NAME, SESSION_VALUE, COOKIE_OPTS);
}
export function clearSession(reply) {
  reply.clearCookie(COOKIE_NAME, { path: "/" });
}

// For normal HTTP requests (Fastify decorates req.unsignCookie via @fastify/cookie).
export function isAuthed(req) {
  const raw = req.cookies?.[COOKIE_NAME];
  if (!raw) return false;
  const r = req.unsignCookie(raw);
  return r.valid && r.value === SESSION_VALUE;
}

// For the WS upgrade, where we only have the raw Cookie header + the fastify
// instance to unsign with.
export function isAuthedFromHeader(cookieHeader, fastify) {
  if (!cookieHeader) return false;
  const map = {};
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    map[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  const raw = map[COOKIE_NAME];
  if (!raw) return false;
  const r = fastify.unsignCookie(raw);
  return r.valid && r.value === SESSION_VALUE;
}

export function loginPage({ error = "", next = "/" } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Mission Control — Sign in</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:'JetBrains Mono',ui-monospace,monospace;
    background:radial-gradient(120% 90% at 50% -10%,#0e1430,#0a0e1a 60%);color:#cfe3d8}
  .card{width:320px;background:#0c1226;border:1px solid #1a2440;border-radius:14px;padding:26px 22px;box-shadow:0 20px 60px #0006}
  .brand{font-weight:800;letter-spacing:2px;color:#e8edff;font-size:18px;text-align:center;margin-bottom:2px}
  .sub{text-align:center;color:#5e7088;font-size:11px;margin-bottom:20px;letter-spacing:1px}
  label{display:block;font-size:10px;letter-spacing:1px;color:#8aa0c0;margin:12px 0 5px}
  input{width:100%;padding:10px 12px;border-radius:8px;border:1px solid #243358;background:#070a14;color:#e8edff;font-family:inherit;font-size:13px}
  input:focus{outline:none;border-color:#a855f7}
  button{width:100%;margin-top:18px;padding:11px;border:none;border-radius:8px;cursor:pointer;font-weight:700;letter-spacing:1px;
    background:#a855f7;color:#0b1020;font-family:inherit}
  button:hover{filter:brightness(1.1)}
  .err{margin-top:14px;color:#fca5b5;font-size:11px;text-align:center}
  .octo{font-size:30px;text-align:center}
</style></head><body>
  <form class="card" method="post" action="/api/login">
    <div class="octo">🐙</div>
    <div class="brand">MISSION CONTROL</div>
    <div class="sub">AGENT OFFICE</div>
    <input type="hidden" name="next" value="${escapeHtml(next)}"/>
    <label>USERNAME</label>
    <input name="username" autocomplete="username" autofocus required/>
    <label>PASSWORD</label>
    <input name="password" type="password" autocomplete="current-password" required/>
    <button type="submit">SIGN IN</button>
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ""}
  </form>
</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
