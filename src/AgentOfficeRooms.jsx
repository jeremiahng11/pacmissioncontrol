import React, { useState, useEffect, useRef, useCallback, memo } from "react";
import {
  Target, Satellite, Calendar, Rocket, Brain, FileText, Users, Gamepad2,
  Crown, Zap, Power, Plus, LogOut, Trash2, X, Bot, Sparkles, User, AlertTriangle, Check, Download, RotateCw, Paperclip, Image as ImageIcon,
} from "lucide-react";
import { useAgentSocket } from "./useAgentSocket";

/* ------------------------------------------------------------------ *
 *  MISSION CONTROL — AGENT OFFICE
 *  Live: agents render from {status, task} over the WebSocket. When the
 *  CTO assigns a task, Jay Jay walks across the office to the agent's
 *  room to deliver it, then returns. Heavy room art and sprites are
 *  memoized so frequent socket updates don't re-render (and flicker).
 * ------------------------------------------------------------------ */

const AGENTS = [
  { id: "jeremiah", name: "JAY JAY", role: "CTO · Command Core", room: "COMMAND HQ",  department: "command",     color: "#facc15", cto: true },
  { id: "scout",    name: "SCOUT",    role: "Researcher",         room: "OBSERVATORY",  department: "observatory", color: "#38bdf8" },
  { id: "warden",   name: "WARDEN",   role: "Sentinel",           room: "SECURITY",     department: "security",    color: "#fb5570" },
  { id: "scribe",   name: "SCRIBE",   role: "Writer",             room: "RESEARCH LAB", department: "research_lab",color: "#f472b6" },
  { id: "orbit",    name: "ORBIT",    role: "Engineer",           room: "WORKSHOP",     department: "development", color: "#a855f7" },
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

const NAV = [
  ["Tasks", Target, "tasks"],
  ["Content", Satellite, "content"],
  ["Calendar", Calendar, "calendar"],
  ["Projects", Rocket, "projects"],
  ["Memory", Brain, "memory"],
  ["Docs", FileText, "docs"],
  ["Team", Users, "team"],
  ["Visual", Gamepad2, "visual"],
];

const PLACEHOLDER = {
  content:  { icon: Satellite, title: "Content",  desc: "Plan and track the content your agents produce." },
  calendar: { icon: Calendar,  title: "Calendar", desc: "Scheduled runs and upcoming agent tasks." },
  projects: { icon: Rocket,    title: "Projects", desc: "Group missions into projects and follow their progress." },
};

const DEPT_LABEL = { command: "CTO Office", observatory: "Observatory", security: "Security", research_lab: "Research Lab", development: "Development Center", admin: "Admin" };
const deptLabel = (k) => DEPT_LABEL[k] || k || "";
const fmtWhen = (ms) => { try { return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

const TEAM = [
  { section: "GROUP CTO", members: [
    { id: "human", name: "Jeremiah Ng", role: "Group CTO · Human", human: true, color: "#e8edff",
      desc: "Sets the direction and priorities, reviews the agents' work, and assigns the missions. The human in command." },
  ]},
  { section: "ORCHESTRATOR", members: [
    { id: "jeremiah", name: "JAY JAY", role: "CTO · Command Core", color: "#facc15", cadence: "Always on",
      desc: "The central brain. Routes every task to the right department, watches the work, verifies completion, and assigns the next." },
  ]},
  { section: "DEPARTMENTS", members: [
    { id: "scout",  name: "SCOUT",  role: "Researcher · Observatory",      color: "#38bdf8", cadence: "On demand",
      desc: "Investigates questions and scans for signal, then reports concise, well-organized findings." },
    { id: "warden", name: "WARDEN", role: "Sentinel · Security",           color: "#fb5570", cadence: "On demand",
      desc: "Assesses risks, reviews for vulnerabilities and compliance gaps, and reports prioritized security findings." },
    { id: "scribe", name: "SCRIBE", role: "Writer · Research Lab",         color: "#f472b6", cadence: "On demand",
      desc: "Produces clear written deliverables — summaries, briefs, and reports." },
    { id: "orbit",  name: "ORBIT",  role: "Engineer · Development Center", color: "#a855f7", cadence: "On demand",
      desc: "Designs pragmatic technical solutions and writes clean, correct code." },
    { id: "vault",  name: "VAULT",  role: "Data · Admin",                  color: "#fb923c", cadence: "On demand",
      desc: "Organizes, indexes, reconciles, and summarizes records and structured data." },
  ]},
];

const ROOMS = ["OBSERVATORY", "COMMAND HQ", "SECURITY", "RESEARCH LAB", "WORKSHOP", "ARCHIVE"];
const ROOM_H = 200; // uniform room height (matches Command HQ)
const META = {
  "OBSERVATORY":  { cls: "r-obs",  h: ROOM_H, walk: "busyA" },
  "COMMAND HQ":   { cls: "r-hq",   h: ROOM_H, walk: "busyB" },
  "SECURITY":     { cls: "r-sec",  h: ROOM_H, walk: "busyB" },
  "RESEARCH LAB": { cls: "r-lab",  h: ROOM_H, walk: "busyA" },
  "WORKSHOP":     { cls: "r-shop", h: ROOM_H, walk: "busyB" },
  "ARCHIVE":      { cls: "r-arc",  h: ROOM_H, walk: "busyA" },
};
// Display labels (room keys stay stable internally).
const ROOM_LABEL = { "WORKSHOP": "DEVELOPMENT CENTER", "ARCHIVE": "ADMIN" };
const roomLabel = (r) => ROOM_LABEL[r] || r;

const STATUS_COLOR = { queued: "#64786d", in_progress: "#4ade80", review: "#eab308", done: "#38bdf8", failed: "#fb5570", blocked: "#fb923c" };
const STATUS_LABEL = { queued: "QUEUED", in_progress: "WORKING", review: "REVIEW", done: "DONE", failed: "FAILED", blocked: "ISSUE" };

/* --- Pac-Man sprite for the CTO (Jay Jay) --- */
const PacMan = memo(function PacMan({ color = "#facc15", size = 60, status = "idle" }) {
  const dur = status === "working" || status === "command" ? "0.34s" : status === "thinking" ? "0.5s" : "0.9s";
  const open = "M50,50 L89.8,27 A46,46 0 1 1 89.8,73 Z";
  const closed = "M50,50 L96,48.4 A46,46 0 1 1 96,51.6 Z";
  return (
    <svg width={size} height={size} viewBox="-8 -18 116 124" shapeRendering="geometricPrecision"
      style={{ overflow: "visible", display: "block", filter: status === "idle" ? "none" : `drop-shadow(0 0 6px ${color}aa)` }}>
      <g fill="#f5c95b">
        <rect x="27" y="-14" width="7" height="15" /><rect x="46" y="-17" width="7" height="18" /><rect x="65" y="-14" width="7" height="15" />
        <rect x="25" y="0" width="50" height="7" rx="1" />
      </g>
      <path fill={color} opacity={status === "idle" ? 0.7 : 1}>
        <animate attributeName="d" dur={dur} repeatCount="indefinite" values={`${open};${closed};${open}`} />
      </path>
      <circle cx="46" cy="24" r="5" fill="#0b1020" />
    </svg>
  );
});

/* --- pixel octopus sprite (memoized) --- */
const OCTO = ["....XXXXX....", "..XXXXXXXXX..", ".XXXXXXXXXXX.", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", "XX.XXX.XXX.XX", "X..X.X.X.X..X"];
const Octo = memo(function Octo({ color, size = 60, status = "idle", cto = false }) {
  if (cto) return <PacMan color={color} size={size} status={status} />;
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
});

/* --- furnished room interiors (memoized; only re-renders on color/work change) --- */
const RoomArt = memo(function RoomArt({ room, color, work }) {
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
});

/* --- one room (memoized on primitive props -> no flicker on unrelated updates) --- */
const Room = memo(function Room({ room, name, color, cto, status, task, department, cls, h, walk, sayHere, ctoAway, onPick }) {
  const busy = status === "working" || status === "command";
  return (
    <div data-room={room} className={`room ${cls}`} style={{ "--rc": color }} onClick={() => !cto && onPick(department)}>
      <div className="room-top"><span className="room-name">{roomLabel(room)}</span><span className="room-dots"><i /><i /><i /></span></div>
      <div className="scene" style={{ height: h }}>
        <svg className="room-art" viewBox="0 0 260 150" preserveAspectRatio="none"><RoomArt room={room} color={color} work={busy} /></svg>
        {sayHere && !cto && <div className="speech" style={{ borderColor: color, color }}>on it!</div>}
        {status === "thinking" && <div className="cue" style={{ color }}>?</div>}
        {status === "idle" && <div className="cue zzz">z z z</div>}
        <div className={`walker ${busy && !ctoAway ? "busy " + walk : ""}`}>
          <div className="oshadow" style={ctoAway ? { opacity: 0 } : undefined} />
          {!ctoAway && <Octo color={color} size={cto ? 76 : 56} status={status} cto={cto} />}
        </div>
        <div className="agent-tag" style={{ color }}>{name}</div>
      </div>
    </div>
  );
});

/* --- Team roster view --- */
function TeamView({ live, model }) {
  const liveBadge = (id) => {
    const a = live[id];
    if (!a) return ["IDLE", "#64786d"];
    const map = { command: ["ON-DUTY", "#a855f7"], working: ["ACTIVE", "#4ade80"], thinking: ["THINKING", "#eab308"], idle: ["IDLE", "#64786d"] };
    return map[a.status] || map.idle;
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

function DocsView({ documents, byId, onOpen }) {
  return (
    <div style={SS.libWrap}>
      <h1 style={SS.h1}><FileText size={20} /> Docs</h1>
      <div style={SS.libSub}>Deliverables your agents produced. Each one is linked to the task it came from — click to read the full output.</div>
      {documents.length === 0 && <div style={SS.queueEmpty}>No documents yet. Assign a task (e.g. research) — the completed deliverable lands here.</div>}
      <div style={SS.docsList}>
        {documents.map((d) => {
          const who = d.agentId && byId[d.agentId];
          return (
            <div key={d.id} style={SS.docRow} onClick={() => onOpen(d.id)}>
              <div style={SS.docRowHead}>
                <span style={SS.docTitle}>{d.title}</span>
                <span style={SS.docWhen}>{fmtWhen(d.createdAt)}</span>
              </div>
              <div style={SS.docMeta}>{who ? who.name : ""}{d.department ? ` · ${deptLabel(d.department)}` : ""}</div>
              <div style={SS.docSnippet}>{d.snippet}{d.snippet && d.snippet.length >= 160 ? "…" : ""}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MemoryView({ memory, onDelete }) {
  const sorted = [...memory].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return (
    <div style={SS.libWrap}>
      <h1 style={SS.h1}><Brain size={20} /> Memory</h1>
      <div style={SS.libSub}>What the agents remember. Each department keeps a rolling knowledge base it reads before new work and adds to after — so tasks build on each other.</div>
      {sorted.length === 0 && <div style={SS.queueEmpty}>No memory yet. As agents complete tasks, they record key facts here to continue from next time.</div>}
      <div style={SS.memGrid}>
        {sorted.map((m) => (
          <div key={m.scope} style={SS.memCard}>
            <div style={SS.memHead}>
              <Brain size={13} color="#a855f7" /> {deptLabel(m.scope)}
              <span style={SS.memWhen}>updated {fmtWhen(m.updatedAt)}</span>
              <button style={SS.memDel} title="Clear this department's memory" onClick={() => { if (confirm(`Clear all ${deptLabel(m.scope)} memory? This can't be undone.`)) onDelete(m.scope); }}><Trash2 size={12} /></button>
            </div>
            <pre style={SS.memContent}>{m.content || "(empty)"}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function IssuesView({ issues, byId, onResolve, onRetry }) {
  const KIND = { quota: ["QUOTA", "#fb923c"], auth: ["AUTH", "#fb5570"], review: ["REVIEW", "#eab308"], error: ["ERROR", "#fb5570"] };
  return (
    <div style={SS.libWrap}>
      <h1 style={SS.h1}><AlertTriangle size={20} color="#fb923c" /> Issues</h1>
      <div style={SS.libSub}>Problems Jay Jay escalated to you (Group CTO) — API/quota, auth, or tasks that failed. <b>Retry & resolve</b> sends the task back to the agent to try again (continuing from partial work); <b>Dismiss</b> just closes the issue.</div>
      {issues.length === 0 && <div style={SS.queueEmpty}>No open issues. Everything's running clean. ✓</div>}
      <div style={SS.docsList}>
        {issues.map((i) => {
          const [kl, kc] = KIND[i.kind] || ["ISSUE", "#fb923c"];
          const who = i.agentId && byId[i.agentId];
          return (
            <div key={i.id} style={{ ...SS.issueRow, borderColor: `${kc}55` }}>
              <div style={SS.issueTop}>
                <span style={{ ...SS.pill, color: kc, borderColor: `${kc}66`, background: `${kc}1a` }}>{kl}</span>
                <span style={SS.issueTitle}>{i.title}</span>
              </div>
              {i.detail && <pre style={SS.issueDetail}>{i.detail}</pre>}
              <div style={SS.issueBottom}>
                <span style={SS.issueMeta}>{who ? `${who.name} · ` : ""}{fmtWhen(i.createdAt)}</span>
                <div style={SS.issueActions}>
                  {i.taskId && <button style={SS.resolveBtn} onClick={() => onRetry(i)}><RotateCw size={12} /> Retry &amp; resolve</button>}
                  <button style={SS.dismissBtn} onClick={() => onResolve(i.id)}><Check size={12} /> Dismiss</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Placeholder({ icon: Icon, title, desc }) {
  return (
    <div style={SS.placeholder}>
      <div style={SS.placeholderIcon}><Icon size={40} color="#3a4a66" /></div>
      <div style={SS.placeholderTitle}>{title}</div>
      <div style={SS.placeholderSoon}>COMING SOON</div>
      <div style={SS.placeholderDesc}>{desc}</div>
    </div>
  );
}

export default function AgentOffice() {
  const { agents: live, tasks, events, documents, memory, issues, settings, gemini, model, demoModel, connected, assignTask, deleteTask, retryTask, clearTasks, control, logout, openDocument, deleteDocument, deleteMemory, resolveIssue } = useAgentSocket();
  const [view, setView] = useState("visual");
  const [form, setForm] = useState({ title: "", department: "", details: "" });
  const [selected, setSelected] = useState(null);
  const [doc, setDoc] = useState(null);
  const [say, setSay] = useState(null);
  const [courier, setCourier] = useState(null);
  const [taskFilter, setTaskFilter] = useState("all");
  const [idleDismissed, setIdleDismissed] = useState(false);
  const [autoDismissed, setAutoDismissed] = useState(false);
  const [files, setFiles] = useState([]);

  const downloadDoc = (id) => {
    const a = document.createElement("a");
    a.href = `/api/documents/${id}/download`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const roomsRef = useRef(null);
  const queueRef = useRef([]);
  const runningRef = useRef(false);
  const lastEvtRef = useRef(0);
  const timersRef = useRef([]);

  const agents = AGENTS.map((s) => ({
    ...s,
    ...(live[s.id] || { status: s.cto ? "command" : "idle", task: s.cto ? "running the office" : "standing by", last: "" }),
  }));
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));

  const taskList = Object.values(tasks).sort((a, b) => b.createdAt - a.createdAt);
  const activeTasks = taskList.filter((t) => ["queued", "in_progress", "review"].includes(t.status));
  const selectedTask = selected ? tasks[selected] : null;

  const onPick = useCallback((department) => setForm((f) => ({ ...f, department })), []);
  const openDoc = useCallback((id) => { openDocument(id).then(setDoc).catch(() => {}); }, [openDocument]);

  // Courier: Jay Jay walks Command HQ -> agent room -> back. One trip at a
  // time; trips chain without dropping the sprite, so HQ never flickers.
  const centerOf = (room) => {
    const cont = roomsRef.current;
    if (!cont) return null;
    const el = cont.querySelector(`[data-room="${room}"]`);
    if (!el) return null;
    const cr = cont.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: r.left - cr.left + r.width / 2, y: r.top - cr.top + r.height / 2 };
  };
  const step = () => {
    const item = queueRef.current.shift();
    if (!item) { setCourier(null); runningRef.current = false; return; }
    const hq = centerOf("COMMAND HQ"), tgt = centerOf(item.room);
    if (!hq || !tgt) { setCourier(null); runningRef.current = false; return; }
    const T = timersRef.current;
    setCourier({ ...item, coords: hq, showSpeech: false });
    setSay({ room: item.room });
    T.push(setTimeout(() => setCourier((c) => c && { ...c, coords: tgt }), 90));
    T.push(setTimeout(() => setCourier((c) => c && { ...c, showSpeech: true }), 1350));
    T.push(setTimeout(() => { setCourier((c) => c && { ...c, showSpeech: false, coords: hq }); setSay((s) => (s && s.room === item.room ? null : s)); }, 2800));
    T.push(setTimeout(step, 3950));
  };
  const runQueue = () => { if (runningRef.current) return; runningRef.current = true; step(); };

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

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
    if (queueRef.current.length > 4) queueRef.current = queueRef.current.slice(-4); // stay current
    if (view === "visual") runQueue();
  }, [events]);

  useEffect(() => { if (view === "visual") runQueue(); }, [view]);

  const submit = (e) => {
    e.preventDefault();
    const title = form.title.trim();
    if (!title) return;
    assignTask({ title, prompt: form.details.trim() || title, department: form.department || null }, files);
    setForm((f) => ({ ...f, title: "", details: "" }));
    setFiles([]);
  };
  const addFiles = (list) => setFiles((prev) => [...prev, ...Array.from(list)].slice(0, 6));
  const removeFile = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const badge = (s) => s === "command" ? ["ON-DUTY", "#a855f7"] : s === "working" ? ["ACTIVE", "#4ade80"] : s === "thinking" ? ["THINKING", "#eab308"] : ["IDLE", "#64786d"];
  const ticker = events.length ? events.slice(0, 16).map((e) => e.text) : ["Mission Control — connecting…"];
  const ctoAway = !!courier;

  const composer = (
    <form style={SS.compose} onSubmit={submit}>
      <select style={SS.select} value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}>
        {DEPT_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <input style={SS.input} placeholder="Task title…" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
      <textarea style={SS.textarea} rows={3} placeholder="Details / instructions (optional)" value={form.details} onChange={(e) => setForm((f) => ({ ...f, details: e.target.value }))} />
      <label style={SS.attachBtn}>
        <Paperclip size={12} /> Attach files (image / PDF / text)
        <input type="file" multiple accept="image/*,application/pdf,.txt,.csv,.md,.json" style={{ display: "none" }} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      </label>
      {files.length > 0 && (
        <div style={SS.fileChips}>
          {files.map((f, i) => (
            <span key={i} style={SS.fileChip} title={f.name}>
              {/^image\//.test(f.type) ? <ImageIcon size={11} /> : <Paperclip size={11} />}
              <span style={SS.fileChipName}>{f.name}</span>
              <button type="button" style={SS.fileChipX} onClick={() => removeFile(i)}><X size={10} /></button>
            </span>
          ))}
        </div>
      )}
      <button type="submit" style={SS.assignBtn}><Plus size={13} /> ASSIGN TASK</button>
    </form>
  );

  return (
    <div style={SS.root}>
      <style>{CSS}</style>

      <aside style={SS.side}>
        <div style={SS.brandWrap}>
          <Octo color="#facc15" size={46} status="command" cto />
          <div style={SS.brand}>MISSION<br />CONTROL</div>
          <div style={{ ...SS.online, color: connected ? "#4ade80" : "#eab308" }}>
            <span style={{ ...SS.onDot, background: connected ? "#4ade80" : "#eab308" }} />
            {connected ? "LIVE" : "RECONNECTING"}
          </div>
          <div style={SS.modePill}>
            {gemini ? <Sparkles size={11} /> : <Bot size={11} />} {gemini ? (model || "GEMINI") : "SIMULATION"}
          </div>
        </div>

        <nav style={SS.nav}>
          {NAV.map(([label, Icon, key]) => {
            const active = view === key;
            return (
              <div key={key} style={{ ...SS.navItem, ...(active ? SS.navActive : {}) }} onClick={() => setView(key)}>
                <Icon size={16} /> <span>{label}</span>{active && <span style={SS.navDot} />}
              </div>
            );
          })}
        </nav>

        <button onClick={() => setView("issues")} style={{ ...SS.issuesBadge, ...(issues.length ? {} : SS.issuesBadgeClean), ...(view === "issues" ? SS.issuesBadgeActive : {}) }}>
          <AlertTriangle size={13} /> {issues.length ? `${issues.length} Issue${issues.length > 1 ? "s" : ""}` : "No issues"}
        </button>
        <button onClick={logout} style={SS.sideLogout}><LogOut size={14} /> Logout</button>
      </aside>

      <main style={SS.main}>
        {view === "visual" && (
          <>
            <div style={SS.head}>
              <h1 style={SS.h1}><Gamepad2 size={20} /> CTO Agent Office {settings.paused && <span style={SS.pausedChip}>PAUSED</span>}</h1>
              <div style={SS.controls}>
                <button onClick={() => control("dispatch")} className="mc-btn" style={{ ...SS.btn, ...SS.gold }}><Crown size={12} /> DISPATCH</button>
                <button onClick={() => control("all_hands")} className="mc-btn" style={{ ...SS.btn, ...SS.go }}><Zap size={12} /> ALL HANDS</button>
                <button onClick={() => control("clock_out")} className="mc-btn" style={{ ...SS.btn, ...SS.stop }}><Power size={12} /> CLOCK OUT</button>
                <button onClick={() => control("toggle_autonomous", { autonomous: !settings.autonomous })} className="mc-btn" style={{ ...SS.btn, ...(settings.autonomous ? SS.autoOn : SS.autoOff) }}><Bot size={12} /> AUTO {settings.autonomous ? "ON" : "OFF"}</button>
              </div>
            </div>

            <div style={SS.toastWrap}>
              {settings.autonomous && !autoDismissed && (
                <div style={SS.autoBanner}>
                  <span style={{ flex: 1 }}>
                    <Bot size={13} style={{ verticalAlign: -2, marginRight: 5 }} /><b>AUTO is ON — visual demo.</b> {demoModel
                      ? <>Demo tasks run on <b>{demoModel}</b> (free tier) — no paid Pro calls. Only tasks <b>you</b> assign use {model || "the paid model"}.</>
                      : <>Demo tasks are simulated — <b>no Gemini calls, costs nothing</b>. Only tasks <b>you</b> assign use the API.</>}
                  </span>
                  <button style={SS.bannerClose} onClick={() => setAutoDismissed(true)} title="Dismiss"><X size={14} /></button>
                </div>
              )}
              {!settings.autonomous && activeTasks.length === 0 && !idleDismissed && (
                <div style={SS.idleBanner}>
                  <span style={{ flex: 1 }}>Office idle — assign a task in the <b>Tasks</b> tab and Jay Jay will dispatch it (real work, uses the API). Or press <b>AUTO ON</b> for a free visual demo.</span>
                  <button style={SS.bannerClose} onClick={() => setIdleDismissed(true)} title="Dismiss"><X size={14} /></button>
                </div>
              )}
            </div>

            <div className="rooms" ref={roomsRef} style={{ position: "relative" }}>
              {ROOMS.map((room) => {
                const a = agents.find((x) => x.room === room), m = META[room];
                return (
                  <Room key={room} room={room} name={a.name} color={a.color} cto={!!a.cto} status={a.status} task={a.task}
                    department={a.department} cls={m.cls} h={m.h} walk={m.walk}
                    sayHere={say?.room === room} ctoAway={a.cto && ctoAway} onPick={onPick} />
                );
              })}
              {courier && (
                <div className="courier" style={{ left: courier.coords.x - 30, top: courier.coords.y - 50 }}>
                  {courier.showSpeech && <div className="courier-say">→ {courier.name}: {courier.task}</div>}
                  <div className="oshadow courier-shadow" />
                  <Octo color="#facc15" size={58} status="working" cto />
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

        {view === "tasks" && (
          <div style={SS.tasksWrap}>
            <h1 style={SS.h1}><Target size={20} /> Tasks</h1>
            <div style={SS.tasksGrid}>
              <div style={SS.tasksCompose}>
                <div style={SS.secTitle}>ASSIGN A TASK</div>
                {composer}
                <div style={SS.composeHint}>Pick a department (or “Any”) and Jay Jay routes it to the right agent.</div>
              </div>
              <div style={SS.tasksList}>
                <div style={SS.tasksListHead}>
                  <div style={SS.secTitle}>QUEUE · {activeTasks.length} active · {taskList.length} total</div>
                  <div style={SS.chipRow}>
                    {[["all", "All"], ["mine", "Mine"], ["auto", "Auto"]].map(([k, l]) => (
                      <button key={k} style={{ ...SS.chip, ...(taskFilter === k ? SS.chipActive : {}) }} onClick={() => setTaskFilter(k)}>{l}</button>
                    ))}
                  </div>
                </div>
                {taskList.length > 0 && (
                  <div style={SS.clearRow}>
                    <button style={SS.clearBtn} onClick={() => { if (confirm("Remove all auto-generated (demo) tasks?")) clearTasks("auto"); }}><Trash2 size={11} /> Clear demo (auto)</button>
                    <button style={SS.clearBtn} onClick={() => { if (confirm("Remove all completed tasks (done/failed)?")) clearTasks("done"); }}><Trash2 size={11} /> Clear completed</button>
                  </div>
                )}
                {(() => {
                  const shown = taskList.filter((t) => taskFilter === "all" ? true : taskFilter === "mine" ? t.createdBy === "user" : t.createdBy !== "user");
                  if (!shown.length) return <div style={SS.queueEmpty}>{taskFilter === "mine" ? "You haven't assigned any tasks yet — use the composer on the left." : taskFilter === "auto" ? "No auto-generated tasks (AUTO is off or idle)." : "No tasks yet. Add one, or let Jay Jay run the office in Visual."}</div>;
                  return shown.map((t) => {
                    const col = STATUS_COLOR[t.status] || "#64786d";
                    const mine = t.createdBy === "user";
                    const [sl, sc] = mine ? ["YOU", "#a855f7"] : ["AUTO", "#5e7088"];
                    return (
                      <div key={t.id} style={SS.taskRow} onClick={() => setSelected(t.id)}>
                        <span style={{ ...SS.pill, color: col, borderColor: `${col}66`, background: `${col}1a` }}>{STATUS_LABEL[t.status]}</span>
                        <span style={{ ...SS.srcBadge, color: sc, borderColor: `${sc}66`, background: `${sc}1a` }}>{sl}</span>
                        <span style={SS.taskRowTitle}>{t.title}</span>
                        {t.assignedTo && byId[t.assignedTo] && <span style={SS.taskRowWho}>{byId[t.assignedTo].name}</span>}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        )}

        {view === "team" && <TeamView live={live} model={model} />}

        {view === "docs" && <DocsView documents={documents} byId={byId} onOpen={openDoc} />}

        {view === "memory" && <MemoryView memory={memory} onDelete={deleteMemory} />}

        {view === "issues" && <IssuesView issues={issues} byId={byId} onResolve={resolveIssue} onRetry={(i) => { if (i.taskId) retryTask(i.taskId); resolveIssue(i.id); }} />}

        {PLACEHOLDER[view] && <Placeholder icon={PLACEHOLDER[view].icon} title={PLACEHOLDER[view].title} desc={PLACEHOLDER[view].desc} />}
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
              <span style={{ ...SS.srcBadge, color: selectedTask.createdBy === "user" ? "#a855f7" : "#5e7088", borderColor: selectedTask.createdBy === "user" ? "#a855f766" : "#5e708866", background: selectedTask.createdBy === "user" ? "#a855f71a" : "#5e70881a", marginRight: 8 }}>
                {selectedTask.createdBy === "user" ? "ASSIGNED BY YOU" : "AUTO-GENERATED"}
              </span>
              {selectedTask.department ? (DEPT_OPTS.find((d) => d[0] === selectedTask.department)?.[1] || selectedTask.department) : "Any department"}
              {selectedTask.assignedTo && byId[selectedTask.assignedTo] ? ` · ${byId[selectedTask.assignedTo].name}` : ""}
              {selectedTask.attempts ? ` · attempt ${selectedTask.attempts + 1}` : ""}
            </div>
            {selectedTask.prompt && selectedTask.prompt !== selectedTask.title && <div style={SS.modalPrompt}>{selectedTask.prompt}</div>}
            {selectedTask.attachments && selectedTask.attachments.length > 0 && (
              <>
                <div style={SS.secTitle}>ATTACHMENTS ({selectedTask.attachments.length})</div>
                <div style={SS.attachGrid}>
                  {selectedTask.attachments.map((a) => /^image\//.test(a.mime)
                    ? <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noopener"><img src={`/api/attachments/${a.id}`} alt={a.filename} style={SS.attachThumb} /></a>
                    : <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noopener" style={SS.attachFile}><Paperclip size={12} /> {a.filename}</a>)}
                </div>
              </>
            )}
            {["failed", "blocked"].includes(selectedTask.status) && selectedTask.reviewNotes && (
              <div style={SS.failReason}>
                <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                <span><b>Why it {selectedTask.status === "blocked" ? "is blocked" : "failed"}:</b> {selectedTask.reviewNotes}</span>
              </div>
            )}
            <div style={SS.secTitle}>{["failed", "blocked"].includes(selectedTask.status) ? "PARTIAL WORK SO FAR" : "DELIVERABLE"}</div>
            <div style={SS.resultBox}>{selectedTask.result || (selectedTask.status === "queued" ? "Waiting in the queue…" : "Working…")}</div>
            {selectedTask.reviewNotes && !["failed", "blocked"].includes(selectedTask.status) && <div style={SS.reviewNote}>CTO review: {selectedTask.reviewNotes}</div>}
            <div style={SS.modalActions}>
              {["failed", "blocked"].includes(selectedTask.status) && <button style={SS.continueBtn} onClick={() => retryTask(selectedTask.id)}><RotateCw size={13} /> CONTINUE TASK</button>}
              {(() => { const td = documents.find((d) => d.taskId === selectedTask.id); return td ? <button style={SS.downloadBtn} onClick={() => downloadDoc(td.id)}><Download size={13} /> DOWNLOAD .DOC</button> : null; })()}
              <button style={SS.delBtn} onClick={() => { deleteTask(selectedTask.id); setSelected(null); }}><Trash2 size={13} /> DELETE TASK</button>
            </div>
          </div>
        </div>
      )}

      {doc && (
        <div style={SS.modalBg} onClick={() => setDoc(null)}>
          <div style={SS.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={SS.modalHead}>
              <span style={{ ...SS.pill, color: "#38bdf8", borderColor: "#38bdf866", background: "#38bdf81a" }}><FileText size={9} style={{ verticalAlign: "-1px", marginRight: 3 }} />DOCUMENT</span>
              <button style={SS.modalClose} onClick={() => setDoc(null)}><X size={16} /></button>
            </div>
            <div style={SS.modalTitle}>{doc.title}</div>
            <div style={SS.modalMeta}>
              {doc.agentId && byId[doc.agentId] ? `${byId[doc.agentId].name} · ` : ""}{deptLabel(doc.department)} · {fmtWhen(doc.createdAt)}
            </div>
            {doc.prompt && <><div style={SS.secTitle}>ASSIGNED TASK</div><div style={SS.modalPrompt}>{doc.prompt}</div></>}
            <div style={SS.secTitle}>OUTPUT</div>
            <div style={SS.resultBox}>{doc.content}</div>
            <div style={SS.modalActions}>
              <button style={SS.downloadBtn} onClick={() => downloadDoc(doc.id)}><Download size={13} /> DOWNLOAD .DOC</button>
              <button style={SS.delBtn} onClick={() => { if (confirm("Delete this document?")) { deleteDocument(doc.id); setDoc(null); } }}><Trash2 size={13} /> DELETE</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const PIX = "'Press Start 2P', monospace";
const MONO = "'JetBrains Mono', ui-monospace, monospace";
const SS = {
  root: { display: "flex", fontFamily: MONO, color: "#cfe3d8", background: "#0a0e1a", borderRadius: 14, overflow: "hidden", border: "1px solid #1a2440", minHeight: "calc(100vh - 32px)", maxWidth: 1440, margin: "0 auto" },
  side: { width: 200, flexShrink: 0, background: "linear-gradient(180deg,#0c1226,#0a0e1a)", borderRight: "1px solid #1a2440", padding: "18px 14px", display: "flex", flexDirection: "column", gap: 16 },
  brandWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 7, textAlign: "center", paddingBottom: 14, borderBottom: "1px solid #1a2440" },
  brand: { fontFamily: PIX, fontSize: 12, lineHeight: 1.6, color: "#e8edff", letterSpacing: 1 },
  online: { fontSize: 9.5, display: "flex", alignItems: "center", gap: 5, letterSpacing: 1 },
  onDot: { width: 7, height: 7, borderRadius: 99, boxShadow: "0 0 6px currentColor" },
  modePill: { fontSize: 8.5, letterSpacing: 1, color: "#9db0c8", display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 99, border: "1px solid #243358", background: "#0a1020" },
  nav: { display: "flex", flexDirection: "column", gap: 3 },
  navItem: { display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 9, fontSize: 13, color: "#8aa0c0", cursor: "pointer", position: "relative" },
  navActive: { background: "#15203f", color: "#e8edff", border: "1px solid #243358" },
  navDot: { position: "absolute", right: 12, width: 7, height: 7, borderRadius: 99, background: "#4ade80", boxShadow: "0 0 6px #4ade80" },
  sideLogout: { display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "9px", borderRadius: 8, border: "1px solid #243358", background: "transparent", color: "#9db0c8", fontFamily: MONO, fontSize: 12, fontWeight: 700, cursor: "pointer" },
  issuesBadge: { marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "9px", borderRadius: 8, border: "1px solid rgba(251,85,112,.45)", background: "rgba(251,85,112,.12)", color: "#fca5b5", fontFamily: MONO, fontSize: 11.5, fontWeight: 700, cursor: "pointer" },
  issuesBadgeClean: { border: "1px solid #1a3a2a", background: "rgba(74,222,128,.06)", color: "#6fae8a" },
  issuesBadgeActive: { outline: "1px solid #3a4a66" },
  issueRow: { background: "#0c1226", border: "1px solid", borderRadius: 11, padding: "12px 14px" },
  issueTop: { display: "flex", alignItems: "center", gap: 9 },
  issueTitle: { fontSize: 12.5, fontWeight: 700, color: "#e8edff", flex: 1 },
  resolveBtn: { display: "flex", alignItems: "center", gap: 5, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: "6px 10px", borderRadius: 7, border: "1px solid rgba(74,222,128,.4)", background: "rgba(74,222,128,.1)", color: "#bbf7d0", cursor: "pointer", fontFamily: MONO, flexShrink: 0 },
  dismissBtn: { display: "flex", alignItems: "center", gap: 5, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: "6px 10px", borderRadius: 7, border: "1px solid #243358", background: "transparent", color: "#9db0c8", cursor: "pointer", fontFamily: MONO, flexShrink: 0 },
  issueDetail: { margin: "9px 0 0", fontFamily: MONO, fontSize: 10.5, color: "#9db0c8", lineHeight: 1.5, whiteSpace: "pre-wrap", background: "#070a14", border: "1px solid #161f3a", borderRadius: 7, padding: "8px 10px", maxHeight: 160, overflowY: "auto" },
  issueBottom: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 9, flexWrap: "wrap" },
  issueActions: { display: "flex", gap: 7 },
  issueMeta: { fontSize: 9.5, color: "#5e7088" },
  main: { flex: 1, minWidth: 0, padding: 18, background: "radial-gradient(120% 90% at 50% -10%, #0e1430, #0a0e1a 60%)", overflowY: "auto", maxHeight: "calc(100vh - 32px)" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  h1: { margin: 0, fontSize: 22, fontWeight: 800, color: "#e8edff", display: "flex", alignItems: "center", gap: 10 },
  pausedChip: { fontSize: 9, fontWeight: 700, letterSpacing: 1, color: "#fca5b5", border: "1px solid #fb557066", background: "#fb55701a", borderRadius: 99, padding: "3px 8px" },
  toastWrap: { position: "fixed", top: 18, right: 18, zIndex: 50, display: "flex", flexDirection: "column", gap: 8, width: 360, maxWidth: "calc(100vw - 36px)" },
  autoBanner: { display: "flex", alignItems: "flex-start", gap: 10, fontSize: 11, color: "#fcd9b6", background: "rgba(234,179,8,.12)", border: "1px solid rgba(234,179,8,.4)", borderRadius: 10, padding: "10px 12px", lineHeight: 1.45, boxShadow: "0 12px 32px rgba(0,0,0,.45)" },
  idleBanner: { display: "flex", alignItems: "flex-start", gap: 10, fontSize: 11, color: "#cfe3d8", background: "#0c1226", border: "1px solid #243358", borderRadius: 10, padding: "11px 13px", lineHeight: 1.45, boxShadow: "0 12px 32px rgba(0,0,0,.5)" },
  controls: { display: "flex", gap: 7, flexWrap: "wrap" },
  btn: { display: "flex", alignItems: "center", gap: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: .5, padding: "8px 11px", borderRadius: 8, cursor: "pointer", fontFamily: MONO, border: "1px solid" },
  gold: { color: "#1a1405", background: "#f5c95b", borderColor: "#f5c95b" },
  go: { color: "#bbf7d0", background: "rgba(74,222,128,.1)", borderColor: "rgba(74,222,128,.4)" },
  stop: { color: "#fca5b5", background: "rgba(251,85,112,.1)", borderColor: "rgba(251,85,112,.4)" },
  autoOn: { color: "#c4b5fd", background: "rgba(168,85,247,.12)", borderColor: "rgba(168,85,247,.5)" },
  autoOff: { color: "#7a8aa0", background: "rgba(120,140,170,.06)", borderColor: "#243358" },
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
  // tasks
  tasksWrap: { display: "flex", flexDirection: "column", gap: 16 },
  tasksGrid: { display: "grid", gridTemplateColumns: "minmax(240px,320px) 1fr", gap: 16, alignItems: "start" },
  tasksCompose: { background: "#0c1226", border: "1px solid #1a2440", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8 },
  composeHint: { fontSize: 10, color: "#5e7088", lineHeight: 1.5 },
  tasksList: { display: "flex", flexDirection: "column", gap: 6 },
  tasksListHead: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 2 },
  chipRow: { display: "flex", gap: 6 },
  chip: { fontSize: 9.5, fontWeight: 700, padding: "5px 11px", borderRadius: 99, border: "1px solid #243358", background: "transparent", color: "#8aa0c0", cursor: "pointer", fontFamily: MONO },
  chipActive: { background: "#15203f", color: "#e8edff", borderColor: "#3a4a66" },
  clearRow: { display: "flex", gap: 8, marginBottom: 2 },
  clearBtn: { display: "flex", alignItems: "center", gap: 5, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: "6px 10px", borderRadius: 7, border: "1px solid rgba(251,85,112,.35)", background: "rgba(251,85,112,.08)", color: "#fca5b5", cursor: "pointer", fontFamily: MONO },
  srcBadge: { fontSize: 7.5, fontWeight: 700, padding: "2px 6px", borderRadius: 99, border: "1px solid", letterSpacing: 0.8, flexShrink: 0 },
  taskRow: { display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", borderRadius: 9, background: "#0c1226", border: "1px solid #1a2440", cursor: "pointer" },
  taskRowTitle: { fontSize: 12, color: "#e8edff", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  taskRowWho: { fontSize: 9, color: "#8aa0c0", letterSpacing: 0.5 },
  secTitle: { fontSize: 9, letterSpacing: 1.5, color: "#5e7088", fontWeight: 700, margin: "2px 0" },
  compose: { display: "flex", flexDirection: "column", gap: 7 },
  select: { padding: "8px 9px", borderRadius: 7, border: "1px solid #243358", background: "#070a14", color: "#e8edff", fontFamily: MONO, fontSize: 11 },
  input: { padding: "9px 10px", borderRadius: 7, border: "1px solid #243358", background: "#070a14", color: "#e8edff", fontFamily: MONO, fontSize: 12 },
  textarea: { padding: "9px 10px", borderRadius: 7, border: "1px solid #243358", background: "#070a14", color: "#e8edff", fontFamily: MONO, fontSize: 11, resize: "vertical" },
  assignBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px", borderRadius: 7, border: "1px solid #a855f7", background: "#a855f7", color: "#0b1020", fontWeight: 700, fontSize: 10, letterSpacing: 1, cursor: "pointer", fontFamily: MONO },
  attachBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px", borderRadius: 7, border: "1px dashed #3a4a66", background: "transparent", color: "#9db0c8", fontSize: 10, cursor: "pointer", fontFamily: MONO },
  fileChips: { display: "flex", flexDirection: "column", gap: 4 },
  fileChip: { display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 6, background: "#0a1020", border: "1px solid #1a2440", fontSize: 10, color: "#cfe3d8" },
  fileChipName: { flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  fileChipX: { background: "transparent", border: "none", color: "#8aa0c0", cursor: "pointer", padding: 0, display: "flex" },
  attachGrid: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12, marginTop: 4 },
  attachThumb: { width: 84, height: 84, objectFit: "cover", borderRadius: 8, border: "1px solid #243358", display: "block" },
  attachFile: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#9db0c8", textDecoration: "none", padding: "8px 10px", borderRadius: 8, border: "1px solid #243358", background: "#070a14" },
  queueEmpty: { fontSize: 11, color: "#5e7088", lineHeight: 1.5, padding: "6px 2px" },
  pill: { fontSize: 7.5, fontWeight: 700, padding: "2px 6px", borderRadius: 99, border: "1px solid", letterSpacing: 0.8, flexShrink: 0 },
  // docs + memory
  libWrap: { display: "flex", flexDirection: "column", gap: 6 },
  libSub: { fontSize: 11.5, color: "#7a8aa0", marginBottom: 10, lineHeight: 1.45, maxWidth: 640 },
  docsList: { display: "flex", flexDirection: "column", gap: 8 },
  docRow: { background: "#0c1226", border: "1px solid #1a2440", borderRadius: 10, padding: "11px 13px", cursor: "pointer" },
  docRowHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 },
  docTitle: { fontSize: 13, fontWeight: 700, color: "#e8edff" },
  docWhen: { fontSize: 9.5, color: "#5e7088", flexShrink: 0 },
  docMeta: { fontSize: 10, color: "#8aa0c0", marginTop: 3, letterSpacing: 0.3 },
  docSnippet: { fontSize: 11, color: "#9db0c8", marginTop: 7, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  memGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12 },
  memCard: { background: "#0c1226", border: "1px solid #1a2440", borderRadius: 12, padding: 14 },
  memHead: { display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 800, color: "#e8edff" },
  memWhen: { marginLeft: "auto", fontSize: 9, color: "#5e7088", fontWeight: 400 },
  memDel: { marginLeft: 6, display: "flex", alignItems: "center", padding: 4, borderRadius: 6, border: "1px solid rgba(251,85,112,.3)", background: "rgba(251,85,112,.08)", color: "#fca5b5", cursor: "pointer" },
  memContent: { margin: "10px 0 0", fontFamily: MONO, fontSize: 11, color: "#9db0c8", lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 240, overflowY: "auto" },
  // placeholder
  placeholder: { minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, textAlign: "center" },
  placeholderIcon: { width: 80, height: 80, borderRadius: 18, display: "grid", placeItems: "center", background: "#0c1226", border: "1px solid #1a2440", marginBottom: 6 },
  placeholderTitle: { fontSize: 20, fontWeight: 800, color: "#e8edff" },
  placeholderSoon: { fontSize: 9, letterSpacing: 2, color: "#a855f7", fontWeight: 700 },
  placeholderDesc: { fontSize: 12, color: "#7a8aa0", maxWidth: 340, lineHeight: 1.5 },
  // team
  teamWrap: { display: "flex", flexDirection: "column", gap: 22 },
  teamHeadRow: { display: "flex", flexDirection: "column", gap: 4, marginBottom: 2 },
  teamSub: { fontSize: 11.5, color: "#7a8aa0" },
  teamSection: { display: "flex", flexDirection: "column", gap: 10 },
  teamSectionTitle: { fontSize: 9, letterSpacing: 2.5, color: "#5e7088", fontWeight: 700, textAlign: "center" },
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
  failReason: { display: "flex", gap: 8, fontSize: 11.5, color: "#fcd9b6", background: "rgba(251,146,60,.1)", border: "1px solid rgba(251,146,60,.35)", borderRadius: 8, padding: "9px 11px", margin: "10px 0 4px", lineHeight: 1.45 },
  continueBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(74,222,128,.45)", background: "rgba(74,222,128,.12)", color: "#bbf7d0", fontWeight: 700, fontSize: 9.5, letterSpacing: 1, cursor: "pointer", fontFamily: MONO },
  modalActions: { display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" },
  downloadBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8, border: "1px solid #a855f7", background: "#a855f7", color: "#0b1020", fontWeight: 700, fontSize: 9.5, letterSpacing: 1, cursor: "pointer", fontFamily: MONO },
  delBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 11px", borderRadius: 8, border: "1px solid rgba(251,85,112,.4)", background: "rgba(251,85,112,.1)", color: "#fca5b5", fontWeight: 700, fontSize: 9.5, letterSpacing: 1, cursor: "pointer", fontFamily: MONO },
  bannerClose: { background: "transparent", border: "none", color: "#8aa0c0", cursor: "pointer", padding: 2, display: "flex", flexShrink: 0 },
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
.courier { position:absolute; z-index:7; display:flex; flex-direction:column; align-items:center; pointer-events:none; transition:left 1.2s cubic-bezier(.45,.05,.3,1), top 1.2s cubic-bezier(.45,.05,.3,1); }
.courier-shadow { background:#facc15; }
.courier-say { position:absolute; bottom:100%; margin-bottom:4px; font-family:'JetBrains Mono'; font-weight:700; font-size:9px; color:#fde68a; background:#070a14; border:1px solid #facc15; border-radius:6px; padding:3px 8px; white-space:nowrap; max-width:220px; overflow:hidden; text-overflow:ellipsis; box-shadow:0 0 10px #facc1555; }
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
.mc-marquee { animation:marq 26s linear infinite; will-change:transform; } @keyframes marq { from{transform:translateX(0);} to{transform:translateX(-50%);} }
.mc-btn:hover { filter:brightness(1.15); } .mc-btn:active { transform:scale(.97); }
`;
