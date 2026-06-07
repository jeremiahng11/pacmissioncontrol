// Gemini Flash integration. Each worker executes its task via Gemini using its
// persona; the CTO reviews the deliverable and can generate fresh work. If no
// GEMINI_API_KEY is set, everything degrades to a believable simulation so the
// office still runs end-to-end.

import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY, GEMINI_FLASH_API_KEY, GEMINI_MODEL, GEMINI_FLASH_MODEL, GEMINI_EMBED_MODEL } from "./config.js";
import { executeTool } from "./tools.js";
import { addEvent, recordUsage } from "./store.js";
import { AGENT_DEFS } from "./agents.js";

const AGENT_BY_DEPT = Object.fromEntries(AGENT_DEFS.map((a) => [a.department, a]));

// Two clients so Pro and Flash can bill on separate keys. Flash falls back to
// the Pro key if no separate Flash key is set. Calls route by model name.
const aiPro = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
const aiFlash = GEMINI_FLASH_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_FLASH_API_KEY }) : aiPro;
const clientFor = (model) => (/flash/i.test(model || "") ? aiFlash : aiPro) || aiPro;
const ai = aiPro; // back-compat: presence check / default
export const usingGemini = !!aiPro;

function isRateLimit(msg) {
  return msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota");
}

// Generous so big Pro generations / follow-ups don't time out; still bounded so
// a hung call can't freeze an agent forever. Override with GEMINI_TIMEOUT_MS.
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 150000);

// Errors that mean "this model/key can't serve the request" — quota, billing,
// bad model, permission. For these we fall back from Pro to Flash so the office
// keeps working instead of blocking.
const FALLBACKABLE = (msg) =>
  /429|RESOURCE_EXHAUSTED|quota|limit:\s*0|PerDay|FreeTier|not found|INVALID_ARGUMENT|unexpected model|unsupported|PERMISSION_DENIED|\b40[13]\b/i.test(msg);
let lastFallbackNote = 0;
function noteFallback(fromModel, msg) {
  console.warn(`[gemini] ${fromModel} failed (${String(msg).slice(0, 80)}) — falling back to ${GEMINI_FLASH_MODEL}`);
  const now = Date.now();
  if (now - lastFallbackNote > 60000) { // throttle the user-facing notice
    lastFallbackNote = now;
    try { addEvent({ kind: "system", text: `⚠️ Pro (${GEMINI_MODEL}) unavailable — falling back to ${GEMINI_FLASH_MODEL}. Enable billing on the Pro key for full quality.` }); } catch {}
  }
}
const canFallback = (model, msg) => !/flash/i.test(model || "") && !!aiFlash && !!GEMINI_FLASH_MODEL && FALLBACKABLE(msg);

async function callModel(system, prompt, { json = false, temperature = 0.7, model, media } = {}) {
  const contents = media && media.length
    ? [{ role: "user", parts: [{ text: prompt }, ...media.map((m) => ({ inlineData: { mimeType: m.mimeType, data: m.data } }))] }]
    : prompt;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await Promise.race([
        clientFor(model || GEMINI_MODEL).models.generateContent({
          model: model || GEMINI_MODEL,
          contents,
          config: {
            systemInstruction: system,
            temperature,
            ...(json ? { responseMimeType: "application/json" } : {}),
          },
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Gemini request timed out")), TIMEOUT_MS)),
      ]);
      try { recordUsage(model || GEMINI_MODEL, res.usageMetadata); } catch {}
      return (res.text || "").trim();
    } catch (e) {
      const msg = e?.message || String(e);
      // Retry once on transient per-minute rate limits (helps Flash free tier).
      // Skip retry on hard caps (limit:0 / per-day) — retrying just wastes time.
      const hardCap = /limit:\s*0|PerDay|per day|FreeTier/i.test(msg);
      if (attempt === 0 && isRateLimit(msg) && !hardCap) {
        const m = msg.match(/retry in ([\d.]+)s/i) || msg.match(/"retryDelay":\s*"(\d+)s"/);
        const delay = Math.min(20000, Math.max(3000, (m ? parseFloat(m[1]) : 6) * 1000));
        await wait(delay);
        continue;
      }
      throw e;
    }
  }
}

