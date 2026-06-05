import React, { useState, useEffect, useRef } from "react";
import { Gamepad2, Crown, Zap, Power, Plus, LogOut, Trash2, X, Bot, Sparkles, Users, User } from "lucide-react";
import { useAgentSocket } from "./useAgentSocket";

/* ------------------------------------------------------------------ *
 *  MISSION CONTROL — AGENT OFFICE
 *  Live: agents render from {status, task} over the WebSocket. When the
 *  CTO assigns a task, Jeremiah (purple) walks across the office to the
 *  agent's room to deliver it, then returns to Command HQ. The Team view
 *  shows the full roster, with the human Group CTO at the top.
 * ------------------------------------------------------------------ */

const AGENTS = [
  { id: "jeremiah", name: "JEREMIAH", role: "CTO · Command Core", room: "COMMAND HQ",  department: "command",     color: "#a855f7", cto: true },
  { id: "scout",    name: "SCOUT",    role: "Researcher",         room: "OBSERVATORY",  department: "observatory", color: "#38bdf8" },
  { id: "warden",   name: "WARDEN",   role: "Sentinel",           room: "SECURITY",     department: "security",    color: "#fb5570" },
  { id: "scribe",   name: "SCRIBE",   role: "Writer",             room: "RESEARCH LAB", department: "research_lab",color: "#f472b6" },
  { id: "orbit",    name: "ORBIT",    role: "Engineer",           room: "WORKSHOP",     department: "development", color: "#eab308" },
  { id: "vault",    name: "VAULT",    role: "Data",               room: "ARCHIVE",      department: "admin",       color: "#fb923c" },
];

const DEPT_OPTS = [
  ["", "Any department"],
  ["observatory", "Observatory · Scout"],
  ["security", "Security · Warden"],
  ["research_lab", "Research Lab · Scribe"],
  ["development", "Development · Orbit"],
  ["admin", "Admin · Vault"],
];

// Team roster. Human Group CTO sits at the top; AI agents map to the office.
const TEAM = [
  { section: "GROUP CTO", members: [
    { id: "human", name: "Jeremiah Ng", role: "Group CTO · Human", human: true, color: "#e8edff",
      desc: "Sets the direction and priorities, reviews the agents' work, and assigns the missions. The human in command." },
  ]},
  { section: "ORCHESTRATOR", members: [
    { id: "jeremiah", name: "JEREMIAH", role: "CTO · Command Core", color: "#a855f7", cadence: "Always on",
      desc: "The central brain. Routes every task to the right department, watches the work, verifies completion, and assigns the next." },
  ]},
  { section: "DEPARTMENTS", members: [
    { id: "scout",  name: "SCOUT",  role: "Researcher · Observatory",         color: "#38bdf8", cadence: "On demand",
      desc: "Investigates questions and scans for signal, then reports concise, well-organized findings." },
    { id: "warden", name: "WARDEN", role: "Sentinel · Security",              color: "#fb5570", cadence: "On demand",
      desc: "Assesses risks, reviews for vulnerabilities and compliance gaps, and reports prioritized security findings." },
    { id: "scribe", name: "SCRIBE", role: "Writer · Research Lab",            color: "#f472b6", cadence: "On demand",
      desc: "Produces clear written deliverables — summaries, briefs, and reports." },
    { id: "orbit",  name: "ORBIT",  role: "Engineer · Development Center",    color: "#eab308", cadence: "On demand",
      desc: "Designs pragmatic technical solutions and writes clean, correct code." },
    { id: "vault",  name: "VAULT",  role: "Data · Admin",                     color: "#fb923c", cadence: "On demand",
      desc: "Organizes, indexes, reconciles, and summarizes records and structured data." },
  ]},
];

const ROOMS = ["OBSERVATORY", "COMMAND HQ", "SECURITY", "RESEARCH LAB", "WORKSHOP", "ARCHIVE"];
const META = {
  "OBSERVATORY":  { cls: "r-obs",  h: 172, walk: "busyA" },
  "COMMAND HQ":   { cls: "r-hq",   h: 200, walk: "busyB" },
  "SECURITY":     { cls: "r-sec",  h: 172, walk: "busyB" },
  "RESEARCH LAB": { cls: "r-lab",  h: 158, walk: "busyA" },
  "WORKSHOP":     { cls: "r-shop", h: 150, walk: "busyB" },
  "ARCHIVE":      { cls: "r-arc",  h: 172, walk: "busyA" },
};

const STATUS_COLOR = { queued: "#64786d", in_progress: "#4ade80", review: "#eab308", done: "#38bdf8", failed: "#fb5570" };
const STATUS_LABEL = { queued: "QUEUED", in_progress: "WORKING", review: "REVIEW", done: "DONE", failed: "FAILED" };

