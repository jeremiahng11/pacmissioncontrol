// Scheduler: fires due routines (scheduled / recurring tasks) by creating a
// real task in the queue, which the orchestrator then dispatches to the right
// agent. Powers the Calendar and per-agent standing duties (e.g. Warden's
// security sweeps).

import { getRoutines, createTask, markRoutineRan, createRoutine, addEvent } from "./store.js";

const CHECK_MS = 30000;
let timer = null;

function fireDue() {
  const now = Date.now();
  for (const r of getRoutines()) {
    if (!r.enabled || !r.nextRunAt || r.nextRunAt > now) continue;
    createTask({ title: r.title, prompt: r.prompt, department: r.department, createdBy: "schedule" });
    markRoutineRan(r.id);
    addEvent({ kind: "system", text: `Jay Jay scheduled: ${r.title}` });
  }
}

export function startScheduler() {
  if (timer) return;
  timer = setInterval(fireDue, CHECK_MS);
  console.log("[schedule] started");
}

// Seed a few example standing duties on first boot — DISABLED so nothing runs
// (or costs) until the user enables them in the Calendar.
export function seedRoutines() {
  if (getRoutines().length) return;
  const defs = [
    { title: "Security sweep", department: "security", cadenceType: "interval", everyMinutes: 360, estimateMinutes: 5,
      prompt: "Review the most recent deliverables, memory notes, and task activity for security risks: exposed secrets/keys, PII leakage, or MAS/PDPA compliance gaps. Report findings by severity (high/medium/low) with a recommended action for each." },
    { title: "Morning scan", department: "observatory", cadenceType: "daily", dailyTime: "08:00", estimateMinutes: 5,
      prompt: "Summarize what the team worked on recently and surface 3 things worth attention today." },
    { title: "Daily archive digest", department: "admin", cadenceType: "daily", dailyTime: "23:00", estimateMinutes: 5,
      prompt: "Produce a short end-of-day digest: what was completed, what's still open, and anything that should be archived or followed up." },
  ];
  for (const d of defs) createRoutine({ ...d, enabled: false, createdBy: "system" });
  console.log(`[schedule] seeded ${defs.length} example routines (disabled)`);
}