// Wrapper: run on the requested model; if Pro hits quota/billing/availability,
// transparently retry on Flash so work keeps flowing.
async function generate(system, prompt, opts = {}) {
  const model = opts.model || GEMINI_MODEL;
  try {
    return await callModel(system, prompt, { ...opts, model });
  } catch (e) {
    const msg = e?.message || String(e);
    if (canFallback(model, msg)) { noteFallback(model, msg); return await callModel(system, prompt, { ...opts, model: GEMINI_FLASH_MODEL }); }
    throw e;
  }
}

// Tool-use loop: lets an agent call tools (e.g. http_request to test an API),
// feeding results back until it produces the final deliverable.
const withTimeout = (p, ms = TIMEOUT_MS) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Gemini request timed out")), ms))]);
async function toolLoop(system, prompt, { model, media, tools, toolCtx }) {
  const parts = [{ text: prompt }, ...(media || []).map((m) => ({ inlineData: { mimeType: m.mimeType, data: m.data } }))];
  const contents = [{ role: "user", parts }];
  for (let step = 0; step < 8; step++) {
    const res = await withTimeout(clientFor(model || GEMINI_MODEL).models.generateContent({ model: model || GEMINI_MODEL, contents, config: { systemInstruction: system, temperature: 0.5, tools } }), TIMEOUT_MS);
    try { recordUsage(model || GEMINI_MODEL, res.usageMetadata); } catch {}
    const calls = res.functionCalls;
    if (!calls || !calls.length) return (res.text || "").trim();
    contents.push({ role: "model", parts: calls.map((c) => ({ functionCall: { name: c.name, args: c.args || {} } })) });
    const responseParts = [];
    for (const c of calls) {
      const result = await executeTool(c.name, c.args || {}, toolCtx);
      responseParts.push({ functionResponse: { name: c.name, response: result } });
    }
    contents.push({ role: "user", parts: responseParts });
  }
  contents.push({ role: "user", parts: [{ text: "Wrap up now and produce the final deliverable from what you gathered." }] });
  const final = await withTimeout(clientFor(model || GEMINI_MODEL).models.generateContent({ model: model || GEMINI_MODEL, contents, config: { systemInstruction: system } }), TIMEOUT_MS);
  try { recordUsage(model || GEMINI_MODEL, final.usageMetadata); } catch {}
  return (final.text || "").trim();
}

// Same Pro->Flash fallback for the tool-using path (Development agents).
async function generateWithTools(system, prompt, opts = {}) {
  const model = opts.model || GEMINI_MODEL;
  try {
    return await toolLoop(system, prompt, { ...opts, model });
  } catch (e) {
    const msg = e?.message || String(e);
    if (canFallback(model, msg)) { noteFallback(model, msg); return await toolLoop(system, prompt, { ...opts, model: GEMINI_FLASH_MODEL }); }
    throw e;
  }
}

// Handoff: one agent consults another department's specialist mid-task and gets
// a concise answer to fold into its own deliverable.
export async function consultAgent(department, question, model = null) {
  const def = AGENT_BY_DEPT[department];
  if (!ai || !model) return `(${def?.name || department} is unavailable; proceeding without their input.)`;
  const persona = def?.persona || "You are a helpful specialist.";
  try {
    return await generate(
      `${persona} A teammate has asked for your expert input on their task. Answer concisely and practically — a few sentences or a short list — focused on exactly what they need. No preamble.`,
      String(question || "").slice(0, 4000),
      { model, temperature: 0.4 }
    );
  } catch (e) {
    return `(${def?.name || department} couldn't respond: ${e.message})`;
  }
}

