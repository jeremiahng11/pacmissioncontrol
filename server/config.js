// Central env/config. Secrets come from the environment (.env locally,
// Render env vars in prod). Sensible dev defaults so it boots out of the box.

export const PORT = Number(process.env.PORT || 3000);
export const HOST = "0.0.0.0";

export const SESSION_SECRET =
  process.env.SESSION_SECRET || "dev-insecure-change-me-please-32+chars";
export const AUTH_USERNAME = process.env.AUTH_USERNAME || "admin";
export const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "admin";
export const COOKIE_NAME = "mc_session";

export const DATABASE_URL = process.env.DATABASE_URL || "";

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
// Flash has a free tier; Pro is paid-only (free-tier limit is 0). Default to
// Flash so it works without billing. Set GEMINI_MODEL=gemini-2.5-pro only if
// billing is enabled on the key's Google Cloud project.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
// No key -> the office still runs, with simulated deliverables.
export const SIMULATE = !GEMINI_API_KEY;

export const TICK_MS = Number(process.env.TICK_MS || 1500);
// OFF by default: the office only works on tasks YOU assign. Flip on with the
// AUTO button (or AUTONOMOUS=true) for the self-running demo. Keeping it off
// also avoids continuous paid Gemini calls when the app is left running.
export const AUTONOMOUS_DEFAULT = process.env.AUTONOMOUS === "true";

export const IS_PROD = process.env.NODE_ENV === "production";

if (IS_PROD && (AUTH_PASSWORD === "admin" || SESSION_SECRET.startsWith("dev-"))) {
  console.warn(
    "[mission-control] WARNING: default AUTH_PASSWORD/SESSION_SECRET in production — set them in env."
  );
}
