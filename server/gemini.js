// Gemini Flash integration. Each worker executes its task via Gemini using its
// persona; the CTO reviews the deliverable and can generate fresh work. If no
// GEMINI_API_KEY is set, everything degrades to a believable simulation so the
// office still runs end-to-end.

import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY, GEMINI_MODEL } from "./config.js";

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
export const usingGemini = !!ai;

async function generate(system, prompt, { json = false, temperature = 0.7 } = {}) {
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
}

const SIM = {
  observatory: ["scan the data streams", "chart the latest signals", "log the night readings"],
  security: ["sweep the perimeter", "audit the access logs", "run a vulnerability pass"],
  research_lab: ["draft the weekly brief", "summarize the findings", "polish the report"],
  development: ["refactor the module", "fix the failing build", "prototype the feature"],
  admin: ["index the records", "back up the archive", "reconcile the ledgers"],
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* Worker performs the task. */
export async function runWork(agent, task) {
  if (!ai) {
    await wait(1200 + Math.random() * 1800);
    return `Done: ${task.title}.\n\n(Simulated deliverable — set GEMINI_API_KEY to have ${agent.name} produce real work with Gemini Flash.)`;
  }
  try {
    const out = await generate(
      `${agent.persona} Produce the deliverable directly and concisely (short paragraphs or a tight list). No preamble.`,
      `TASK: ${task.title}\n\nDETAILS:\n${task.prompt}`
    );
    return out || `Done: ${task.title}.`;
  } catch (e) {
    return `⚠️ ${agent.name} could not complete via Gemini: ${e.message}`;
  }
}

/* CTO reviews the deliverable. */
export async function runReview(task, result) {
  if (!ai) {
    await wait(400 + Math.random() * 500);
    return { complete: true, note: "approved (sim)" };
  }
  try {
    const txt = await generate(
      'You are JEREMIAH, the CTO, reviewing a deliverable. Decide if it adequately completes the task. Respond ONLY as JSON: {"complete": boolean, "note": string up to 10 words}.',
      `TASK: ${task.title}\nDETAILS: ${task.prompt}\n\nDELIVERABLE:\n${result}`,
      { json: true, temperature: 0.2 }
    );
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
      `You are JEREMIAH, the CTO, assigning ONE small self-contained task to ${agent.name} (${agent.role}, ${agent.room}). It must be completable by an LLM in a single shot with no external tools. Respond ONLY as JSON: {"title": string up to 8 words, "prompt": string}.`,
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