// Embed text for semantic memory (RAG). Uses the Flash key (cheap). Returns a
// vector, or null if embeddings are unavailable (callers fall back to keywords).
export async function embed(text) {
  const client = aiFlash || aiPro;
  if (!client) return null;
  try {
    const res = await withTimeout(client.models.embedContent({ model: GEMINI_EMBED_MODEL, contents: String(text || "").slice(0, 8000) }), 20000);
    const v = res?.embeddings?.[0]?.values || res?.embedding?.values || res?.embeddings?.values || null;
    return Array.isArray(v) && v.length ? v : null;
  } catch (e) {
    console.warn("[gemini] embed failed:", e?.message);
    return null;
  }
}

const SIM = {
  observatory: ["scan the data streams", "chart the latest signals", "log the night readings"],
  security: ["sweep the perimeter", "audit the access logs", "run a vulnerability pass"],
  research_lab: ["draft the weekly brief", "summarize the findings", "polish the report"],
  development: ["refactor the module", "fix the failing build", "prototype the feature"],
  admin: ["index the records", "back up the archive", "reconcile the ledgers"],
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const DESIGN_BAR =
  "DESIGN BAR — match top fintech apps (Revolut / Wise / Monzo). A static, rough, or incomplete result FAILS the bar.\n" +
  "- VISUAL: deliberate colour palette, gradients, soft shadows, generous spacing, clear type hierarchy, rounded corners, consistent inline-SVG/emoji icons. No overlapping/clipped text — check every label fits.\n" +
  "- ANIMATION & TRANSITIONS (REQUIRED — not optional): animated screen-to-screen transitions (slide or fade) as the user moves through the flow; button press feedback (scale/opacity); input focus styles; staggered entrance animations for cards & list items; an animated success checkmark on completion/activation; a card reveal on activation; loading/skeleton states where data 'loads'; and smooth value changes (e.g. balance count-up). Drive them with CSS transitions/keyframes + a little JS. It must feel alive and fluid, NOT a static screenshot.\n" +
  "- MOBILE: the app IS the mobile screen — it fills the viewport (responsive, safe-area padding) and looks like the real running app on a phone. NO decorative phone/device frame, bezel, notch, or fake status bar. (On wide desktop you MAY centre it in a plain mobile-width column ~430px, with no device chrome.)\n" +
  "- REALISTIC CARD: gradient background; a gold EMV chip drawn as a small rounded rect with 3-4 thin contact lines (NOT a plain block); a contactless/wifi glyph; the card number as masked dots grouped in 4s ending with 4 real digits; CARD HOLDER name; EXPIRES mm/yy; and the network mark rendered as CLEAN STYLED TEXT — e.g. a bold italic 'VISA' in a sans-serif with letter-spacing — do NOT hand-draw the Visa/Mastercard logo as a complex SVG (it comes out garbled and overlapping). Card aspect ratio ~1.586:1.\n" +
  "- COMPLETE FLOW: build EVERY screen the task implies, in full, with real working navigation between them — do NOT stop after the home/dashboard screen. If the task lists steps (welcome → sign-up/OTP → KYC → account/currency setup → card application → CARD ACTIVATION (show the card + an Activate action + success animation) → set PIN → wallet home → top-up), implement EACH as its own screen. Never skip the activation or success screens. No broken image links — inline SVG, CSS gradients, or emoji only.";
const ENG_MULTI =
  "ENGINEERING: Write the FULL project — every file complete, no placeholders, no \"...\". Split into PROPER, separate files (do NOT cram everything into one file). Output EACH file as a marker line \"===== FILE: relative/path.ext =====\" immediately followed by its fenced code block, so it packages into a downloadable .zip with the correct folder structure. Every import / link / href / src / path MUST use the exact file names and resolve. Include a README.md with exact run instructions. Keep prose to a one-line intro; the deliverable is the project.";
// The #1 reason generated UIs look broken: inventing Tailwind colour/font
// utilities (text-brand-blue, bg-primary) without configuring them — Tailwind
// silently ignores them and the page renders unstyled.
const STYLING_RULES =
  "STYLING — READ CAREFULLY (this is the #1 thing that makes generated UIs look broken, so get it right):\n" +
  "- A Tailwind class for a CUSTOM colour/font (e.g. text-brand-blue, bg-primary, text-text-secondary) does NOTHING unless you define it. If you use the Tailwind CDN with ANY custom token, you MUST add this BEFORE using it: <script>tailwind.config={theme:{extend:{colors:{ /* every custom colour you reference */ }, fontFamily:{ /* custom fonts */ }}}}</script>. Undefined utilities are silently dropped and the UI looks unstyled.\n" +
  "- SAFEST APPROACH (prefer this): write your visual design as real CSS classes in css/styles.css (e.g. .btn-primary, .card, .screen) using CSS variables — and apply THOSE class names in the HTML. Use Tailwind only for layout/spacing with its BUILT-IN classes (flex, p-4, rounded-2xl, text-slate-900). Do NOT reference a CSS variable via a made-up Tailwind class name.\n" +
  "- NEVER mix the two by mistake: if css defines --text-primary, the HTML must use color:var(--text-primary) (or a real .class), NOT a class called text-text-primary.\n" +
  "- Final self-check: every class in the HTML is either a real Tailwind built-in OR defined in tailwind.config OR a class you wrote in styles.css. No invented utilities.";
const STACK_GUIDE = {
  django: "Stack: Django (Python). Deliver manage.py, the project package (settings.py with INSTALLED_APPS, urls.py, wsgi.py), app(s) with models.py / views.py / urls.py / admin.py, templates/ and static/ (css, js) for the UI, requirements.txt, and README.md (venv, pip install, migrate, runserver).",
  node: "Stack: Node.js. Deliver package.json (scripts + deps), an Express or Fastify server, routes, and a front-end (server-rendered views or a public/ folder with separate html/css/js), plus README.md (npm install, npm start).",
  flutter: "Stack: Flutter (Dart), Material 3. Deliver pubspec.yaml, lib/main.dart, and lib/ split into screens & widgets, plus README.md (flutter pub get, flutter run).",
  react: "Stack: React + Vite. Deliver package.json, index.html, vite.config.js, src/main.jsx, src/App.jsx and components in separate files, styling via Tailwind or CSS modules, plus README.md (npm install, npm run dev).",
  "react-native": "Stack: React Native (Expo) + React Navigation. Deliver package.json, App.js, and screens/components in separate files, plus README.md (npm install, npx expo start).",
};

/* Worker performs the task, building on the department's memory.
   model=null (or no key) => simulated path: no API call, no cost. */
export async function runWork(agent, task, memoryText = "", model = null, priorWork = null, media = [], tools = null, toolCtx = null, upstream = [], build = null) {
  if (!ai || !model) {
    await wait(1200 + Math.random() * 1800);
    return !model
      ? `Demo task — ${task.title}.\n\n(Visual demo only; no Gemini call was made.)`
      : `Done: ${task.title}.\n\n(Simulated — set GEMINI_API_KEY for real work.)`;
  }
  // Throws on API error — the orchestrator turns that into a blocked task +
  // an Issue (it must NOT become a "done" deliverable).
  const memBlock = memoryText
    ? `\n\nNOTES FROM EARLIER WORK (build on these, continue and add to them, don't repeat):\n${memoryText}`
    : "";
  const priorBlock = priorWork
    ? `\n\nPREVIOUS DELIVERABLE (continue from it — keep what's good, apply the changes, and return the COMPLETE updated result):\n${String(priorWork).slice(-16000)}`
    : "";
  // On a re-do, the CTO's review note lists the specific gaps to fix.
  const fixBlock = priorWork && task.reviewNotes && task.reviewNotes !== "follow-up requested"
    ? `\n\nThe previous attempt was sent back. FIX THESE GAPS specifically and return the COMPLETE corrected deliverable: ${task.reviewNotes}`
    : "";
  const upstreamBlock = upstream && upstream.length
    ? `\n\nUPSTREAM RESULTS — completed earlier steps you must build on (don't repeat them, continue from them):\n` +
      upstream.map((u) => `### ${u.title}\n${String(u.result).slice(0, 6000)}`).join("\n\n")
    : "";
  const fileBlock = media && media.length
    ? `\n\nThe user ATTACHED ${media.length} file(s) below — read/analyze them and use them to complete the task.`
    : "";
  const isBuild = agent.department === "development";
  const docSystem =
    `${agent.persona} Write a clear, well-structured deliverable in Markdown. Start with a "# Title" heading, then a short intro. Use ## / ### section headings, and a dedicated subsection per item (e.g. one per company/option) covering its details. When comparing things, include a Markdown table. Be thorough and specific, not terse. ` +
    `IMPORTANT: You output the DOCUMENT CONTENT as Markdown — the app converts it to a downloadable Word (.doc) file automatically, so if the task asks for a "doc"/"Word"/"PDF", just write the well-formatted Markdown content. Never say you cannot create files or attach a document. ` +
    `No preamble like "Here is" — start directly with the title heading.`;
  let system = docSystem;
  if (isBuild) {
    const singleRequested = /\b(single|one)[-\s]?(file|html|page)\b|self-?contained|inline (everything|all|css)/i.test(`${task.title} ${task.prompt}`);
    const webStack = new Set(["static", "node", "react", "django"]);
    if (build && build.type === "app") {
      // Full app/platform in the stack Jay Jay recommended — multi-file project.
      const rules = webStack.has(build.stack) ? `\n\n${STYLING_RULES}` : "";
      system = `${agent.persona}\n\nBuild a COMPLETE, RUNNABLE project — production quality, not a prototype.\n${STACK_GUIDE[build.stack] || STACK_GUIDE.node}\n\n${DESIGN_BAR}${rules}\n\n${ENG_MULTI}`;
    } else if (singleRequested) {
      system = `${agent.persona}\n\nBuild a COMPLETE, WORKING, BEAUTIFUL front-end — production quality, not a prototype.\n\n${DESIGN_BAR}\n\n${STYLING_RULES}\n\nENGINEERING: The user asked for a SINGLE file, so deliver one self-contained index.html (inline <style> with your CSS + inline <script>; Tailwind CDN only with a tailwind.config for any custom tokens). Full code, no placeholders. Output it as "===== FILE: index.html =====" then its fenced code block. One-line intro only.`;
    } else {
      // DEFAULT for web: a proper MULTI-FILE project, not one big HTML.
      system = `${agent.persona}\n\nBuild a COMPLETE, WORKING, BEAUTIFUL front-end — production quality, not a prototype.\n\n${DESIGN_BAR}\n\n${STYLING_RULES}\n\nENGINEERING: Build a PROPER MULTI-FILE web project — do NOT cram everything into one HTML. Use separate files: index.html (and any other screens), css/styles.css (your real design classes), js/app.js (split into modules if helpful), and manifest.json for the PWA. Link css/styles.css and js/app.js with their exact paths. ${ENG_MULTI}`;
    }
  }
  const userPrompt = `TASK: ${task.title}\n\nDETAILS:\n${task.prompt}${memBlock}${priorBlock}${fixBlock}${upstreamBlock}${fileBlock}`;

  if (tools && toolCtx) {
    const toolNote = agent.department === "development"
      ? "\n\nTools: request_help (consult another department), http_request (actually call an API to test it — use {{NAME}} placeholders for secrets), request_credentials (ask the human for sandbox keys). Actually run tests with http_request and report real responses; if you lack a credential, call request_credentials. Use request_help when another department's expertise would improve the result."
      : "\n\nTool: request_help — consult another department's specialist when their expertise would genuinely improve your deliverable (e.g. ask Observatory to research something, Development to sanity-check code, Security for a risk check). Use it sparingly, then fold their answer into your work.";
    const out = await generateWithTools(system + toolNote, userPrompt, { model, media, tools, toolCtx });
    return out || `Done: ${task.title}.`;
  }
  const out = await generate(system, userPrompt, { model, media });
  return out || `Done: ${task.title}.`;
}

/* Router: pick the single best department for a task (so "Any" goes to the
   right specialist, not whoever is idle first). Flash classifier + keyword fallback. */
const DEPT_KEYWORDS = {
  development: ["code", "app", "api", "build", "website", "web app", "script", "program", "bug", "deploy", "frontend", "backend", "html", "python", "react", "flutter", "sql", "function", "feature", "prototype", "software", "endpoint", "library"],
  research_lab: ["research", "report", "summary", "summarize", "brief", "write", "article", "analysis", "analyse", "analyze", "compare", "study", "document", "draft", "content", "blog", "whitepaper", "essay", "plan"],
  observatory: ["find", "scan", "monitor", "investigate", "trends", "market", "competitor", "signal", "track", "watch", "discover", "explore", "intelligence", "landscape", "list of", "who are"],
  security: ["security", "vulnerability", "audit", "risk", "compliance", "pentest", "threat", "secure", "privacy", "pdpa", "mas", "encrypt", "exposure", "breach", "hardening"],
  admin: ["organize", "organise", "index", "record", "archive", "reconcile", "ledger", "catalog", "spreadsheet", "inventory", "sort", "categorize", "clean up", "format the data"],
};
function keywordDept(text) {
  const low = String(text).toLowerCase();
  let best = null, bestScore = 0;
  for (const [d, kws] of Object.entries(DEPT_KEYWORDS)) {
    const score = kws.reduce((s, k) => s + (low.includes(k) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return bestScore > 0 ? best : null;
}
export async function classifyDepartment(task, model = null) {
  const text = `${task.title}\n${task.prompt || ""}`;
  if (ai && model) {
    try {
      const txt = await generate(
        "Route this task to the single best department. Reply with ONLY one of these words: observatory (research, monitoring, finding things), research_lab (writing, analysis, reports, plans), development (code, apps, APIs, anything technical), security (security, compliance, risk), admin (organizing, records, structured data).",
        text.slice(0, 1500),
        { model, temperature: 0 }
      );
      const d = String(txt || "").toLowerCase().match(/observatory|research_lab|development|security|admin/);
      if (d) return d[0];
    } catch { /* fall through */ }
  }
  return keywordDept(text);
}

/* Jay Jay decides HOW Development should build: a quick UI mockup (single
   self-contained HTML) vs a full app/platform in a real stack he recommends. */
const BUILD_STACKS = ["static", "django", "node", "flutter", "react", "react-native"];
export async function recommendStack(task, model = null) {
  const text = `${task.title}\n${task.prompt || ""}`;
  const low = text.toLowerCase();
  const explicit = /\bdjango\b/.test(low) ? "django"
    : /\bflutter\b/.test(low) ? "flutter"
    : /(react native|react-native|\bexpo\b)/.test(low) ? "react-native"
    : /\breact\b/.test(low) ? "react"
    : /(node\.?js|express|fastify|next\.?js)/.test(low) ? "node" : null;
  const mockupHint = /(mockup|template|landing page|html template|prototype|single[- ]page|ui kit|design only|just the (ui|design|frontend))/.test(low);
  if (explicit) return { type: "app", stack: explicit, reason: "you named the stack" };
  if (ai && model) {
    try {
      const txt = await generate(
        "You are JAY JAY, the CTO, deciding how Development should build this. Is it a MOCKUP (one self-contained HTML/UI prototype) or a full APP/platform (multi-file project, often with a backend or data)? If a full app, recommend ONE stack: django, node, flutter, react, or react-native. Reply ONLY as JSON: {\"type\":\"mockup\"|\"app\",\"stack\":\"static\"|\"django\"|\"node\"|\"flutter\"|\"react\"|\"react-native\",\"reason\":\"<=12 words\"}. stack is \"static\" only when type is mockup.",
        text.slice(0, 1500),
        { json: true, temperature: 0, model }
      );
      const p = JSON.parse(txt);
      if (p.type === "app" && BUILD_STACKS.includes(p.stack) && p.stack !== "static") return { type: "app", stack: p.stack, reason: String(p.reason || "").slice(0, 80) };
      return { type: "mockup", stack: "static", reason: String(p.reason || "UI mockup").slice(0, 80) };
    } catch { /* fall through */ }
  }
  if (mockupHint) return { type: "mockup", stack: "static", reason: "UI mockup" };
  if (/(full app|platform|backend|rest api|\bapi\b|database|authentication|login system|sign ?up|crud|deploy|server|micro-?service)/.test(low)) return { type: "app", stack: "node", reason: "app with backend" };
  return { type: "mockup", stack: "static", reason: "front-end UI" };
}

/* Planner: Jay Jay breaks a goal into 2-5 department-assignable sub-tasks. */
export async function planTask(task, model = null) {
  const DEPTS = "observatory (Scout — research/monitoring), research_lab (Scribe — writing/analysis), development (Orbit — building/coding/API tests), admin (Vault — records/organizing), security (Warden — security checks)";
  if (!ai || !model) {
    return [{ title: `Work on: ${task.title}`, prompt: task.prompt, department: task.department || null }];
  }
  const txt = await generate(
    `You are JAY JAY, the CTO, planning how to deliver a GOAL with your team. Break it into 2-5 CONCRETE sub-tasks, each assignable to ONE department and completable by one agent in a single shot. ORDER them logically and set dependencies so later steps build on earlier ones (e.g. research before building, build before testing). For each step, "after" is the 0-based index of the earlier step it depends on (so it receives that step's output), or null if it can run independently. Departments: ${DEPTS}. Respond ONLY as JSON: {"subtasks":[{"title":"<=10 words","prompt":"clear instructions","department":"one of: observatory|research_lab|development|admin|security","after":<index or null>}]}.`,
    `GOAL: ${task.title}\n\nDETAILS: ${task.prompt}`,
    { json: true, temperature: 0.4, model }
  );
  const valid = new Set(["observatory", "research_lab", "development", "admin", "security"]);
  try {
    const p = JSON.parse(txt);
    const subs = (p.subtasks || []).filter((s) => s && s.title).slice(0, 6).map((s, i) => ({
      title: String(s.title).slice(0, 80),
      prompt: String(s.prompt || s.title).slice(0, 2000),
      department: valid.has(s.department) ? s.department : (task.department || null),
      after: Number.isInteger(s.after) && s.after >= 0 && s.after < i ? s.after : null, // only depend on earlier steps
    }));
    if (subs.length) return subs;
  } catch { /* fall through */ }
  return [{ title: `Work on: ${task.title}`, prompt: task.prompt, department: task.department || null, after: null }];
}

/* Synthesis: combine the sub-task deliverables into one final deliverable. */
export async function synthesize(task, parts, model = null) {
  const joined = parts.map((p) => `## ${p.title}${p.department ? ` (${p.department})` : ""}\n${p.result || ""}`).join("\n\n---\n\n");
  if (!ai || !model) return `# ${task.title}\n\n${joined}`;
  const out = await generate(
    "You are JAY JAY, the CTO. Assemble the sub-task deliverables below into ONE cohesive final deliverable that fulfils the goal. Markdown, starting with a \"# Title\". RULES: " +
      "(1) Integrate and deduplicate — don't just concatenate. " +
      "(2) PRESERVE ALL CODE EXACTLY as given — keep every \"===== FILE: path =====\" marker and every fenced code block verbatim; never rewrite, summarize, or drop code (the app packages those files into a downloadable .zip). " +
      "(3) Keep tables and data intact. " +
      "(4) End with a \"## Contributors\" section listing which department/agent produced which part (from the sub-task headings). No preamble.",
    `GOAL: ${task.title}\n\nDETAILS: ${task.prompt}\n\nSUB-TASK DELIVERABLES (each headed by the department that produced it):\n${joined.slice(0, 28000)}`,
    { model }
  );
  return out || `# ${task.title}\n\n${joined}`;
}

/* One-line memory note so future related tasks can continue the work. */
export async function summarizeForMemory(agent, task, result, model = null) {
  if (!ai || !model) return `${task.title} — completed.`;
  try {
    const txt = await generate(
      "In ONE short line (max 18 words), note what was done and any key fact worth remembering for future related work. No preamble.",
      `TASK: ${task.title}\nRESULT:\n${result}`,
      { temperature: 0.3, model }
    );
    return (txt || "").replace(/\s+/g, " ").slice(0, 180) || `${task.title} — completed.`;
  } catch {
    return `${task.title} — completed.`;
  }
}

/* CTO reviews the deliverable. Throws on API error (-> Issue); a bad/parse
   response just defaults to approved rather than blocking the pipeline. */
export async function runReview(task, result, model = null) {
  // Deterministic guard: empty / refusal / stub never passes.
  const text = String(result || "").trim();
  if (text.length < 40 || /^(i (can'?t|cannot|am unable|'?m sorry)|as an ai)\b/i.test(text)) {
    return { complete: false, note: "deliverable is empty, a refusal, or far too short" };
  }
  if (!ai || !model) {
    await wait(400 + Math.random() * 500);
    return { complete: true, note: !model ? "demo" : "approved (sim)" };
  }
  const isDev = task.department === "development";
  const txt = await generate(
    "You are JAY JAY, the CTO, doing QA on a deliverable. It's Markdown TEXT that the app exports to .doc/.zip — NEVER reject it for file format or for \"being text\". " +
      "Check three things: (1) it addresses EVERY explicit requirement in the task, (2) it's correct and on-topic, (3) it's specific and real — no placeholders, TODOs, or vague filler. " +
      (isDev ? "For build/code tasks, the deliverable must contain actual code, not just a description. " : "") +
      "Mark complete=false ONLY for MATERIAL problems (a missing requirement, wrong/placeholder content) — not for style or polish. " +
      "Respond ONLY as JSON: {\"complete\": boolean, \"note\": \"if incomplete: the SPECIFIC gaps to fix (<=16 words); if complete: a one-line approval\"}.",
    `TASK: ${task.title}\nDETAILS: ${task.prompt}\n\nDELIVERABLE:\n${result}`,
    { json: true, temperature: 0.2, model }
  );
  try {
    const p = JSON.parse(txt);
    return { complete: !!p.complete, note: String(p.note || "").slice(0, 160) || "reviewed" };
  } catch {
    return { complete: true, note: "approved" };
  }
}

/* CTO invents a department-appropriate task when the queue is empty.
   model=null (AUTO demo without a demo model) uses a canned title — no API. */
export async function generateTask(agent, model = null) {
  if (!ai || !model) {
    const title = pick(SIM[agent.department] || ["run a routine check"]);
    return { title, prompt: `${title}. Provide a brief, useful result.` };
  }
  try {
    const txt = await generate(
      `You are JAY JAY, the CTO, assigning ONE small self-contained task to ${agent.name} (${agent.role}, ${agent.room}). It must be completable by an LLM in a single shot with no external tools. Respond ONLY as JSON: {"title": string up to 8 words, "prompt": string}.`,
      `Assign a useful task to ${agent.name}.`,
      { json: true, temperature: 1.0, model }
    );
    const p = JSON.parse(txt);
    if (p.title && p.prompt) {
      return { title: String(p.title).slice(0, 80), prompt: String(p.prompt).slice(0, 800) };
    }
  } catch {
    /* fall through to sim */
  }
  const title = pick(SIM[agent.department] || ["run a routine check"]);
  return { title, prompt: `${title}. Provide a brief, useful result.` };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
