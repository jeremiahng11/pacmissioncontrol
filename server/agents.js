// Static agent + department definitions. Live status/task are layered on top
// at runtime; these are the immutable identities of the office.

export const DEPARTMENTS = {
  command: { label: "CTO Office", room: "COMMAND HQ" },
  observatory: { label: "Observatory", room: "OBSERVATORY" },
  security: { label: "Security", room: "SECURITY" },
  research_lab: { label: "Research Lab", room: "RESEARCH LAB" },
  development: { label: "Development Center", room: "WORKSHOP" },
  admin: { label: "Admin", room: "ARCHIVE" },
};

export const AGENT_DEFS = [
  {
    id: "jeremiah",
    name: "JAY JAY",
    role: "CTO · Command Core",
    room: "COMMAND HQ",
    department: "command",
    color: "#facc15",
    cto: true,
    persona:
      "You are JAY JAY, the CTO orchestrating a team of specialist agents.",
  },
  {
    id: "scout",
    name: "SCOUT",
    role: "Researcher",
    room: "OBSERVATORY",
    department: "observatory",
    color: "#38bdf8",
    cto: false,
    persona:
      "You are SCOUT, a research and scanning agent in the Observatory. You investigate questions and report concise, well-organized, factual findings.",
  },
  {
    id: "warden",
    name: "WARDEN",
    role: "Sentinel",
    room: "SECURITY",
    department: "security",
    color: "#fb5570",
    cto: false,
    persona:
      "You are WARDEN, a security sentinel. You assess risks, review for vulnerabilities and compliance gaps, and report clear, prioritized security findings.",
  },
  {
    id: "scribe",
    name: "SCRIBE",
    role: "Writer",
    room: "RESEARCH LAB",
    department: "research_lab",
    color: "#f472b6",
    cto: false,
    persona:
      "You are SCRIBE, a writer and analyst in the Research Lab. You produce clear, well-structured written deliverables: summaries, briefs, and reports.",
  },
  {
    id: "orbit",
    name: "ORBIT",
    role: "Engineer",
    room: "WORKSHOP",
    department: "development",
    color: "#a855f7",
    cto: false,
    persona:
      "You are ORBIT, an engineer in the Development Center. You design pragmatic technical solutions and write clean, correct code with brief explanations.",
  },
  {
    id: "vault",
    name: "VAULT",
    role: "Data",
    room: "ARCHIVE",
    department: "admin",
    color: "#fb923c",
    cto: false,
    persona:
      "You are VAULT, a data and admin agent in the Archive. You organize, index, reconcile, and summarize records and structured data.",
  },
];

export const WORKER_DEFS = AGENT_DEFS.filter((a) => !a.cto);
export const VALID_DEPARTMENTS = new Set(Object.keys(DEPARTMENTS));
