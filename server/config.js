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

// Pro key — used for the heavy, quality-critical work: the agents' deliverables,
// task planning (decomposition) and synthesis.
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
// Optional separate key for Flash calls (review, memory notes, AUTO demo). If
// unset, Flash calls fall back to GEMINI_API_KEY. Lets you bill Pro and Flash
// on different keys/projects.
export const GEMINI_FLASH_API_KEY =
  process.env.GEMINI_FLASH_API_KEY || process.env.FLASH_API_KEY || "";
// Model for the tasks YOU assign (real work) + planning + synthesis. Pro
// requires billing enabled on the key's project (free-tier limit is 0).
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-pro";
// Light model for high-frequency, low-stakes orchestration: review, one-line
// memory notes, and the AUTO demo. Cheap + fast. Set "" to simulate AUTO.
export const GEMINI_FLASH_MODEL = process.env.GEMINI_FLASH_MODEL || "gemini-2.5-flash";
export const GEMINI_DEMO_MODEL = process.env.GEMINI_DEMO_MODEL ?? GEMINI_FLASH_MODEL;
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