/* --- pixel octopus sprite --- */
const OCTO = ["....XXXXX....", "..XXXXXXXXX..", ".XXXXXXXXXXX.", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", "XX.XXX.XXX.XX", "X..X.X.X.X..X"];
function Octo({ color, size = 60, status = "idle", cto = false }) {
  const work = status === "working" || status === "command", think = status === "thinking", idle = status === "idle";
  const dim = idle ? 0.6 : 1, look = think ? -1.1 : 0;
  return (
    <svg width={size} height={size * (17 / 13)} viewBox="0 -3 13 17" shapeRendering="crispEdges"
      style={{ overflow: "visible", display: "block", filter: idle ? "none" : `drop-shadow(0 0 6px ${color}aa)` }}
      className={work ? "octo-bob" : think ? "octo-tilt" : ""}>
      {cto && (<g fill="#f5c95b"><rect x="3" y="-3" width="1" height="2" /><rect x="6" y="-3" width="1" height="2" /><rect x="9" y="-3" width="1" height="2" /><rect x="3" y="-1" width="7" height="1" /></g>)}
      {OCTO.map((row, r) => row.split("").map((c, x) => c === "X" ? <rect key={`${r}-${x}`} x={x} y={r} width="1" height="1" fill={color} opacity={dim} /> : null))}
      <rect x="1" y="0" width="11" height="2" fill="#fff" opacity={idle ? 0.05 : 0.12} />
      <rect x="0" y="9" width="13" height="1" fill="#000" opacity="0.18" />
      {idle ? (<g fill="#0b1020"><rect x="3" y="5" width="3" height="1" /><rect x="7" y="5" width="3" height="1" /></g>)
        : (<g><rect x="3" y="3" width="3" height="4" fill="#fff" /><rect x="7" y="3" width="3" height="4" fill="#fff" /><rect x={4} y={5 + look} width="1.4" height="1.8" fill="#0b1020" /><rect x={8} y={5 + look} width="1.4" height="1.8" fill="#0b1020" /></g>)}
    </svg>
  );
}

/* --- furnished room interiors (viewBox 0 0 260 150) --- */
function RoomArt({ room, color, work }) {
  const c = color, on = work ? 1 : 0.5;
  const base = (
    <>
      <rect x="0" y="0" width="260" height="150" fill="#070a14" />
      <rect x="0" y="0" width="260" height="97" fill={c} opacity="0.05" />
      <polygon points="0,97 260,97 260,150 0,150" fill={c} opacity="0.09" />
      {[10, 70, 130, 190, 250].map((x, i) => (<line key={i} x1={x} y1="150" x2="130" y2="64" stroke={c} strokeOpacity="0.06" strokeWidth="1" />))}
      {[112, 128, 144].map((y, i) => (<line key={"h" + i} x1="0" y1={y} x2="260" y2={y} stroke={c} strokeOpacity="0.05" strokeWidth="1" />))}
      <rect x="0" y="95" width="260" height="2.5" fill={c} opacity="0.55" />
    </>
  );
  const screen = (x, y, w, h, bars = 3) => (<g><rect x={x} y={y} width={w} height={h} rx="2" fill="#05080f" stroke={c} strokeOpacity="0.6" />{Array.from({ length: bars }).map((_, i) => (<rect key={i} x={x + 4} y={y + 5 + i * 5} width={w - 8 - (i % 2) * 6} height="2" rx="1" fill={c} opacity={on} className="tw" style={{ animationDelay: `${i * 0.3}s` }} />))}</g>);
  const desk = (x, w) => (<g><rect x={x} y="108" width={w} height="6" rx="2" fill={c} opacity="0.55" /><rect x={x + 3} y="114" width="4" height="20" fill={c} opacity="0.35" /><rect x={x + w - 7} y="114" width="4" height="20" fill={c} opacity="0.35" /></g>);

  let furn = null;
  switch (room) {
    case "OBSERVATORY":
      furn = (<g>
        <rect x="12" y="10" width="150" height="52" rx="3" fill="#04060d" stroke={c} strokeOpacity="0.5" />
        {[[24, 22], [50, 38], [78, 18], [104, 44], [130, 26], [150, 48], [40, 52]].map(([x, y], i) => (<rect key={i} x={x} y={y} width="2.5" height="2.5" fill="#cfe3ff" className="tw" style={{ animationDelay: `${i * 0.4}s` }} />))}
        <circle cx="142" cy="26" r="9" fill={c} opacity="0.35" />
        <g stroke={c} strokeWidth="2" fill="none"><line x1="34" y1="138" x2="50" y2="104" /><line x1="64" y1="138" x2="50" y2="104" /></g>
        <rect x="46" y="92" width="30" height="9" rx="4" fill={c} opacity="0.85" transform="rotate(-26 61 96)" />
        {desk(196, 54)}{screen(206, 92, 34, 16, 2)}
      </g>);
      break;
    case "COMMAND HQ":
      furn = (<g>
        {screen(78, 6, 104, 42, 5)}
        {screen(14, 14, 54, 28, 3)}{screen(192, 14, 54, 28, 3)}
        <rect x="18" y="106" width="224" height="8" rx="2" fill={c} opacity="0.5" />
        {[34, 96, 158, 210].map((x, i) => <g key={i}>{screen(x, 90, 40, 16, 2)}</g>)}
        {["#fb5570", "#eab308", "#4ade80"].map((col, i) => (<circle key={i} cx={236} cy={12 + i * 8} r="2.4" fill={col} className="tw" style={{ animationDelay: `${i * 0.4}s` }} />))}
      </g>);
      break;
    case "SECURITY":
      furn = (<g>
        {[[16, 10], [60, 10], [104, 10], [16, 40], [60, 40], [104, 40]].map(([x, y], i) => <g key={i}>{screen(x, y, 38, 24, 2)}</g>)}
        {desk(180, 64)}{screen(190, 88, 44, 18, 2)}
        <g><rect x="150" y="86" width="10" height="48" rx="3" fill="#04060d" stroke={c} strokeOpacity="0.5" />{["#fb5570", "#eab308", "#4ade80"].map((col, i) => (<circle key={i} cx="155" cy={94 + i * 12} r="3.4" fill={col} className="tw" style={{ animationDelay: `${i * 0.5}s` }} />))}</g>
      </g>);
      break;
    case "RESEARCH LAB":
      furn = (<g>
        {[14, 30, 46].map((y, i) => (<g key={i}><rect x="12" y={y} width="120" height="5" rx="1" fill="none" stroke={c} strokeOpacity="0.4" strokeWidth="1" />{[18, 40, 62, 84, 106].map((x, j) => (<rect key={j} x={x} y={y - 6} width="6" height="6" rx="1" fill={c} opacity="0.4" />))}</g>))}
        <rect x="150" y="104" width="96" height="6" rx="2" fill={c} opacity="0.5" />
        {[160, 188, 216].map((x, i) => (<g key={i}><path d={`M${x},92 L${x},100 L${x - 5},108 L${x + 11},108 L${x + 6},100 L${x + 6},92 Z`} fill="#04060d" stroke={c} strokeOpacity="0.6" /><rect x={x - 3} y="102" width="12" height="5" fill={c} opacity={on} /><circle cx={x + 3} cy="98" r="1.6" fill={c} className="tw" style={{ animationDelay: `${i * 0.5}s` }} /></g>))}
        <g transform="translate(34,118)" fill={c}><rect x="-2" y="0" width="4" height="16" opacity="0.5" /><circle cx="0" cy="-2" r="5" opacity="0.7" /><circle cx="-7" cy="2" r="5" opacity="0.6" /><circle cx="7" cy="2" r="5" opacity="0.6" /></g>
      </g>);
      break;
    case "WORKSHOP":
      furn = (<g>
        <rect x="12" y="10" width="120" height="40" rx="2" fill="#04060d" stroke={c} strokeOpacity="0.4" />
        <g stroke={c} strokeWidth="2" fill="none" opacity="0.7">{[24, 44, 64, 84].map((x, i) => (<line key={i} x1={x} y1="16" x2={x} y2="30" />))}<circle cx="108" cy="24" r="6" /><rect x="105" y="28" width="3" height="14" transform="rotate(40 106 30)" /></g>
        <rect x="150" y="104" width="96" height="8" rx="2" fill={c} opacity="0.5" /><rect x="156" y="112" width="5" height="22" fill={c} opacity="0.35" /><rect x="234" y="112" width="5" height="22" fill={c} opacity="0.35" />
        <g transform="translate(196,94)" className={work ? "spin" : ""} style={{ transformOrigin: "196px 94px" }} stroke={c} strokeWidth="2" fill="none"><circle cx="0" cy="0" r="7" />{[0, 60, 120, 180, 240, 300].map((d) => (<line key={d} x1={7 * Math.cos(d * Math.PI / 180)} y1={7 * Math.sin(d * Math.PI / 180)} x2={10 * Math.cos(d * Math.PI / 180)} y2={10 * Math.sin(d * Math.PI / 180)} />))}</g>
        {desk(40, 70)}
      </g>);
      break;
    case "ARCHIVE":
      furn = (<g>
        {[10, 34, 58].map((y, i) => (<g key={i}><rect x="12" y={y} width="150" height="20" rx="1" fill="none" stroke={c} strokeOpacity="0.4" strokeWidth="1" />{[16, 40, 64, 88, 112, 136].map((x, j) => (<rect key={j} x={x} y={y + 3} width="18" height="14" rx="1" fill={c} opacity={0.22 + ((i + j) % 3) * 0.12} />))}</g>))}
        {[[186, 104], [214, 100], [196, 120]].map(([x, y], i) => (<rect key={i} x={x} y={y} width="26" height="22" rx="2" fill="#04060d" stroke={c} strokeOpacity="0.5" />))}
        <g stroke={c} strokeWidth="2" opacity="0.5"><line x1="240" y1="86" x2="240" y2="138" /><line x1="252" y1="86" x2="252" y2="138" />{[94, 104, 114, 124].map((y, i) => (<line key={i} x1="240" y1={y} x2="252" y2={y} />))}</g>
      </g>);
      break;
    default: break;
  }
  return (<>{base}{furn}</>);
}

/* --- Team roster view --- */
function TeamView({ live, model }) {
  const liveBadge = (id) => {
    const a = live[id];
    if (!a) return null;
    const s = a.status;
    const map = { command: ["ON-DUTY", "#a855f7"], working: ["ACTIVE", "#4ade80"], thinking: ["THINKING", "#eab308"], idle: ["IDLE", "#64786d"] };
    return map[s] || map.idle;
  };
  return (
    <div style={SS.teamWrap}>
      <div style={SS.teamHeadRow}>
        <h1 style={SS.h1}><Users size={20} /> Team</h1>
        <div style={SS.teamSub}>The org behind Mission Control — one human, one CTO orchestrator, five specialists.</div>
      </div>
      {TEAM.map((group) => (
        <div key={group.section} style={SS.teamSection}>
          <div style={SS.teamSectionTitle}>{group.section}</div>
          <div style={SS.teamGrid}>
            {group.members.map((m) => {
              const badge = m.human ? ["HUMAN", "#e8edff"] : liveBadge(m.id);
              const task = !m.human && live[m.id] && !live[m.id].cto ? live[m.id].task : null;
              return (
                <div key={m.id} style={{ ...SS.memberCard, borderColor: `${m.color}55` }}>
                  <div style={SS.memberHead}>
                    <div style={SS.memberAvatar}>
                      {m.human
                        ? <div style={SS.humanAvatar}><User size={22} color="#0b1020" /></div>
                        : <Octo color={m.color} size={40} status={live[m.id]?.status || "idle"} cto={m.id === "jeremiah"} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={SS.memberName}>
                        {m.name} {m.id === "jeremiah" && <Crown size={12} color="#f5c95b" />}
                        {badge && <span style={{ ...SS.badgeSm, color: badge[1], borderColor: `${badge[1]}66`, background: `${badge[1]}1a` }}>{badge[0]}</span>}
                      </div>
                      <div style={SS.memberRole}>{m.role}</div>
                    </div>
                  </div>
                  <div style={SS.memberBadges}>
                    {m.human
                      ? <span style={SS.metaBadge}>👤 Human · Group CTO</span>
                      : <><span style={SS.metaBadge}>◇ {model || "gemini"}</span><span style={SS.metaBadge}>⌁ {m.cadence}</span></>}
                  </div>
                  <div style={SS.memberDesc}>{m.desc}</div>
                  {task && <div style={SS.memberTask}>now: {task}</div>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AgentOffice() {
  const { agents: live, tasks, events, settings, gemini, model, connected, assignTask, deleteTask, control, logout } = useAgentSocket();
  const [view, setView] = useState("office");
  const [form, setForm] = useState({ title: "", department: "", details: "" });
  const [selected, setSelected] = useState(null);
  const [say, setSay] = useState(null);
  const [courier, setCourier] = useState(null);

  const roomsRef = useRef(null);
  const roomRefs = useRef({});
  const queueRef = useRef([]);
  const runningRef = useRef(false);
  const lastEvtRef = useRef(0);

  const agents = AGENTS.map((s) => ({
    ...s,
    ...(live[s.id] || { status: s.cto ? "command" : "idle", task: s.cto ? "running the office" : "standing by", last: "" }),
  }));
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  const byRoom = (room) => agents.find((a) => a.room === room);

  const taskList = Object.values(tasks).sort((a, b) => b.createdAt - a.createdAt);
  const activeTasks = taskList.filter((t) => ["queued", "in_progress", "review"].includes(t.status));
  const selectedTask = selected ? tasks[selected] : null;

  // Courier: Jeremiah walks from Command HQ to the assigned agent's room and back.
  const centerOf = (room) => {
    const cont = roomsRef.current, el = roomRefs.current[room];
    if (!cont || !el) return null;
    const cr = cont.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: r.left - cr.left + r.width / 2, y: r.top - cr.top + r.height / 2 };
  };
  const runQueue = () => {
    if (runningRef.current) return;
    const item = queueRef.current.shift();
    if (!item) return;
    const hq = centerOf("COMMAND HQ"), tgt = centerOf(item.room);
    if (!hq || !tgt) { runningRef.current = false; return; }
    runningRef.current = true;
    setCourier({ ...item, coords: hq, showSpeech: false });
    setSay({ room: item.room });
    setTimeout(() => setCourier((c) => c && { ...c, coords: tgt }), 60);
    setTimeout(() => setCourier((c) => c && { ...c, showSpeech: true }), 1250);
    setTimeout(() => { setCourier((c) => c && { ...c, showSpeech: false, coords: hq }); setSay(null); }, 2750);
    setTimeout(() => { setCourier(null); runningRef.current = false; runQueue(); }, 3950);
  };

  useEffect(() => {
    if (!events.length) return;
    const maxId = Math.max(...events.map((e) => e.id));
    if (lastEvtRef.current === 0) { lastEvtRef.current = maxId; return; } // skip history on first load
    const fresh = events.filter((e) => e.id > lastEvtRef.current && e.kind === "assign" && e.agentId);
    lastEvtRef.current = maxId;
    for (const e of fresh.reverse()) {
      const ag = AGENTS.find((x) => x.id === e.agentId);
      if (!ag || ag.cto) continue;
      const task = e.text.includes(": ") ? e.text.split(": ").slice(1).join(": ") : "";
      queueRef.current.push({ room: ag.room, name: ag.name, task });
    }
    if (view === "office") runQueue();
  }, [events]);

  const submit = (e) => {
    e.preventDefault();
    const title = form.title.trim();
    if (!title) return;
    assignTask({ title, prompt: form.details.trim() || title, department: form.department || null });
    setForm((f) => ({ ...f, title: "", details: "" }));
  };

  const badge = (s) => s === "command" ? ["ON-DUTY", "#a855f7"] : s === "working" ? ["ACTIVE", "#4ade80"] : s === "thinking" ? ["THINKING", "#eab308"] : ["IDLE", "#64786d"];
  const ticker = events.length ? events.map((e) => e.text) : ["Mission Control — connecting…"];

  return (
    <div style={SS.root}>
      <style>{CSS}</style>

      <aside style={SS.side}>
        <div style={SS.brandWrap}>
          <Octo color="#a855f7" size={46} status="command" cto />
          <div style={SS.brand}>MISSION<br />CONTROL</div>
          <div style={{ ...SS.online, color: connected ? "#4ade80" : "#eab308" }}>
            <span style={{ ...SS.onDot, background: connected ? "#4ade80" : "#eab308" }} />
            {connected ? "LIVE" : "RECONNECTING"}
          </div>
          <div style={SS.modePill}>
            {gemini ? <Sparkles size={11} /> : <Bot size={11} />} {gemini ? (model || "GEMINI") : "SIMULATION"}
          </div>
        </div>

        <div style={SS.navToggle}>
          <button style={{ ...SS.navBtn, ...(view === "office" ? SS.navBtnActive : {}) }} onClick={() => setView("office")}><Gamepad2 size={13} /> Office</button>
          <button style={{ ...SS.navBtn, ...(view === "team" ? SS.navBtnActive : {}) }} onClick={() => setView("team")}><Users size={13} /> Team</button>
        </div>

        <form style={SS.compose} onSubmit={submit}>
          <div style={SS.secTitle}>ASSIGN A TASK</div>
          <select style={SS.select} value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}>
            {DEPT_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input style={SS.input} placeholder="Task title…" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          <textarea style={SS.textarea} rows={3} placeholder="Details / instructions (optional)" value={form.details} onChange={(e) => setForm((f) => ({ ...f, details: e.target.value }))} />
          <button type="submit" style={SS.assignBtn}><Plus size={13} /> ADD TO QUEUE</button>
        </form>

        <div style={SS.queueWrap}>
          <div style={SS.secTitle}>QUEUE · {activeTasks.length} active</div>
          {taskList.length === 0 && <div style={SS.queueEmpty}>No tasks yet. Add one above, or let Jeremiah run the office.</div>}
          {taskList.slice(0, 30).map((t) => {
            const col = STATUS_COLOR[t.status] || "#64786d";
            return (
              <div key={t.id} style={SS.queueItem} onClick={() => setSelected(t.id)}>
                <span style={{ ...SS.pill, color: col, borderColor: `${col}66`, background: `${col}1a` }}>{STATUS_LABEL[t.status]}</span>
                <span style={SS.queueTitle}>{t.title}</span>
              </div>
            );
          })}
        </div>
      </aside>

      <main style={SS.main}>
        {view === "team" ? (
          <TeamView live={live} model={model} />
        ) : (
          <>
            <div style={SS.head}>
              <h1 style={SS.h1}><Gamepad2 size={20} /> Agent Office {settings.paused && <span style={SS.pausedChip}>PAUSED</span>}</h1>
              <div style={SS.controls}>
                <button onClick={() => control("dispatch")} className="mc-btn" style={{ ...SS.btn, ...SS.gold }}><Crown size={12} /> DISPATCH</button>
                <button onClick={() => control("all_hands")} className="mc-btn" style={{ ...SS.btn, ...SS.go }}><Zap size={12} /> ALL HANDS</button>
                <button onClick={() => control("clock_out")} className="mc-btn" style={{ ...SS.btn, ...SS.stop }}><Power size={12} /> CLOCK OUT</button>
                <button onClick={() => control("toggle_autonomous", { autonomous: !settings.autonomous })} className="mc-btn" style={{ ...SS.btn, ...(settings.autonomous ? SS.autoOn : SS.autoOff) }}><Bot size={12} /> AUTO {settings.autonomous ? "ON" : "OFF"}</button>
                <button onClick={logout} className="mc-btn" style={{ ...SS.btn, ...SS.ghost }}><LogOut size={12} /> LOGOUT</button>
              </div>
            </div>

            <div className="rooms" ref={roomsRef} style={{ position: "relative" }}>
              {ROOMS.map((room) => {
                const a = byRoom(room), m = META[room];
                const busy = a.status === "working" || a.status === "command";
                const ctoAway = a.cto && !!courier;
                return (
                  <div key={room} ref={(el) => (roomRefs.current[room] = el)} className={`room ${m.cls}`} style={{ "--rc": a.color }} onClick={() => !a.cto && setForm((f) => ({ ...f, department: a.department }))}>
                    <div className="room-top"><span className="room-name">{room}</span><span className="room-dots"><i /><i /><i /></span></div>
                    <div className="scene" style={{ height: m.h }}>
                      <svg className="room-art" viewBox="0 0 260 150" preserveAspectRatio="none"><RoomArt room={room} color={a.color} work={busy} /></svg>
                      {say && say.room === room && !a.cto && <div className="speech" style={{ borderColor: a.color, color: a.color }}>on it!</div>}
                      {a.status === "thinking" && <div className="cue" style={{ color: a.color }}>?</div>}
                      {a.status === "idle" && <div className="cue zzz">z z z</div>}
                      <div className={`walker ${busy ? "busy " + m.walk : ""}`}>
                        <div className="oshadow" style={ctoAway ? { opacity: 0 } : undefined} />
                        {ctoAway ? <div className="cto-away">CTO en route…</div> : <Octo color={a.color} size={a.cto ? 76 : 56} status={a.status} cto={a.cto} />}
                      </div>
                      <div className="agent-tag" style={{ color: a.color }}>{a.name}</div>
                    </div>
                  </div>
                );
              })}

              {courier && (
                <div className="courier" style={{ left: courier.coords.x - 30, top: courier.coords.y - 50 }}>
                  {courier.showSpeech && <div className="courier-say">→ {courier.name}: {courier.task}</div>}
                  <div className="oshadow courier-shadow" />
                  <Octo color="#a855f7" size={58} status="working" cto />
                </div>
              )}
            </div>

            <div style={SS.ticker}>
              <span style={SS.live}><span style={SS.liveDot} /> LIVE</span>
              <div style={SS.tickWrap}><div className="mc-marquee" style={SS.tickRun}>{ticker.join("   •   ")}   •   {ticker.join("   •   ")}</div></div>
            </div>

            <div style={SS.cards}>
              {agents.map((a) => {
                const [bl, bc] = badge(a.status);
                return (
                  <div key={a.id} style={{ ...SS.card, borderColor: `${a.color}44` }} onClick={() => a.currentTaskId && setSelected(a.currentTaskId)}>
                    <div style={SS.cardHead}>
                      <div style={{ width: 36, display: "grid", placeItems: "center" }}><Octo color={a.color} size={28} status={a.status} cto={a.cto} /></div>
                      <div style={{ flex: 1 }}>
                        <div style={SS.cardName}>{a.name} {a.cto && <Crown size={11} color="#f5c95b" />}</div>
                        <span style={{ ...SS.cardBadge, color: bc, borderColor: `${bc}66`, background: `${bc}1a` }}>{bl}</span>
                      </div>
                    </div>
                    <div style={SS.cardBody}>{a.cto ? "always on · runs the office" : a.task}</div>
                    {!a.cto && (<div style={SS.cardMeta}><span>last <b style={{ color: "#cfe3d8" }}>{a.last || "—"}</b></span><span>{a.role}</span></div>)}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>

      {selectedTask && (
        <div style={SS.modalBg} onClick={() => setSelected(null)}>
          <div style={SS.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={SS.modalHead}>
              <span style={{ ...SS.pill, color: STATUS_COLOR[selectedTask.status], borderColor: `${STATUS_COLOR[selectedTask.status]}66`, background: `${STATUS_COLOR[selectedTask.status]}1a` }}>{STATUS_LABEL[selectedTask.status]}</span>
              <button style={SS.modalClose} onClick={() => setSelected(null)}><X size={16} /></button>
            </div>
            <div style={SS.modalTitle}>{selectedTask.title}</div>
            <div style={SS.modalMeta}>
              {selectedTask.department ? (DEPT_OPTS.find((d) => d[0] === selectedTask.department)?.[1] || selectedTask.department) : "Any department"}
              {selectedTask.assignedTo && byId[selectedTask.assignedTo] ? ` · ${byId[selectedTask.assignedTo].name}` : ""}
              {selectedTask.attempts ? ` · attempt ${selectedTask.attempts + 1}` : ""}
            </div>
            {selectedTask.prompt && selectedTask.prompt !== selectedTask.title && <div style={SS.modalPrompt}>{selectedTask.prompt}</div>}
            <div style={SS.secTitle}>DELIVERABLE</div>
            <div style={SS.resultBox}>{selectedTask.result || (selectedTask.status === "queued" ? "Waiting in the queue…" : "Working…")}</div>
            {selectedTask.reviewNotes && <div style={SS.reviewNote}>CTO review: {selectedTask.reviewNotes}</div>}
            <button style={SS.delBtn} onClick={() => { deleteTask(selectedTask.id); setSelected(null); }}><Trash2 size={13} /> DELETE TASK</button>
          </div>
        </div>
      )}
    </div>
  );
}

const PIX = "'Press Start 2P', monospace";
const MONO = "'JetBrains Mono', ui-monospace, monospace";
const SS = {
  root: { display: "flex", fontFamily: MONO, color: "#cfe3d8", background: "#0a0e1a", borderRadius: 14, overflow: "hidden", border: "1px solid #1a2440", minHeight: "calc(100vh - 32px)" },
  side: { width: 248, flexShrink: 0, background: "linear-gradient(180deg,#0c1226,#0a0e1a)", borderRight: "1px solid #1a2440", padding: "18px 14px", display: "flex", flexDirection: "column", gap: 14, maxHeight: "calc(100vh - 32px)" },
  brandWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 7, textAlign: "center", paddingBottom: 14, borderBottom: "1px solid #1a2440" },
  brand: { fontFamily: PIX, fontSize: 12, lineHeight: 1.6, color: "#e8edff", letterSpacing: 1 },
  online: { fontSize: 9.5, display: "flex", alignItems: "center", gap: 5, letterSpacing: 1 },
  onDot: { width: 7, height: 7, borderRadius: 99, boxShadow: "0 0 6px currentColor" },
  modePill: { fontSize: 8.5, letterSpacing: 1, color: "#9db0c8", display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 99, border: "1px solid #243358", background: "#0a1020" },
  navToggle: { display: "flex", gap: 6, background: "#0a1020", padding: 4, borderRadius: 9, border: "1px solid #1a2440" },
  navBtn: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px", borderRadius: 7, border: "none", background: "transparent", color: "#8aa0c0", fontFamily: MONO, fontSize: 11, fontWeight: 700, cursor: "pointer" },
  navBtnActive: { background: "#15203f", color: "#e8edff", border: "1px solid #243358" },
  compose: { display: "flex", flexDirection: "column", gap: 7 },
  secTitle: { fontSize: 9, letterSpacing: 1.5, color: "#5e7088", fontWeight: 700, margin: "2px 0" },
  select: { padding: "8px 9px", borderRadius: 7, border: "1px solid #243358", background: "#070a14", color: "#e8edff", fontFamily: MONO, fontSize: 11 },
  input: { padding: "9px 10px", borderRadius: 7, border: "1px solid #243358", background: "#070a14", color: "#e8edff", fontFamily: MONO, fontSize: 12 },
  textarea: { padding: "9px 10px", borderRadius: 7, border: "1px solid #243358", background: "#070a14", color: "#e8edff", fontFamily: MONO, fontSize: 11, resize: "vertical" },
  assignBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px", borderRadius: 7, border: "1px solid #a855f7", background: "#a855f7", color: "#0b1020", fontWeight: 700, fontSize: 10, letterSpacing: 1, cursor: "pointer", fontFamily: MONO },
  queueWrap: { display: "flex", flexDirection: "column", gap: 5, overflowY: "auto", flex: 1, minHeight: 60 },
  queueEmpty: { fontSize: 10, color: "#5e7088", lineHeight: 1.5, padding: "4px 2px" },
  queueItem: { display: "flex", alignItems: "center", gap: 7, padding: "7px 8px", borderRadius: 7, background: "#0a1020", border: "1px solid #161f3a", cursor: "pointer" },
  queueTitle: { fontSize: 10.5, color: "#cfe3d8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  pill: { fontSize: 7.5, fontWeight: 700, padding: "2px 6px", borderRadius: 99, border: "1px solid", letterSpacing: 0.8, flexShrink: 0 },
  main: { flex: 1, minWidth: 0, padding: 18, background: "radial-gradient(120% 90% at 50% -10%, #0e1430, #0a0e1a 60%)", overflowY: "auto", maxHeight: "calc(100vh - 32px)" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  h1: { margin: 0, fontSize: 22, fontWeight: 800, color: "#e8edff", display: "flex", alignItems: "center", gap: 10 },
  pausedChip: { fontSize: 9, fontWeight: 700, letterSpacing: 1, color: "#fca5b5", border: "1px solid #fb557066", background: "#fb55701a", borderRadius: 99, padding: "3px 8px" },
  controls: { display: "flex", gap: 7, flexWrap: "wrap" },
  btn: { display: "flex", alignItems: "center", gap: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: .5, padding: "8px 11px", borderRadius: 8, cursor: "pointer", fontFamily: MONO, border: "1px solid" },
  gold: { color: "#1a1405", background: "#f5c95b", borderColor: "#f5c95b" },
  go: { color: "#bbf7d0", background: "rgba(74,222,128,.1)", borderColor: "rgba(74,222,128,.4)" },
  stop: { color: "#fca5b5", background: "rgba(251,85,112,.1)", borderColor: "rgba(251,85,112,.4)" },
  autoOn: { color: "#c4b5fd", background: "rgba(168,85,247,.12)", borderColor: "rgba(168,85,247,.5)" },
  autoOff: { color: "#7a8aa0", background: "rgba(120,140,170,.06)", borderColor: "#243358" },
  ghost: { color: "#9db0c8", background: "transparent", borderColor: "#243358" },
  ticker: { display: "flex", alignItems: "center", gap: 12, marginTop: 14, padding: "9px 12px", borderRadius: 10, background: "#0c1226", border: "1px solid #1a2440", overflow: "hidden" },
  live: { display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, color: "#4ade80", letterSpacing: 1, flexShrink: 0 },
  liveDot: { width: 7, height: 7, borderRadius: 99, background: "#4ade80", boxShadow: "0 0 6px #4ade80" },
  tickWrap: { flex: 1, overflow: "hidden", whiteSpace: "nowrap" },
  tickRun: { display: "inline-block", fontSize: 11, color: "#8aa0c0", letterSpacing: .4 },
  cards: { marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(186px,1fr))", gap: 12 },
  card: { background: "#0c1226", border: "1px solid", borderRadius: 12, padding: 12, cursor: "pointer" },
  cardHead: { display: "flex", alignItems: "center", gap: 8 },
  cardName: { fontSize: 13, fontWeight: 800, color: "#e8edff", display: "flex", alignItems: "center", gap: 5 },
  cardBadge: { display: "inline-block", marginTop: 4, fontSize: 8, fontWeight: 700, padding: "2px 7px", borderRadius: 99, border: "1px solid", letterSpacing: 1 },
  cardBody: { fontSize: 11, color: "#9db0c8", marginTop: 9, minHeight: 28 },
  cardMeta: { display: "flex", justifyContent: "space-between", fontSize: 9.5, color: "#5e7088", marginTop: 9, borderTop: "1px solid #1a2440", paddingTop: 8 },
  // team
  teamWrap: { display: "flex", flexDirection: "column", gap: 22 },
  teamHeadRow: { display: "flex", flexDirection: "column", gap: 4, marginBottom: 2 },
  teamSub: { fontSize: 11.5, color: "#7a8aa0" },
  teamSection: { display: "flex", flexDirection: "column", gap: 10 },
  teamSectionTitle: { fontSize: 9, letterSpacing: 2.5, color: "#5e7088", fontWeight: 700, textAlign: "center", position: "relative" },
  teamGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(290px,1fr))", gap: 12 },
  memberCard: { background: "#0c1226", border: "1px solid", borderRadius: 12, padding: 14 },
  memberHead: { display: "flex", alignItems: "center", gap: 11 },
  memberAvatar: { width: 44, display: "grid", placeItems: "center", flexShrink: 0 },
  humanAvatar: { width: 40, height: 40, borderRadius: 99, background: "linear-gradient(160deg,#e8edff,#9db0c8)", display: "grid", placeItems: "center", boxShadow: "0 0 8px #e8edff55" },
  memberName: { fontSize: 14, fontWeight: 800, color: "#e8edff", display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" },
  memberRole: { fontSize: 10.5, color: "#8aa0c0", marginTop: 2 },
  badgeSm: { fontSize: 7.5, fontWeight: 700, padding: "2px 6px", borderRadius: 99, border: "1px solid", letterSpacing: 0.8 },
  memberBadges: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 11 },
  metaBadge: { fontSize: 9, color: "#9db0c8", padding: "3px 8px", borderRadius: 6, background: "#0a1020", border: "1px solid #1a2440", letterSpacing: 0.4 },
  memberDesc: { fontSize: 11.5, color: "#9db0c8", marginTop: 11, lineHeight: 1.55 },
  memberTask: { fontSize: 10.5, color: "#bbf7d0", marginTop: 9, borderTop: "1px solid #1a2440", paddingTop: 8 },
  // modal
  modalBg: { position: "fixed", inset: 0, background: "rgba(4,6,13,.72)", display: "grid", placeItems: "center", zIndex: 50, padding: 20 },
  modalCard: { width: "min(560px,94vw)", maxHeight: "86vh", overflowY: "auto", background: "#0c1226", border: "1px solid #243358", borderRadius: 14, padding: 20 },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  modalClose: { background: "transparent", border: "none", color: "#8aa0c0", cursor: "pointer" },
  modalTitle: { fontSize: 17, fontWeight: 800, color: "#e8edff", margin: "10px 0 4px" },
  modalMeta: { fontSize: 10.5, color: "#5e7088", marginBottom: 12, letterSpacing: .4 },
  modalPrompt: { fontSize: 12, color: "#9db0c8", background: "#070a14", border: "1px solid #161f3a", borderRadius: 8, padding: 10, marginBottom: 14, whiteSpace: "pre-wrap", lineHeight: 1.5 },
  resultBox: { fontSize: 12.5, color: "#cfe3d8", background: "#070a14", border: "1px solid #1a2440", borderRadius: 8, padding: 12, whiteSpace: "pre-wrap", lineHeight: 1.55, marginTop: 4 },
  reviewNote: { fontSize: 11, color: "#bbf7d0", marginTop: 10 },
  delBtn: { display: "flex", alignItems: "center", gap: 6, marginTop: 16, padding: "8px 11px", borderRadius: 8, border: "1px solid rgba(251,85,112,.4)", background: "rgba(251,85,112,.1)", color: "#fca5b5", fontWeight: 700, fontSize: 9.5, letterSpacing: 1, cursor: "pointer", fontFamily: MONO },
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=JetBrains+Mono:wght@400;700;800&display=swap');
.rooms { display:grid; grid-template-columns:repeat(12,1fr); gap:12px; align-items:start; }
.r-obs{grid-column:span 3} .r-hq{grid-column:span 6} .r-sec{grid-column:span 3}
.r-lab{grid-column:span 4} .r-shop{grid-column:span 5} .r-arc{grid-column:span 3}
@media(max-width:880px){ .rooms{grid-template-columns:1fr 1fr} .r-obs,.r-hq,.r-sec,.r-lab,.r-shop,.r-arc{grid-column:auto} }
@media(max-width:560px){ .rooms{grid-template-columns:1fr} }
.room { background:#0b1020; border:1px solid color-mix(in srgb, var(--rc) 35%, #1a2440); border-radius:12px; padding:8px; cursor:pointer; transition:filter .15s; }
.room:hover { filter:brightness(1.1); }
.room-top { display:flex; justify-content:space-between; align-items:center; padding:2px 4px 8px; }
.room-name { font-family:'Press Start 2P',monospace; font-size:8px; color:var(--rc); letter-spacing:1px; text-shadow:0 0 6px var(--rc); }
.room-dots { display:flex; gap:4px; } .room-dots i { width:5px; height:5px; border-radius:99px; background:#2a3658; display:block; }
.scene { position:relative; border-radius:8px; overflow:hidden; border:1px solid color-mix(in srgb,var(--rc) 22%, #161f3a); }
.room-art { position:absolute; inset:0; width:100%; height:100%; }
.scene::after { content:''; position:absolute; inset:0; pointer-events:none; background:repeating-linear-gradient(to bottom, rgba(255,255,255,.022) 0 1px, transparent 1px 3px); }
.walker { position:absolute; bottom:12px; left:50%; transform:translateX(-50%); z-index:3; display:flex; flex-direction:column; align-items:center; }
.walker.busy.busyA { animation:busyA 7s ease-in-out infinite; }
.walker.busy.busyB { animation:busyB 7.6s ease-in-out infinite; }
.oshadow { position:absolute; bottom:-4px; left:50%; transform:translateX(-50%); width:34px; height:7px; border-radius:50%; background:var(--rc); opacity:.28; filter:blur(1px); }
.cto-away { font-family:'JetBrains Mono'; font-size:8px; color:#a855f7; opacity:.8; border:1px dashed #a855f766; border-radius:6px; padding:3px 7px; white-space:nowrap; }
@keyframes busyA { 0%,12%{left:26%;} 26%,38%{left:50%;} 52%,64%{left:74%;} 80%,92%{left:50%;} 100%{left:26%;} }
@keyframes busyB { 0%,12%{left:74%;} 26%,38%{left:50%;} 52%,64%{left:26%;} 80%,92%{left:50%;} 100%{left:74%;} }
.courier { position:absolute; z-index:7; display:flex; flex-direction:column; align-items:center; pointer-events:none; transition:left 1.15s cubic-bezier(.45,.05,.3,1), top 1.15s cubic-bezier(.45,.05,.3,1); }
.courier-shadow { background:#a855f7; }
.courier-say { position:absolute; bottom:100%; margin-bottom:4px; font-family:'JetBrains Mono'; font-weight:700; font-size:9px; color:#d8b4fe; background:#070a14; border:1px solid #a855f7; border-radius:6px; padding:3px 8px; white-space:nowrap; max-width:220px; overflow:hidden; text-overflow:ellipsis; box-shadow:0 0 10px #a855f755; }
.agent-tag { position:absolute; bottom:2px; left:0; right:0; text-align:center; font-family:'Press Start 2P',monospace; font-size:7px; letter-spacing:1px; opacity:.85; z-index:2; }
.speech { position:absolute; top:10px; left:50%; transform:translateX(-50%); font-size:9px; font-family:'JetBrains Mono'; background:#070a14; border:1px solid; border-radius:6px; padding:2px 7px; z-index:4; white-space:nowrap; }
.cue { position:absolute; left:50%; transform:translateX(-50%); top:30px; font-family:'Press Start 2P',monospace; font-size:11px; z-index:4; animation:cueFloat 1.4s ease-in-out infinite; }
.cue.zzz { font-size:8px; color:#64786d; letter-spacing:2px; }
@keyframes cueFloat { 0%,100%{transform:translateX(-50%) translateY(0);opacity:.6;} 50%{transform:translateX(-50%) translateY(-4px);opacity:1;} }
@keyframes octoBob { 0%,100%{transform:translateY(0);} 50%{transform:translateY(-4px);} }
.octo-bob { animation:octoBob .55s ease-in-out infinite; }
@keyframes octoTilt { 0%,100%{transform:rotate(-3deg);} 50%{transform:rotate(3deg);} }
.octo-tilt { animation:octoTilt 1.8s ease-in-out infinite; }
.tw { animation:twk 1.6s ease-in-out infinite; } @keyframes twk { 0%,100%{opacity:.3;} 50%{opacity:1;} }
.spin { animation:spin 1.3s linear infinite; } @keyframes spin { to{transform:rotate(360deg);} }
.mc-marquee { animation:marq 22s linear infinite; } @keyframes marq { from{transform:translateX(0);} to{transform:translateX(-50%);} }
.mc-btn:hover { filter:brightness(1.15); } .mc-btn:active { transform:scale(.97); }
`;
