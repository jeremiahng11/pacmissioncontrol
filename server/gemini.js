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

async function generate(system, prompt, { json = false, temperature = 0.7 } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction: system,
          temperature,
          ...(json ? { responseMimeType: "application/json" } : {}),
        },
      });
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

/* Worker performs the task, building on the department's memory. */
export async function runWork(agent, task, memoryText = "") {
  if (!ai) {
    await wait(1200 + Math.random() * 1800);
    const cont = memoryText ? " (continuing from earlier notes)" : "";
    return `Done: ${task.title}${cont}.\n\n(Simulated deliverable — set GEMINI_API_KEY to have ${agent.name} produce real work.)`;
  }
  // Throws on API error — the orchestrator turns that into a blocked task +
  // an Issue (it must NOT become a "done" deliverable).
  const memBlock = memoryText
    ? `\n\nNOTES FROM EARLIER WORK (build on these, continue and add to them, don't repeat):\n${memoryText}`
    : "";
  const out = await generate(
    `${agent.persona} Produce the deliverable directly and concisely (short paragraphs or a tight list). No preamble.`,
    `TASK: ${task.title}\n\nDETAILS:\n${task.prompt}${memBlock}`
  );
  return out || `Done: ${task.title}.`;
}

/* One-line memory note so future related tasks can continue the work. */
export async function summarizeForMemory(agent, task, result) {
  if (!ai) return `${task.title} — completed.`;
  try {
    const txt = await generate(
      "In ONE short line (max 18 words), note what was done and any key fact worth remembering for future related work. No preamble.",
      `TASK: ${task.title}\nRESULT:\n${result}`,
      { temperature: 0.3 }
    );
    return (txt || "").replace(/\s+/g, " ").slice(0, 180) || `${task.title} — completed.`;
  } catch {
    return `${task.title} — completed.`;
  }
}

/* CTO reviews the deliverable. Throws on API error (-> Issue); a bad/parse
   response just defaults to approved rather than blocking the pipeline. */
export async function runReview(task, result) {
  if (!ai) {
    await wait(400 + Math.random() * 500);
    return { complete: true, note: "approved (sim)" };
  }
  const txt = await generate(
    'You are JAY JAY, the CTO, reviewing a deliverable. Decide if it adequately completes the task. Respond ONLY as JSON: {"complete": boolean, "note": string up to 10 words}.',
    `TASK: ${task.title}\nDETAILS: ${task.prompt}\n\nDELIVERABLE:\n${result}`,
    { json: true, temperature: 0.2 }
  );
  try {
    const p = JSON.parse(txt);
    return { complete: !!p.complete, note: String(p.note || "").slice(0, 120) || "reviewed" };
  } catch {
    return { complete: true, note: "approved" };
  }
}

/* CTO invents a department-appropriate task when the queue is empty. */
export async function generateTask(agent) {
  if (!ai) {
    const title = pick(SIM[agent.department] || ["run a routine check"]);
    return { title, prompt: `${title}. Provide a brief, useful result.` };
  }
  try {
    const txt = await generate(
      `You are JAY JAY, the CTO, assigning ONE small self-contained task to ${agent.name} (${agent.role}, ${agent.room}). It must be completable by an LLM in a single shot with no external tools. Respond ONLY as JSON: {"title": string up to 8 words, "prompt": string}.`,
      `Assign a useful task to ${agent.name}.`,
      { json: true, temperature: 1.0 }
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
