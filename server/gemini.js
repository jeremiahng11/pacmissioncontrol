// Gemini Flash integration. Each worker executes its task via Gemini using its
// persona; the CTO reviews the deliverable and can generate fresh work. If no
// GEMINI_API_KEY is set, everything degrades to a believable simulation so the
// office still runs end-to-end.

import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY, GEMINI_MODEL } from "./config.js";

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
export const usingGemini = !!ai;

function isRateLimit(msg) {
  return msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota");
}

const TIMEOUT_MS = 60000; // a hung/slow call must not freeze an agent forever

async function generate(system, prompt, { json = false, temperature = 0.7, model } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await Promise.race([
        ai.models.generateContent({
          model: model || GEMINI_MODEL,
          contents: prompt,
          config: {
            systemInstruction: system,
            temperature,
            ...(json ? { responseMimeType: "application/json" } : {}),
          },
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Gemini request timed out")), TIMEOUT_MS)),
      ]);
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

const SIM = {
  observatory: ["scan the data streams", "chart the latest signals", "log the night readings"],
  security: ["sweep the perimeter", "audit the access logs", "run a vulnerability pass"],
  research_lab: ["draft the weekly brief", "summarize the findings", "polish the report"],
  development: ["refactor the module", "fix the failing build", "prototype the feature"],
  admin: ["index the records", "back up the archive", "reconcile the ledgers"],
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* Worker performs the task, building on the department's memory.
   model=null (or no key) => simulated path: no API call, no cost. */
export async function runWork(agent, task, memoryText = "", model = null, priorWork = null) {
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
    ? `\n\nPREVIOUS ATTEMPT (this was incomplete — CONTINUE from it: keep what's good, fix the gaps, and deliver the COMPLETE result):\n${priorWork}`
    : "";
  const out = await generate(
    `${agent.persona} Write a clear, well-structured deliverable in Markdown. Start with a "# Title" heading, then a short intro. Use ## / ### section headings, and a dedicated subsection per item (e.g. one per company/option) covering its details. When comparing things, include a Markdown table. Be thorough and specific, not terse. ` +
      `IMPORTANT: You output the DOCUMENT CONTENT as Markdown — the app converts it to a downloadable Word (.doc) file automatically, so if the task asks for a "doc"/"Word"/"PDF", just write the well-formatted Markdown content. Never say you cannot create files or attach a document. ` +
      `No preamble like "Here is" — start directly with the title heading.`,
    `TASK: ${task.title}\n\nDETAILS:\n${task.prompt}${memBlock}${priorBlock}`,
    { model }
  );
  return out || `Done: ${task.title}.`;
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
  if (!ai || !model) {
    await wait(400 + Math.random() * 500);
    return { complete: true, note: !model ? "demo" : "approved (sim)" };
  }
  const txt = await generate(
    "You are JAY JAY, the CTO, reviewing a deliverable. The deliverable is Markdown TEXT; the user can download it as a Word (.doc) file from the app. " +
      "Judge ONLY whether the CONTENT substantively completes the task. Do NOT reject it for file format, for \"not being a .doc/.pdf/Word file\", or for being text — formatting/export is handled by the app. " +
      "Approve (complete=true) unless the content is clearly wrong, off-topic, or materially incomplete. Respond ONLY as JSON: {\"complete\": boolean, \"note\": string up to 12 words}.",
    `TASK: ${task.title}\nDETAILS: ${task.prompt}\n\nDELIVERABLE:\n${result}`,
    { json: true, temperature: 0.2, model }
  );
  try {
    const p = JSON.parse(txt);
    return { complete: !!p.complete, note: String(p.note || "").slice(0, 120) || "reviewed" };
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
