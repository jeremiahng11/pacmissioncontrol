import React, { useState, useEffect, useRef, useCallback, memo } from "react";
import {
  Target, Satellite, Calendar, Rocket, Brain, FileText, Users, Gamepad2,
  Crown, Zap, Power, Plus, LogOut, Trash2, X, Bot, Sparkles, User, AlertTriangle, Check, Download, RotateCw, Paperclip, Image as ImageIcon, Key, Activity, Search, Eye,
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
  ["Stats", Activity, "stats"],
  ["Calendar", Calendar, "calendar"],
  ["Projects", Rocket, "projects"],
  ["Memory", Brain, "memory"],
  ["Docs", FileText, "docs"],
  ["Team", Users, "team"],
  ["Visual", Gamepad2, "visual"],
];

const PLACEHOLDER = {
  content:  { icon: Satellite, title: "Content",  desc: "Plan and track the content your agents produce. Coming soon — for now, assign content tasks in Tasks and find the results in Docs." },
};

const fmtTok = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n || 0));
const fmtTime = (ms) => { try { return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const EVENT_COLOR = { assign: "#facc15", handoff: "#67e8f9", tool: "#38bdf8", review: "#eab308", done: "#4ade80", redo: "#fb923c", fail: "#fb5570", issue: "#fb5570", system: "#9db0c8" };
const WORK_INFO = { development: ["</>", "coding"], observatory: ["◎", "scanning"], research_lab: ["✎", "writing"], security: ["⛨", "auditing"], admin: ["▤", "sorting"], _: ["•", "working"] };
const WORK_FX = { development: ["</>", "{ }", ";", "()", "=>"], observatory: ["✦", "·", "◦", "✧", "·"], research_lab: ["✎", "¶", "A", "“", "·"], security: ["⛨", "✓", "!", "·", "✓"], admin: ["▤", "≡", "✓", "·", "▦"], _: ["·", "·", "·"] };
const PREVIEW_DEVICES = [["mobile", "Mobile", 390], ["mobileL", "Mobile L", 430], ["tablet", "Tablet", 768], ["desktop", "Desktop", 1280]];

const fmtCadence = (r) => {
  if (r.cadenceType === "interval") return r.everyMinutes >= 60 && r.everyMinutes % 60 === 0 ? `every ${r.everyMinutes / 60}h` : `every ${r.everyMinutes}m`;
  if (r.cadenceType === "daily") return `daily ${r.dailyTime} UTC`;
  if (r.cadenceType === "once") return `once`;
  return r.cadenceType;
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
      desc: "The central brain. Plans complex goals into sub-tasks, routes work to the right department, QA-reviews every deliverable, assembles results, and keeps the team moving." },
  ]},
  { section: "DEPARTMENTS", members: [
    { id: "scout",  name: "SCOUT",  role: "Researcher · Observatory",      color: "#38bdf8", cadence: "On demand",
      desc: "Investigates questions and scans for signal, then reports concise, well-organized findings." },
    { id: "warden", name: "WARDEN", role: "Sentinel · Security",           color: "#fb5570", cadence: "On demand",
      desc: "Assesses risks, reviews for vulnerabilities and compliance gaps, and reports prioritized security findings." },
    { id: "scribe", name: "SCRIBE", role: "Writer · Research Lab",         color: "#f472b6", cadence: "On demand",
      desc: "Produces clear written deliverables — summaries, briefs, and reports." },
    { id: "orbit",  name: "ORBIT",  role: "Engineer · Development Center", color: "#a855f7", cadence: "On demand",
      desc: "Builds apps and platforms and writes clean, correct code (downloadable as files or a .zip), and can test live APIs using sandbox credentials." },
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

const STATUS_COLOR = { queued: "#64786d", in_progress: "#4ade80", review: "#eab308", done: "#38bdf8", failed: "#fb5570", blocked: "#fb923c", planning: "#a855f7" };
const STATUS_LABEL = { queued: "QUEUED", in_progress: "WORKING", review: "REVIEW", done: "DONE", failed: "FAILED", blocked: "ISSUE", planning: "PLANNING" };

/* --- pixel Pac-Man sprite for the CTO (Jay Jay), drawn like the octopus --- */
const PAC_OPEN = ["....XXXXX....", "..XXXXXXXXX..", ".XXXXXXXXXXX.", "XXXXXXXXXXXXX", "XXXXXXXXXXX..", "XXXXXXXXX....", "XXXXXX.......", "XXXXXXXXX....", "XXXXXXXXXXX..", "XXXXXXXXXXXXX", ".XXXXXXXXXXX.", "..XXXXXXXXX..", "....XXXXX...."];
const PAC_CLOSED = ["....XXXXX....", "..XXXXXXXXX..", ".XXXXXXXXXXX.", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", "XXXXXXXXXXXX.", "XXXXXXXXXX...", "XXXXXXXXXXXX.", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", ".XXXXXXXXXXX.", "..XXXXXXXXX..", "....XXXXX...."];
const pacGrid = (rows, color, dim) => rows.map((row, r) => row.split("").map((c, x) => c === "X" ? <rect key={`${r}-${x}`} x={x} y={r} width="1" height="1" fill={color} opacity={dim} /> : null));
const PacMan = memo(function PacMan({ color = "#facc15", size = 60, status = "idle", flip = false }) {
  const moving = status !== "idle";
  const dur = status === "working" || status === "command" ? "0.42s" : status === "thinking" ? "0.6s" : "0.9s";
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" shapeRendering="crispEdges"
      style={{ overflow: "visible", display: "block", transform: flip ? "scaleX(-1)" : undefined, filter: status === "idle" ? "none" : `drop-shadow(0 0 5px ${color}66)` }}>
      {moving ? (
        <>
          <g className="pac-a" style={{ animationDuration: dur }}>{pacGrid(PAC_OPEN, color, 1)}</g>
          <g className="pac-b" style={{ animationDuration: dur }}>{pacGrid(PAC_CLOSED, color, 1)}</g>
        </>
      ) : (
        <g>{pacGrid(PAC_OPEN, color, 0.85)}</g>
      )}
      <rect x="6.6" y="1" width="2.3" height="2.7" fill="#fff" />
      <rect x="7.5" y="1.7" width="1.2" height="1.7" fill="#0b1020" />
    </svg>
  );
});

/* --- pixel octopus sprite (memoized) --- */
const OCTO = ["....XXXXX....", "..XXXXXXXXX..", ".XXXXXXXXXXX.", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", "XXXXXXXXXXXXX", "XX.XXX.XXX.XX", "X..X.X.X.X..X"];
const Octo = memo(function Octo({ color, size = 60, status = "idle", cto = false, flip = false }) {
  if (cto) return <PacMan color={color} size={size} status={status} flip={flip} />;
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
        : (<g><rect x="3" y="3" width="3" height="4" fill="#fff" /><rect x="7" y="3" width="3" height="4" fill="#fff" />
            <g className={work ? "iris-scan" : ""} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
              <rect x={4} y={5 + look} width="1.4" height="1.8" fill="#0b1020" />
              <rect x={8} y={5 + look} width="1.4" height="1.8" fill="#0b1020" />
            </g></g>)}
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
  // A monitor showing animated, syntax-coloured "code" that types itself.
  const codeScreen = (x, y, w, h) => {
    const cols = [c, "#67e8f9", "#4ade80", "#facc15", "#f472b6"];
    const indents = [0, 7, 7, 14, 7, 0, 14, 7];
    const lineH = 4.2, pad = 4, top = y + 7.5;
    const n = Math.max(2, Math.floor((h - 11) / lineH));
    const lines = [];
    for (let i = 0; i < n; i++) {
      const ind = indents[i % indents.length];
      const lw = Math.max(8, (w - pad * 2 - ind) * (0.5 + ((i * 37) % 50) / 100));
      lines.push(<rect key={i} x={x + pad + ind} y={top + i * lineH} width={lw} height="2" rx="1" fill={cols[(i + ind) % cols.length]} opacity={on} className={work ? "code-type" : ""} style={{ transformBox: "fill-box", transformOrigin: "left", animationDelay: `${(i % n) * 0.28}s`, animationDuration: `${1.5 + (i % 3) * 0.5}s` }} />);
    }
    return (<g>
      <rect x={x} y={y} width={w} height={h} rx="2" fill="#05080f" stroke={c} strokeOpacity="0.65" />
      <rect x={x} y={y} width={w} height="4.5" rx="2" fill={c} opacity="0.22" />
      {[2.5, 6, 9.5].map((dx, i) => <circle key={i} cx={x + dx + 1} cy={y + 2.4} r="0.9" fill={c} opacity="0.55" />)}
      {lines}
      <rect className="code-cursor" x={x + pad + indents[(n - 1) % indents.length]} y={top + (n - 1) * lineH - 0.5} width="2.2" height="3" fill="#e8edff" />
    </g>);
  };

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
    case "WORKSHOP": // Development Center — a coder's setup with live code on the screens
      furn = (<g>
        {/* central code editor + two side monitors, all typing live code */}
        {codeScreen(84, 5, 92, 50)}
        {codeScreen(12, 13, 60, 38)}
        {codeScreen(188, 13, 60, 38)}
        {/* monitor stand for the main screen */}
        <rect x="126" y="55" width="8" height="7" rx="1" fill={c} opacity="0.4" /><rect x="118" y="61" width="24" height="3" rx="1" fill={c} opacity="0.4" />
        {/* desk */}
        <rect x="12" y="106" width="236" height="8" rx="2" fill={c} opacity="0.5" /><rect x="20" y="114" width="5" height="20" fill={c} opacity="0.32" /><rect x="235" y="114" width="5" height="20" fill={c} opacity="0.32" />
        {/* terminal window on the desk */}
        {codeScreen(150, 84, 64, 18)}
        {/* keyboard — keys flash like key-presses while coding */}
        <g opacity="0.7">
          <rect x="34" y="90" width="70" height="13" rx="2" fill="#04060d" stroke={c} strokeOpacity="0.5" />
          {[0, 1].map((r) => [40, 49, 58, 67, 76, 85, 94].map((kx, i) => <rect key={`${r}-${i}`} x={kx - (r ? 3 : 0)} y={93 + r * 5} width="5.5" height="3" rx="1" fill={c} opacity="0.4" className={work ? "key-flash" : ""} style={work ? { animationDelay: `${((r * 7 + i) % 6) * 0.13}s` } : undefined} />))}
        </g>
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
const Room = memo(function Room({ room, name, color, cto, status, task, department, cls, h, walk, sayText, ctoAway, onPick }) {
  const busy = status === "working" || status === "command";
  return (
    <div data-room={room} className={`room ${cls}`} style={{ "--rc": color }} onClick={() => !cto && onPick(department)}>
      <div className="room-top"><span className="room-name">{roomLabel(room)}</span><span className="room-dots"><i /><i /><i /></span></div>
      <div className="scene" style={{ height: h }}>
        <svg className="room-art" viewBox="0 0 260 150" preserveAspectRatio="none"><RoomArt room={room} color={color} work={busy} /></svg>
        <div className={`walker ${!cto && !ctoAway && status === "working" ? (department === "development" ? "coding" : "atwork") : (busy && !ctoAway && !cto ? "busy " + walk : "")}`}>
          {/* bubbles sit just above the agent and move with it */}
          {!cto && sayText && <div className="speech" style={{ borderColor: color, color }}>{sayText}</div>}
          {!cto && !sayText && status === "working" && <div className="work-bubble" style={{ color, borderColor: color }}>{(WORK_INFO[department] || WORK_INFO._)[0]} {(WORK_INFO[department] || WORK_INFO._)[1]}<span className="work-dots">…</span></div>}
          {!cto && !sayText && status === "thinking" && <div className="cue" style={{ color }}>?</div>}
          {!cto && !sayText && status === "idle" && <div className="cue zzz">z z z</div>}
          {!cto && status === "working" && (
            <div className="work-fx">
              {(WORK_FX[department] || WORK_FX._).map((g, i) => (
                <span key={i} className="work-particle" style={{ color, left: [-20, 18, -10, 24, 4][i % 5] + "px", animationDelay: `${i * 0.5}s` }}>{g}</span>
              ))}
            </div>
          )}
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
                        ? <div style={SS.humanAvatarWrap}><Crown size={15} color="#f5c95b" style={SS.humanCrown} /><div style={SS.humanAvatar}><User size={22} color="#0b1020" /></div></div>
                        : <Octo color={m.color} size={40} status={live[m.id]?.status || "idle"} cto={m.id === "jeremiah"} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={SS.memberName}>
                        {m.name}
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
      <div style={SS.libSub}>Deliverables your agents produced, each linked to its task. Open to read the full output and download it — research &amp; reports as <b>.doc</b>, code as its real file type (.html/.py/.dart…) or a <b>.zip</b> for multi-file projects.</div>
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
      <div style={SS.libSub}>What the agents remember. Each department builds a knowledge base as it works; before a new task an agent recalls the most <b>relevant</b> past notes (semantic search), then saves what it learned after — so the team compounds expertise over time.</div>
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

function IssuesView({ issues, byId, onResolve, onRetry, onClearAll }) {
  const KIND = { quota: ["QUOTA", "#fb923c"], auth: ["AUTH", "#fb5570"], config: ["CONFIG", "#fb5570"], credentials: ["CREDS", "#38bdf8"], review: ["REVIEW", "#eab308"], error: ["ERROR", "#fb5570"] };
  return (
    <div style={SS.libWrap}>
      <div style={SS.head}>
        <h1 style={SS.h1}><AlertTriangle size={20} color="#fb923c" /> Issues</h1>
        {issues.length > 0 && <button style={SS.dismissBtn} onClick={() => { if (confirm(`Dismiss all ${issues.length} issues?`)) onClearAll(); }}><Trash2 size={12} /> Dismiss all</button>}
      </div>
      <div style={SS.libSub}>Things Jay Jay escalated to you (Group CTO) — quota/billing, a bad model, a task that failed QA review, or an agent requesting <b>sandbox credentials</b> to test an API. <b>Retry &amp; resolve</b> sends it back to the agent (continuing from partial work); <b>Dismiss</b> closes it. Issues clear automatically once the task succeeds, and don't persist across restarts.</div>
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

function StatCard({ label, value, sub, color }) {
  return (
    <div style={SS.statCard}>
      <div style={{ ...SS.statCardVal, color: color || "#e8edff" }}>{value}</div>
      <div style={SS.statCardLabel}>{label}</div>
      {sub && <div style={SS.statCardSub}>{sub}</div>}
    </div>
  );
}

function StatsView({ stats, tasks, agents, onOpenTask }) {
  const ts = Object.values(tasks);
  const cnt = (pred) => ts.filter(pred).length;
  const done = cnt((t) => t.status === "done");
  const failed = cnt((t) => ["failed", "blocked"].includes(t.status));
  const active = cnt((t) => ["queued", "in_progress", "review", "planning"].includes(t.status));
  const finished = done + failed;
  const rate = finished ? Math.round((done / finished) * 100) : null;
  const s = stats || { pro: { inTok: 0, outTok: 0, calls: 0 }, flash: { inTok: 0, outTok: 0, calls: 0 }, estCostPro: 0, estCostFlash: 0, estCostTotal: 0 };
  const totalTok = s.pro.inTok + s.pro.outTok + s.flash.inTok + s.flash.outTok;
  const workers = AGENTS.filter((a) => !a.cto);
  return (
    <div style={SS.libWrap}>
      <h1 style={SS.h1}><Activity size={20} /> Stats</h1>
      <div style={SS.libSub}>Live control-tower view — the team's throughput and today's spend. Token counts come from the API; dollar figures are estimates. Cost resets at UTC midnight.</div>

      <div style={SS.secTitle}>OUTCOMES</div>
      <div style={SS.statCards}>
        <StatCard label="Done" value={done} color="#38bdf8" />
        <StatCard label="Failed" value={failed} color="#fb5570" />
        <StatCard label="Active" value={active} color="#4ade80" />
        <StatCard label="Success rate" value={rate == null ? "—" : rate + "%"} color="#a855f7" />
      </div>

      <div style={SS.secTitle}>COST TODAY (EST.)</div>
      <div style={SS.statCards}>
        <StatCard label={`Pro · ${s.pro.calls} calls`} value={`$${s.estCostPro.toFixed(2)}`} sub={`${fmtTok(s.pro.inTok + s.pro.outTok)} tokens`} color="#facc15" />
        <StatCard label={`Flash · ${s.flash.calls} calls`} value={`$${s.estCostFlash.toFixed(2)}`} sub={`${fmtTok(s.flash.inTok + s.flash.outTok)} tokens`} color="#67e8f9" />
        <StatCard label="Total today" value={`$${s.estCostTotal.toFixed(2)}`} sub={`${fmtTok(totalTok)} tokens`} color="#a855f7" />
      </div>

      <div style={SS.secTitle}>TEAM</div>
      <div style={SS.docsList}>
        {workers.map((w) => {
          const dt = ts.filter((t) => t.department === w.department);
          const wd = dt.filter((t) => t.status === "done").length;
          const wf = dt.filter((t) => ["failed", "blocked"].includes(t.status)).length;
          const wa = dt.filter((t) => ["queued", "in_progress", "review"].includes(t.status)).length;
          const liveA = agents.find((a) => a.id === w.id);
          const st = liveA?.status === "working" ? "working" : liveA?.status === "thinking" ? "thinking" : "idle";
          return (
            <div key={w.id} style={{ ...SS.teamStatRow, ...(liveA?.currentTaskId ? { cursor: "pointer" } : {}) }} onClick={() => liveA?.currentTaskId && onOpenTask?.(liveA.currentTaskId)} title={liveA?.currentTaskId ? "Open current task" : undefined}>
              <span style={{ ...SS.statDot, background: w.color }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={SS.docTitle}>{w.name} <span style={{ color: "#5e7088", fontWeight: 400 }}>· {w.role}</span></div>
                <div style={SS.docMeta}>{st}{liveA?.task ? ` · ${liveA.task}` : ""}</div>
              </div>
              <span style={SS.statMini} title="done">✓ {wd}</span>
              <span style={SS.statMini} title="active">◷ {wa}</span>
              <span style={{ ...SS.statMini, color: wf ? "#fb5570" : "#5e7088" }} title="failed">✗ {wf}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProjectsView({ documents, byId, onOpen, onDownload }) {
  const projects = documents.filter((d) => d.department === "development" || d.hasCode);
  return (
    <div style={SS.libWrap}>
      <h1 style={SS.h1}><Rocket size={20} /> Projects</h1>
      <div style={SS.libSub}>Software the Development Center built. Open to review, or download the code — a single file by its real type (.html/.py/.dart…), or a <b>.zip</b> for multi-file projects.</div>
      {projects.length === 0 && <div style={SS.queueEmpty}>No projects yet. Assign a build task to the Development Center (e.g. “build a Django todo API” or “a Flutter login screen”).</div>}
      <div style={SS.docsList}>
        {projects.map((d) => {
          const who = d.agentId && byId[d.agentId];
          return (
            <div key={d.id} style={SS.projectRow}>
              <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => onOpen(d.id)}>
                <div style={SS.docRowHead}><span style={SS.docTitle}>{d.title}</span><span style={SS.docWhen}>{fmtWhen(d.createdAt)}</span></div>
                <div style={SS.docMeta}>{who ? who.name : "ORBIT"} · Development Center</div>
                <div style={SS.docSnippet}>{d.snippet}</div>
              </div>
              <button style={SS.downloadBtn} onClick={() => onDownload(d.id)}><Download size={13} /> DOWNLOAD</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarView({ routines, onCreate, onToggle, onDelete }) {
  const [f, setF] = useState({ title: "", prompt: "", department: "security", cadenceType: "interval", everyHours: 6, dailyTime: "09:00", runAt: "" });
  const submit = (e) => {
    e.preventDefault();
    const title = f.title.trim();
    if (!title) return;
    const payload = { title, prompt: f.prompt.trim() || title, department: f.department || null, cadenceType: f.cadenceType, enabled: true };
    if (f.cadenceType === "interval") payload.everyMinutes = Math.max(1, Number(f.everyHours) || 6) * 60;
    if (f.cadenceType === "daily") payload.dailyTime = f.dailyTime;
    if (f.cadenceType === "once") payload.runAt = f.runAt;
    onCreate(payload);
    setF((p) => ({ ...p, title: "", prompt: "" }));
  };
  const sorted = [...routines].sort((a, b) => (a.nextRunAt || Infinity) - (b.nextRunAt || Infinity));
  return (
    <div style={SS.libWrap}>
      <h1 style={SS.h1}><Calendar size={20} /> Calendar</h1>
      <div style={SS.libSub}>Scheduled &amp; recurring duties. Jay Jay runs them automatically and dispatches to the right agent — e.g. Warden's security sweep, a daily digest. These run <b>real</b> tasks (use the API), so keep the cadence sensible. Times are <b>UTC</b>.</div>
      <div style={SS.tasksGrid}>
        <form style={SS.tasksCompose} onSubmit={submit}>
          <div style={SS.secTitle}>NEW SCHEDULE</div>
          <input style={SS.input} placeholder="Title (e.g. Security sweep)" value={f.title} onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))} />
          <textarea style={SS.textarea} rows={3} placeholder="What should the agent do each time?" value={f.prompt} onChange={(e) => setF((p) => ({ ...p, prompt: e.target.value }))} />
          <select style={SS.select} value={f.department} onChange={(e) => setF((p) => ({ ...p, department: e.target.value }))}>
            {DEPT_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select style={SS.select} value={f.cadenceType} onChange={(e) => setF((p) => ({ ...p, cadenceType: e.target.value }))}>
            <option value="interval">Every N hours</option>
            <option value="daily">Daily at a time</option>
            <option value="once">Once at a time</option>
          </select>
          {f.cadenceType === "interval" && <input style={SS.input} type="number" min="1" placeholder="hours" value={f.everyHours} onChange={(e) => setF((p) => ({ ...p, everyHours: e.target.value }))} />}
          {f.cadenceType === "daily" && <input style={SS.input} type="time" value={f.dailyTime} onChange={(e) => setF((p) => ({ ...p, dailyTime: e.target.value }))} />}
          {f.cadenceType === "once" && <input style={SS.input} type="datetime-local" value={f.runAt} onChange={(e) => setF((p) => ({ ...p, runAt: e.target.value }))} />}
          <button type="submit" style={SS.assignBtn}><Plus size={13} /> ADD SCHEDULE</button>
        </form>
        <div style={SS.tasksList}>
          <div style={SS.secTitle}>SCHEDULES · {routines.filter((r) => r.enabled).length} active</div>
          {sorted.length === 0 && <div style={SS.queueEmpty}>No schedules yet. Add one (e.g. enable Warden's security sweep).</div>}
          {sorted.map((r) => (
            <div key={r.id} style={SS.routineRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={SS.routineTitle}>{r.title}</div>
                <div style={SS.routineMeta}>{deptLabel(r.department) || "Any dept"} · {fmtCadence(r)}{r.enabled && r.nextRunAt ? ` · next ${fmtWhen(r.nextRunAt)}` : " · paused"}</div>
              </div>
              <button style={{ ...SS.chip, ...(r.enabled ? SS.chipActive : {}) }} onClick={() => onToggle(r)}>{r.enabled ? "ON" : "OFF"}</button>
              <button style={SS.memDel} title="Delete" onClick={() => { if (confirm("Delete this schedule?")) onDelete(r.id); }}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
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
  const { agents: live, tasks, events, documents, memory, issues, routines, stats, settings, gemini, model, demoModel, connected, assignTask, deleteTask, retryTask, followupTask, clearTasks, createMission, control, logout, openDocument, deleteDocument, deleteMemory, resolveIssue, clearIssues, setCredential, createRoutine, updateRoutine, deleteRoutine } = useAgentSocket();
  const [view, setView] = useState("visual");
  const [form, setForm] = useState({ title: "", department: "", details: "", plan: false, priority: "normal" });
  const [selected, setSelected] = useState(null);
  const [doc, setDoc] = useState(null);
  const [say, setSay] = useState(null);
  const [jay, setJay] = useState({ coords: null, facing: "right", say: null });
  const [taskFilter, setTaskFilter] = useState("all");
  const [idleDismissed, setIdleDismissed] = useState(false);
  const [autoDismissed, setAutoDismissed] = useState(false);
  const [files, setFiles] = useState([]);
  const [credForm, setCredForm] = useState({ name: "", value: "" });
  const [followText, setFollowText] = useState("");
  const [mission, setMission] = useState({ name: "", items: [{ title: "", description: "", department: "" }], sequential: false });
  const [composeMode, setComposeMode] = useState("task");
  const [toasts, setToasts] = useState([]);
  const [palette, setPalette] = useState(false);
  const [pq, setPq] = useState("");
  const [preview, setPreview] = useState(null); // document id being previewed
  const [previewW, setPreviewW] = useState("mobile");

  const downloadFrom = (href) => {
    const a = document.createElement("a");
    a.href = href;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const downloadDoc = (id) => downloadFrom(`/api/documents/${id}/download`);
  const downloadCode = (id) => downloadFrom(`/api/documents/${id}/code`);

  const roomsRef = useRef(null);
  const jayQueue = useRef([]);
  const lastEvtRef = useRef(0);
  const jayTimers = useRef([]);
  const jayPosRef = useRef(null);

  const agents = AGENTS.map((s) => ({
    ...s,
    ...(live[s.id] || { status: s.cto ? "command" : "idle", task: s.cto ? "running the office" : "standing by", last: "" }),
  }));
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  // Jay Jay's status bubble while he's planning / assembling a plan.
  const jayLive = byId.jeremiah;
  const jayBubble = jayLive && jayLive.status === "thinking"
    ? (/plan/i.test(jayLive.task || "") ? "📋 planning…" : /assembl/i.test(jayLive.task || "") ? "🧩 assembling…" : "💭 thinking…")
    : null;

  const taskList = Object.values(tasks).sort((a, b) => b.createdAt - a.createdAt);
  const activeTasks = taskList.filter((t) => ["queued", "in_progress", "review"].includes(t.status));
  const selectedTask = selected ? tasks[selected] : null;

  // Command-palette search hits (across tasks, docs, memory).
  const pqLower = pq.trim().toLowerCase();
  const searching = palette && pqLower.length >= 2;
  const taskHits = searching ? taskList.filter((t) => `${t.title} ${t.prompt || ""}`.toLowerCase().includes(pqLower)).slice(0, 6) : [];
  const docHits = searching ? documents.filter((d) => `${d.title} ${d.snippet || ""}`.toLowerCase().includes(pqLower)).slice(0, 6) : [];
  const memHits = searching ? memory.flatMap((m) => (m.content || "").split("\n").filter((l) => l.trim() && l.toLowerCase().includes(pqLower)).map((l) => ({ scope: m.scope, line: l.trim() }))).slice(0, 6) : [];

  const onPick = useCallback((department) => setForm((f) => ({ ...f, department })), []);
  const openDoc = useCallback((id) => { openDocument(id).then(setDoc).catch(() => {}); }, [openDocument]);

  // Jay Jay patrols the office while on duty — wanders between rooms, pauses,
  // and breaks off to deliver a task to an agent when one is assigned.
  // A point within a room (xFrac/yFrac across width/height) — lets Jay Jay
  // drift left/right AND up/down for natural movement.
  const spot = (room, xFrac, yFrac) => {
    const cont = roomsRef.current;
    if (!cont) return null;
    const el = cont.querySelector(`[data-room="${room}"]`);
    if (!el) return null;
    const cr = cont.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: r.left - cr.left + r.width * xFrac, y: r.top - cr.top + r.height * yFrac };
  };
  const faceX = (prev, c) => (!prev ? "right" : c.x < prev.x - 3 ? "left" : c.x > prev.x + 3 ? "right" : null);
  const travelDur = (prev, c) => (prev ? Math.min(1.8, Math.max(0.5, Math.hypot(c.x - prev.x, c.y - prev.y) / 230)) : 0.2);
  const goTo = (c, say) => {
    const prev = jayPosRef.current;
    jayPosRef.current = c;
    const dur = travelDur(prev, c);
    setJay((j) => ({ coords: c, facing: faceX(prev, c) || j.facing, say: say ?? null, dur }));
    return dur;
  };

  const jayStep = () => {
    const T = jayTimers.current;
    const item = jayQueue.current.shift();
    if (item) {
      // Task ready: leave HQ, walk to the agent's room, announce it, return.
      const c = spot(item.room, 0.4 + Math.random() * 0.2, 0.62 + Math.random() * 0.14);
      if (!c) { T.push(setTimeout(jayStep, 1200)); return; }
      const dur = goTo(c, `→ ${item.name}: ${item.task}`);
      setSay({ room: item.room, text: "on it!" });
      T.push(setTimeout(() => {
        setJay((j) => ({ ...j, say: null }));
        setSay((s) => (s && s.room === item.room ? null : s));
        const home = spot("COMMAND HQ", 0.35 + Math.random() * 0.3, 0.62 + Math.random() * 0.14);
        if (home) goTo(home);
        T.push(setTimeout(jayStep, 1600));
      }, dur * 1000 + 1700));
    } else if (Math.random() > 0.28) {
      // Pace around HQ: a fresh spot (varied x and y), then a pause.
      const c = spot("COMMAND HQ", 0.15 + Math.random() * 0.7, 0.6 + Math.random() * 0.2);
      const dur = c ? goTo(c) : 0;
      T.push(setTimeout(jayStep, dur * 1000 + 900 + Math.random() * 2600));
    } else {
      // Sometimes just stay put for a beat.
      T.push(setTimeout(jayStep, 1400 + Math.random() * 2400));
    }
  };

  // Start/stop the patrol loop with the Visual view.
  useEffect(() => {
    if (view !== "visual") return;
    const start = setTimeout(() => {
      const home = spot("COMMAND HQ", 0.5, 0.66);
      if (home) { jayPosRef.current = home; setJay((j) => (j.coords ? j : { coords: home, facing: "right", say: null, dur: 0.2 })); }
      jayStep();
    }, 200);
    return () => { clearTimeout(start); jayTimers.current.forEach(clearTimeout); jayTimers.current = []; };
  }, [view]);

  // Queue deliveries from assign events; the patrol loop picks them up.
  useEffect(() => {
    if (!events.length) return;
    const maxId = Math.max(...events.map((e) => e.id));
    if (lastEvtRef.current === 0) { lastEvtRef.current = maxId; return; }
    const fresh = events.filter((e) => e.id > lastEvtRef.current && e.kind === "assign" && e.agentId);
    lastEvtRef.current = maxId;
    for (const e of fresh.reverse()) {
      const ag = AGENTS.find((x) => x.id === e.agentId);
      if (!ag || ag.cto) continue;
      const task = e.text.includes(": ") ? e.text.split(": ").slice(1).join(": ") : "";
      jayQueue.current.push({ room: ag.room, name: ag.name, task });
    }
    if (jayQueue.current.length > 5) jayQueue.current = jayQueue.current.slice(-5);
  }, [events]);

  // Command palette: ⌘K / Ctrl+K to open global search, Esc to close.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPq(""); setPalette((p) => !p); }
      else if (e.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Toasts: notify when one of YOUR tasks completes or fails (any page).
  const toastEvtRef = useRef(0);
  useEffect(() => {
    const rel = events.filter((e) => ["done", "fail"].includes(e.kind) && e.taskId);
    if (!rel.length) return;
    const maxId = Math.max(...rel.map((e) => e.id));
    if (toastEvtRef.current === 0) { toastEvtRef.current = maxId; return; } // skip history
    const fresh = rel.filter((e) => e.id > toastEvtRef.current);
    toastEvtRef.current = maxId;
    for (const e of fresh) {
      const t = tasks[e.taskId];
      if (!t || t.createdBy !== "user") continue; // only your tasks
      const ok = e.kind === "done";
      setToasts((prev) => [...prev, { id: e.id, ok, title: t.title }].slice(-4));
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== e.id)), 8000);
    }
  }, [events]);

  // Completion bubble: when an agent finishes, it tells Jay Jay "done!".
  const doneEvtRef = useRef(0);
  useEffect(() => {
    const dones = events.filter((e) => e.kind === "done" && e.agentId);
    if (!dones.length) return;
    const maxId = Math.max(...dones.map((e) => e.id));
    if (doneEvtRef.current === 0) { doneEvtRef.current = maxId; return; } // skip history
    const fresh = dones.find((e) => e.id > doneEvtRef.current);
    doneEvtRef.current = maxId;
    if (fresh) {
      const ag = AGENTS.find((a) => a.id === fresh.agentId);
      if (ag && !ag.cto) { setSay({ room: ag.room, text: "done! ✓" }); const id = setTimeout(() => setSay((s) => (s && s.text === "done! ✓" ? null : s)), 2200); return () => clearTimeout(id); }
    }
  }, [events]);

  const submit = (e) => {
    e.preventDefault();
    const title = form.title.trim();
    if (!title) return;
    assignTask({ title, prompt: form.details.trim() || title, department: form.plan ? null : (form.department || null), plan: form.plan, priority: form.priority }, files);
    setForm((f) => ({ ...f, title: "", details: "" }));
    setFiles([]);
  };
  const addFiles = (list) => setFiles((prev) => [...prev, ...Array.from(list)].slice(0, 6));
  const removeFile = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const badge = (s) => s === "command" ? ["ON-DUTY", "#a855f7"] : s === "working" ? ["ACTIVE", "#4ade80"] : s === "thinking" ? ["THINKING", "#eab308"] : ["IDLE", "#64786d"];
  const ticker = events.length ? events.slice(0, 16).map((e) => e.text) : ["Mission Control — connecting…"];

  const composer = (
    <form style={SS.compose} onSubmit={submit}>
      <div style={{ display: "flex", gap: 6 }}>
        <select style={{ ...SS.select, flex: 1, minWidth: 0 }} value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}>
          {DEPT_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select style={{ ...SS.select, flex: 1, minWidth: 0 }} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
          <option value="normal">Normal</option>
          <option value="high">High priority</option>
          <option value="low">Low priority</option>
        </select>
      </div>
      <input style={SS.input} placeholder="Task title…" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
      <textarea style={SS.textarea} rows={3} placeholder="Details / instructions (optional)" value={form.details} onChange={(e) => setForm((f) => ({ ...f, details: e.target.value }))} />
      <label style={SS.planToggle} title="Jay Jay breaks the goal into sub-tasks across departments, then assembles one deliverable">
        <input type="checkbox" checked={form.plan} onChange={(e) => setForm((f) => ({ ...f, plan: e.target.checked }))} style={{ accentColor: "#a855f7" }} />
        <Sparkles size={12} /> Plan &amp; split — let Jay Jay decompose this into sub-tasks
      </label>
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
      <button type="submit" style={SS.assignBtn}><Plus size={13} /> {form.plan ? "PLAN & DISPATCH" : "ASSIGN TASK"}</button>
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
          <div style={SS.modePill} title={gemini ? `Work/plan/synthesis: ${model}  ·  Review/notes/demo: ${demoModel}` : "Simulation"}>
            {gemini ? <Sparkles size={11} /> : <Bot size={11} />} {gemini ? (model || "GEMINI") : "SIMULATION"}
            {gemini && demoModel && demoModel !== model && <span style={SS.modeSub}> + {demoModel.replace(/^gemini-/, "")}</span>}
          </div>
        </div>

        <nav style={SS.nav}>
          <div style={SS.searchBtn} onClick={() => { setPq(""); setPalette(true); }}>
            <Search size={15} /> <span style={{ flex: 1 }}>Search…</span><span style={SS.searchKbd}>⌘K</span>
          </div>
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
                <button onClick={() => control("dispatch")} className="mc-btn" style={{ ...SS.btn, ...SS.gold }} title="Dispatch now — push any queued tasks to idle agents"><Crown size={12} /> DISPATCH</button>
                {settings.paused
                  ? <button onClick={() => control("all_hands")} className="mc-btn" style={{ ...SS.btn, ...SS.go }} title="Resume the office — agents pick up queued work again"><Zap size={12} /> RESUME</button>
                  : <button onClick={() => control("clock_out")} className="mc-btn" style={{ ...SS.btn, ...SS.stop }} title="Clock out — pause the office; agents stop taking new tasks"><Power size={12} /> CLOCK OUT</button>}
                <button onClick={() => control("toggle_autonomous", { autonomous: !settings.autonomous })} className="mc-btn" style={{ ...SS.btn, ...(settings.autonomous ? SS.autoOn : SS.autoOff) }} title="Self-running demo: Jay Jay invents tasks (free Flash model). Your real tasks always use Pro."><Bot size={12} /> AUTO {settings.autonomous ? "ON" : "OFF"}</button>
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
                    sayText={say?.room === room ? say.text : null} ctoAway={!!a.cto} onPick={onPick} />
                );
              })}
              {jay.coords && (
                <div className="courier" style={{ left: jay.coords.x - 38, top: jay.coords.y - 58, transition: `left ${jay.dur || 1.2}s ease-in-out, top ${jay.dur || 1.2}s ease-in-out, opacity .3s ease` }}>
                  {(jay.say || jayBubble) && <div className={`courier-say${!jay.say && jayBubble ? " thinking" : ""}`}>{jay.say || jayBubble}</div>}
                  <div className="oshadow courier-shadow" />
                  <span className="jay-bob"><Octo color="#facc15" size={76} status="working" cto flip={jay.facing === "left"} /></span>
                </div>
              )}
            </div>

            <div style={SS.ticker}>
              <span style={SS.live}><span style={SS.liveDot} /> LIVE</span>
              <div style={SS.tickWrap}><div className="mc-marquee" style={SS.tickRun}>{ticker.join("   •   ")}   •   {ticker.join("   •   ")}</div></div>
            </div>

            {stats && (stats.pro.calls + stats.flash.calls + stats.tasksDone + stats.tasksFailed > 0) && (
              <div style={SS.statStrip}>
                <span style={SS.statItem}>✓ {stats.tasksDone}</span>
                <span style={SS.statItem}>✗ {stats.tasksFailed}</span>
                <span style={SS.statSep}>·</span>
                <span style={SS.statItem} title="Pro tokens today">PRO {fmtTok(stats.pro.inTok + stats.pro.outTok)} ~${stats.estCostPro.toFixed(2)}</span>
                <span style={SS.statItem} title="Flash tokens today">FLASH {fmtTok(stats.flash.inTok + stats.flash.outTok)} ~${stats.estCostFlash.toFixed(2)}</span>
                <span style={SS.statSep}>·</span>
                <span style={{ ...SS.statItem, color: "#67e8f9", fontWeight: 700 }}>~${stats.estCostTotal.toFixed(2)} today</span>
                <span style={{ ...SS.statItem, color: "#5e7088" }}>est.</span>
              </div>
            )}

            <div style={SS.cards}>
              {agents.map((a) => {
                const [bl, bc] = badge(a.status);
                return (
                  <div key={a.id} style={{ ...SS.card, borderColor: `${a.color}44` }} onClick={() => a.currentTaskId && setSelected(a.currentTaskId)}>
                    <div style={SS.cardHead}>
                      <div style={{ width: 36, display: "grid", placeItems: "center" }}><Octo color={a.color} size={28} status={a.status} cto={a.cto} /></div>
                      <div style={{ flex: 1 }}>
                        <div style={SS.cardName}>{a.name}</div>
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
            <div style={SS.libSub}>Assign work to the team and watch the queue. A <b>single task</b> goes to one agent (with a priority, or <b>Plan &amp; split</b> to auto-decompose a big goal); a <b>mission</b> is a list of tasks, optionally a <b>sequence</b> where each builds on the last. Jay Jay routes, QA-reviews, and agents can consult each other mid-task.</div>
            <div style={SS.tasksGrid}>
              <div style={SS.tasksCompose}>
                <div style={SS.modeToggle}>
                  <button style={{ ...SS.modeBtn, ...(composeMode === "task" ? SS.modeBtnOn : {}) }} onClick={() => setComposeMode("task")}>Single task</button>
                  <button style={{ ...SS.modeBtn, ...(composeMode === "mission" ? SS.modeBtnOn : {}) }} onClick={() => setComposeMode("mission")}>Mission</button>
                </div>
                {composeMode === "task" ? (
                  <>
                    {composer}
                    <div style={SS.composeHint}>Jay Jay routes it to the right agent. Set a <b>priority</b> to reorder the queue, or tick <b>Plan &amp; split</b> to auto-break a big goal into sub-tasks.</div>
                  </>
                ) : (
                  <>
                    <input style={SS.input} placeholder="Mission name (e.g. Launch v2)" value={mission.name} onChange={(e) => setMission((m) => ({ ...m, name: e.target.value }))} />
                    {mission.items.map((it, i) => (
                      <div key={i} style={SS.missionItem}>
                        <div style={SS.missionItemHead}>
                          <span style={{ fontSize: 9, color: "#5e7088", fontWeight: 700, letterSpacing: 1 }}>TASK {i + 1}</span>
                          {mission.items.length > 1 && <button style={SS.miX} onClick={() => setMission((m) => ({ ...m, items: m.items.filter((_, idx) => idx !== i) }))}><X size={11} /></button>}
                        </div>
                        <input style={SS.input} placeholder="Task title" value={it.title} onChange={(e) => setMission((m) => ({ ...m, items: m.items.map((x, idx) => idx === i ? { ...x, title: e.target.value } : x) }))} />
                        <textarea style={SS.textarea} rows={3} placeholder="Detailed description / instructions for this task" value={it.description} onChange={(e) => setMission((m) => ({ ...m, items: m.items.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x) }))} />
                        <select style={SS.select} value={it.department} onChange={(e) => setMission((m) => ({ ...m, items: m.items.map((x, idx) => idx === i ? { ...x, department: e.target.value } : x) }))}>
                          {DEPT_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                    ))}
                    <button style={SS.ghostBtn} onClick={() => setMission((m) => ({ ...m, items: [...m.items, { title: "", description: "", department: "" }] }))}><Plus size={12} /> ADD ANOTHER TASK</button>
                    <label style={SS.planToggle} title="Tasks run one after another; each gets the previous task's deliverable to build on">
                      <input type="checkbox" checked={mission.sequential} onChange={(e) => setMission((m) => ({ ...m, sequential: e.target.checked }))} style={{ accentColor: "#a855f7" }} />
                      Run in sequence — each task builds on the previous
                    </label>
                    <button style={SS.assignBtn} onClick={() => {
                      const tasks = mission.items.filter((it) => it.title.trim()).map((it) => ({ title: it.title.trim(), prompt: it.description.trim() || it.title.trim(), department: it.department || null }));
                      if (!tasks.length) return;
                      createMission({ name: mission.name.trim(), tasks, sequential: mission.sequential });
                      setMission({ name: "", items: [{ title: "", description: "", department: "" }], sequential: false });
                    }}><Plus size={13} /> LAUNCH MISSION</button>
                    <div style={SS.composeHint}>Add as many tasks as you like — each with its own description and agent. Tick <b>Run in sequence</b> to make them a pipeline.</div>
                  </>
                )}
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
                  const shown = taskList.filter((t) => !t.parentId).filter((t) => taskFilter === "all" ? true : taskFilter === "mine" ? t.createdBy === "user" : t.createdBy !== "user");
                  if (!shown.length) return <div style={SS.queueEmpty}>{taskFilter === "mine" ? "You haven't assigned any tasks yet — use the composer on the left." : taskFilter === "auto" ? "No auto-generated tasks (AUTO is off or idle)." : "No tasks yet. Add one, or let Jay Jay run the office in Visual."}</div>;
                  return shown.map((t) => {
                    const col = STATUS_COLOR[t.status] || "#64786d";
                    const mine = t.createdBy === "user";
                    const [sl, sc] = mine ? ["YOU", "#a855f7"] : ["AUTO", "#5e7088"];
                    const waiting = t.status === "queued" && (t.dependsOn || []).some((id) => tasks[id] && tasks[id].status !== "done");
                    return (
                      <div key={t.id} style={SS.taskRow} onClick={() => setSelected(t.id)}>
                        <span style={{ ...SS.pill, color: col, borderColor: `${col}66`, background: `${col}1a` }}>{STATUS_LABEL[t.status]}</span>
                        {waiting && <span style={SS.waitTag}>WAITING</span>}
                        <span style={{ ...SS.srcBadge, color: sc, borderColor: `${sc}66`, background: `${sc}1a` }}>{sl}</span>
                        {t.priority === "high" && <span style={SS.prioHigh}>↑ HIGH</span>}
                        {t.priority === "low" && <span style={SS.prioLow}>↓ LOW</span>}
                        {t.isPlan && <span style={SS.planTag}>PLAN</span>}
                        {t.mission && <span style={SS.missionTag}>◇ {t.mission}</span>}
                        <span style={SS.taskRowTitle}>{t.title}</span>
                        {t.assignedTo && byId[t.assignedTo] && <span style={SS.taskRowWho}>{byId[t.assignedTo].name}</span>}
                        <button style={SS.rowDel} title="Delete task" onClick={(e) => { e.stopPropagation(); deleteTask(t.id); if (selected === t.id) setSelected(null); }}><Trash2 size={12} /></button>
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

        {view === "calendar" && <CalendarView routines={routines} onCreate={createRoutine} onToggle={(r) => updateRoutine(r.id, { enabled: !r.enabled })} onDelete={deleteRoutine} />}

        {view === "projects" && <ProjectsView documents={documents} byId={byId} onOpen={openDoc} onDownload={downloadCode} />}

        {view === "stats" && <StatsView stats={stats} tasks={tasks} agents={agents} onOpenTask={setSelected} />}

        {view === "issues" && <IssuesView issues={issues} byId={byId} onClearAll={clearIssues} onResolve={resolveIssue} onRetry={(i) => {
          if (!i.taskId) { alert("This issue has no task to retry — dismissing it."); resolveIssue(i.id); return; }
          retryTask(i.taskId)
            .then(() => { resolveIssue(i.id); })
            .catch((e) => alert("Couldn't retry: " + e.message + (/not found/i.test(e.message) ? " (the task was deleted — dismiss this issue and re-assign the task)" : "")));
        }} />}

        {PLACEHOLDER[view] && <Placeholder icon={PLACEHOLDER[view].icon} title={PLACEHOLDER[view].title} desc={PLACEHOLDER[view].desc} />}
      </main>

      {palette && (
        <div style={{ ...SS.modalBg, alignItems: "flex-start", paddingTop: "12vh" }} onClick={() => setPalette(false)}>
          <div style={SS.palette} onClick={(e) => e.stopPropagation()}>
            <div style={SS.paletteTop}>
              <Search size={15} style={{ color: "#5e7088", flexShrink: 0 }} />
              <input autoFocus style={SS.paletteInput} placeholder="Search tasks, documents, memory…" value={pq} onChange={(e) => setPq(e.target.value)} />
              <span style={SS.paletteKbd}>ESC</span>
            </div>
            <div style={SS.paletteBody}>
              {!searching && <div style={SS.queueEmpty}>Type to search across tasks, documents, and memory.</div>}
              {searching && taskHits.length + docHits.length + memHits.length === 0 && <div style={SS.queueEmpty}>No matches for “{pq.trim()}”.</div>}
              {taskHits.length > 0 && <div style={SS.secTitle}>TASKS</div>}
              {taskHits.map((t) => (
                <div key={t.id} style={SS.paletteRow} onClick={() => { setSelected(t.id); setPalette(false); }}>
                  <span style={{ ...SS.pill, color: STATUS_COLOR[t.status], borderColor: `${STATUS_COLOR[t.status]}66`, background: `${STATUS_COLOR[t.status]}1a` }}>{STATUS_LABEL[t.status]}</span>
                  <span style={SS.tlText}>{t.title}</span>
                </div>
              ))}
              {docHits.length > 0 && <div style={SS.secTitle}>DOCUMENTS</div>}
              {docHits.map((d) => (
                <div key={d.id} style={SS.paletteRow} onClick={() => { openDoc(d.id); setPalette(false); }}>
                  <FileText size={13} style={{ color: "#38bdf8", flexShrink: 0 }} />
                  <span style={SS.tlText}>{d.title}</span>
                </div>
              ))}
              {memHits.length > 0 && <div style={SS.secTitle}>MEMORY</div>}
              {memHits.map((h, i) => (
                <div key={i} style={SS.paletteRow} onClick={() => { setView("memory"); setPalette(false); }}>
                  <Brain size={13} style={{ color: "#c4b5fd", flexShrink: 0 }} />
                  <span style={SS.tlText}>{h.line.replace(/^-\s*/, "")}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div style={SS.modalBg} onClick={() => setPreview(null)}>
          <div style={SS.previewCard} onClick={(e) => e.stopPropagation()}>
            <div style={SS.previewHead}>
              <span style={SS.previewTitle}><Eye size={13} /> LIVE PREVIEW</span>
              <div style={SS.previewDevices}>
                {PREVIEW_DEVICES.map(([k, label, w]) => (
                  <button key={k} style={{ ...SS.previewDevBtn, ...(previewW === k ? SS.previewDevOn : {}) }} onClick={() => setPreviewW(k)} title={`${label} · ${w}px`}>{label}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <a href={`/api/documents/${preview}/preview/`} target="_blank" rel="noopener noreferrer" style={SS.previewLink}>Open full ↗</a>
                <button style={SS.modalClose} onClick={() => setPreview(null)}><X size={16} /></button>
              </div>
            </div>
            <div style={SS.previewBody}>
              <iframe key={preview} title="Live preview" src={`/api/documents/${preview}/preview/`} sandbox="allow-scripts allow-forms allow-modals allow-popups" style={{ ...SS.previewFrame, width: `min(${(PREVIEW_DEVICES.find((d) => d[0] === previewW) || PREVIEW_DEVICES[0])[2]}px, 100%)` }} />
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div style={SS.globalToasts}>
          {toasts.map((t) => (
            <div key={t.id} style={{ ...SS.taskToast, borderColor: t.ok ? "#2f6f49" : "#7a2e3e" }} onClick={() => setSelected(t.id)} title="Open task">
              <span style={{ color: t.ok ? "#4ade80" : "#fb5570", fontWeight: 800 }}>{t.ok ? "✓" : "✗"}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><b>{t.ok ? "Completed" : "Failed"}:</b> {t.title}</span>
              <button style={SS.bannerClose} onClick={(e) => { e.stopPropagation(); setToasts((p) => p.filter((x) => x.id !== t.id)); }}><X size={13} /></button>
            </div>
          ))}
        </div>
      )}

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
              {selectedTask.revisions ? ` · rev ${selectedTask.revisions}` : ""}
            </div>
            {selectedTask.prompt && selectedTask.prompt !== selectedTask.title && <div style={SS.modalPrompt}>{selectedTask.prompt}</div>}
            {selectedTask.isPlan && (() => {
              const kids = Object.values(tasks).filter((t) => t.parentId === selectedTask.id).sort((a, b) => a.createdAt - b.createdAt);
              const doneN = kids.filter((k) => k.status === "done").length;
              return (
                <>
                  <div style={SS.secTitle}>SUB-TASKS {kids.length ? `· ${doneN}/${kids.length} done` : "· planning…"}</div>
                  {!kids.length && <div style={SS.queueEmpty}>Jay Jay is breaking this down into sub-tasks…</div>}
                  {kids.map((k) => {
                    const col = STATUS_COLOR[k.status] || "#64786d";
                    return (
                      <div key={k.id} style={SS.subRow} onClick={() => setSelected(k.id)}>
                        <span style={{ ...SS.pill, color: col, borderColor: `${col}66`, background: `${col}1a` }}>{STATUS_LABEL[k.status]}</span>
                        <span style={SS.taskRowTitle}>{k.title}</span>
                        {k.department && <span style={SS.taskRowWho}>{DEPT_OPTS.find((d) => d[0] === k.department)?.[1] || k.department}</span>}
                      </div>
                    );
                  })}
                </>
              );
            })()}
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
            {(() => {
              const evs = events.filter((e) => e.taskId === selectedTask.id).slice().sort((a, b) => a.id - b.id);
              if (!evs.length) return null;
              return (
                <>
                  <div style={SS.secTitle}>ACTIVITY</div>
                  <div style={SS.timeline}>
                    {evs.map((e) => (
                      <div key={e.id} style={SS.tlRow}>
                        <span style={{ ...SS.tlDot, background: EVENT_COLOR[e.kind] || "#64786d" }} />
                        <span style={SS.tlText}>{e.text}</span>
                        <span style={SS.tlTime}>{fmtTime(e.ts)}</span>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
            {(selectedTask.department === "development" || (selectedTask.credentialNames && selectedTask.credentialNames.length > 0)) && (
              <>
                <div style={SS.secTitle}>SANDBOX CREDENTIALS</div>
                {selectedTask.credentialNames && selectedTask.credentialNames.length > 0 && (
                  <div style={SS.fileChips}>{selectedTask.credentialNames.map((n) => <span key={n} style={SS.fileChip}><Key size={11} /> {n} <span style={{ color: "#5e7088" }}>••••</span></span>)}</div>
                )}
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <input style={{ ...SS.input, flex: 1 }} placeholder="name (e.g. API_KEY)" value={credForm.name} onChange={(e) => setCredForm((f) => ({ ...f, name: e.target.value }))} />
                  <input style={{ ...SS.input, flex: 1 }} type="password" placeholder="value" value={credForm.value} onChange={(e) => setCredForm((f) => ({ ...f, value: e.target.value }))} />
                  <button style={SS.downloadBtn} onClick={() => { if (credForm.name.trim() && credForm.value) { setCredential(selectedTask.id, credForm.name.trim(), credForm.value); setCredForm({ name: "", value: "" }); } }}>ADD</button>
                </div>
                <div style={{ fontSize: 10, color: "#5e7088", marginTop: 4, lineHeight: 1.4 }}>Stored server-side, never shown back or logged. Orbit references them with {"{{NAME}}"} placeholders. After adding, press <b>Continue</b> to run with them.</div>
              </>
            )}
            {selectedTask.status === "done" && (
              <>
                <div style={SS.secTitle}>FOLLOW UP / IMPROVE</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input style={{ ...SS.input, flex: 1 }} placeholder="What to change, add, or expand?" value={followText} onChange={(e) => setFollowText(e.target.value)} />
                  <button style={SS.continueBtn} onClick={() => { const v = followText.trim(); if (v) { followupTask(selectedTask.id, v); setFollowText(""); setSelected(null); } }}><RotateCw size={13} /> SEND</button>
                </div>
                <div style={{ fontSize: 10, color: "#5e7088", marginTop: 4, lineHeight: 1.4 }}>Creates a follow-up that <b>continues from this deliverable</b> — the agent builds on what's done (code, research, etc.), not from scratch.</div>
              </>
            )}
            <div style={SS.modalActions}>
              {["failed", "blocked"].includes(selectedTask.status) && <button style={SS.continueBtn} onClick={() => retryTask(selectedTask.id).then(() => alert("Jay Jay is re-dispatching this task — watch the Visual office. If it blocks again, it's the Gemini quota/model.")).catch((e) => alert("Couldn't continue: " + e.message + (/not found/i.test(e.message) ? " (the task no longer exists — re-assign it fresh)" : "")))}><RotateCw size={13} /> CONTINUE TASK</button>}
              {(() => {
                const td = documents.find((d) => d.taskId === selectedTask.id);
                if (!td) return null;
                const code = td.hasCode || /```|=+\s*FILE:/.test(selectedTask.result || "");
                return (
                  <>
                    {td.previewable && <button style={SS.previewBtn} onClick={() => setPreview(td.id)}><Eye size={13} /> PREVIEW</button>}
                    {code && <button style={SS.downloadBtn} onClick={() => downloadCode(td.id)}><Download size={13} /> DOWNLOAD CODE</button>}
                    <button style={code ? SS.ghostBtn : SS.downloadBtn} onClick={() => downloadDoc(td.id)}><Download size={13} /> .DOC</button>
                  </>
                );
              })()}
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
              {(doc.previewable || /<!doctype html|<html[\s>]|```html/i.test(doc.content || "")) && <button style={SS.previewBtn} onClick={() => setPreview(doc.id)}><Eye size={13} /> PREVIEW</button>}
              {/```/.test(doc.content || "") && <button style={SS.downloadBtn} onClick={() => downloadCode(doc.id)}><Download size={13} /> DOWNLOAD CODE</button>}
              <button style={/```/.test(doc.content || "") ? SS.ghostBtn : SS.downloadBtn} onClick={() => downloadDoc(doc.id)}><Download size={13} /> .DOC</button>
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
  modePill: { fontSize: 8.5, letterSpacing: 1, color: "#9db0c8", display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 99, border: "1px solid #243358", background: "#0a1020", flexWrap: "wrap", justifyContent: "center" },
  modeSub: { color: "#5e7088" },
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
  toastWrap: { position: "fixed", right: 18, bottom: 18, zIndex: 60, display: "flex", flexDirection: "column-reverse", gap: 8, width: 340, maxWidth: "calc(100vw - 36px)" },
  globalToasts: { position: "fixed", right: 18, bottom: 18, zIndex: 80, display: "flex", flexDirection: "column-reverse", gap: 8, width: 340, maxWidth: "calc(100vw - 36px)" },
  searchBtn: { display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", marginBottom: 6, borderRadius: 9, border: "1px solid #1a2440", background: "#0a1020", color: "#8aa0c0", cursor: "pointer", fontSize: 12.5 },
  searchKbd: { fontSize: 9, color: "#5e7088", border: "1px solid #243358", borderRadius: 5, padding: "1px 5px", fontFamily: MONO },
  palette: { width: 560, maxWidth: "calc(100vw - 32px)", background: "#0b1020", border: "1px solid #243358", borderRadius: 14, boxShadow: "0 24px 60px rgba(0,0,0,.6)", overflow: "hidden", display: "flex", flexDirection: "column" },
  paletteTop: { display: "flex", alignItems: "center", gap: 9, padding: "12px 14px", borderBottom: "1px solid #18223e" },
  paletteInput: { flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "#e8edff", fontFamily: MONO, fontSize: 14 },
  paletteKbd: { fontSize: 9, color: "#5e7088", border: "1px solid #243358", borderRadius: 5, padding: "2px 6px", fontFamily: MONO, flexShrink: 0 },
  paletteBody: { display: "flex", flexDirection: "column", gap: 4, padding: 10, maxHeight: "52vh", overflowY: "auto" },
  paletteRow: { display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 8, cursor: "pointer", background: "#0c1226", border: "1px solid #141d36" },
  taskToast: { display: "flex", alignItems: "center", gap: 9, fontSize: 12, color: "#e8edff", background: "#0c1226", border: "1px solid #243358", borderRadius: 10, padding: "11px 12px", boxShadow: "0 12px 32px rgba(0,0,0,.55)", cursor: "pointer" },
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
  rowDel: { marginLeft: "auto", flexShrink: 0, background: "transparent", border: "1px solid #2a3550", color: "#8aa0c0", borderRadius: 6, padding: "4px 6px", cursor: "pointer", display: "flex", alignItems: "center" },
  missionTag: { fontSize: 8.5, color: "#c4b5fd", background: "rgba(168,85,247,.12)", border: "1px solid rgba(168,85,247,.4)", borderRadius: 99, padding: "2px 7px", letterSpacing: 0.5, flexShrink: 0, whiteSpace: "nowrap" },
  planTag: { fontSize: 8.5, color: "#0b1020", background: "#a855f7", border: "1px solid #a855f7", borderRadius: 99, padding: "2px 7px", letterSpacing: 0.5, flexShrink: 0, whiteSpace: "nowrap", fontWeight: 700 },
  prioHigh: { fontSize: 8.5, color: "#fb7185", background: "rgba(251,113,133,.12)", border: "1px solid rgba(251,113,133,.45)", borderRadius: 99, padding: "2px 6px", letterSpacing: 0.5, flexShrink: 0, whiteSpace: "nowrap", fontWeight: 700 },
  prioLow: { fontSize: 8.5, color: "#7d8aa0", background: "rgba(125,138,160,.1)", border: "1px solid rgba(125,138,160,.4)", borderRadius: 99, padding: "2px 6px", letterSpacing: 0.5, flexShrink: 0, whiteSpace: "nowrap" },
  waitTag: { fontSize: 8.5, color: "#67e8f9", background: "rgba(103,232,249,.1)", border: "1px solid rgba(103,232,249,.4)", borderRadius: 99, padding: "2px 6px", letterSpacing: 0.5, flexShrink: 0, whiteSpace: "nowrap" },
  statStrip: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 12px", margin: "0 0 8px", fontSize: 10.5, color: "#9db0c8", fontFamily: MONO, background: "#0a1020", border: "1px solid #18223e", borderRadius: 8 },
  statItem: { whiteSpace: "nowrap", letterSpacing: 0.3 },
  statSep: { color: "#2a3550" },
  statCards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 6 },
  statCard: { background: "#0c1226", border: "1px solid #1a2440", borderRadius: 10, padding: "12px 14px" },
  statCardVal: { fontSize: 22, fontWeight: 800, fontFamily: MONO, lineHeight: 1.1 },
  statCardLabel: { fontSize: 10, color: "#9db0c8", marginTop: 4, letterSpacing: 0.5 },
  statCardSub: { fontSize: 9.5, color: "#5e7088", marginTop: 2, fontFamily: MONO },
  teamStatRow: { display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 9, background: "#0c1226", border: "1px solid #1a2440" },
  statDot: { width: 9, height: 9, borderRadius: "50%", flexShrink: 0 },
  statMini: { fontSize: 11, color: "#9db0c8", fontFamily: MONO, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 },
  timeline: { display: "flex", flexDirection: "column", gap: 5, maxHeight: "22vh", overflowY: "auto", marginTop: 2, paddingLeft: 2 },
  tlRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#bcd0e8" },
  tlDot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },
  tlText: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  tlTime: { fontSize: 9.5, color: "#5e7088", fontFamily: MONO, flexShrink: 0 },
  planToggle: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#c4b5fd", cursor: "pointer", padding: "4px 2px", userSelect: "none" },
  modeToggle: { display: "flex", gap: 4, padding: 3, background: "#0a1020", border: "1px solid #1a2440", borderRadius: 9, marginBottom: 2 },
  modeBtn: { flex: 1, padding: "7px 10px", borderRadius: 7, border: "none", background: "transparent", color: "#8aa0c0", fontWeight: 700, fontSize: 11, letterSpacing: 0.5, cursor: "pointer", fontFamily: MONO },
  modeBtnOn: { background: "#a855f7", color: "#0b1020" },
  subRow: { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: "#0a1020", border: "1px solid #1a2440", cursor: "pointer", marginBottom: 5 },
  missionItem: { display: "flex", flexDirection: "column", gap: 6, padding: 9, borderRadius: 8, border: "1px solid #1a2440", background: "#0a1020" },
  missionItemHead: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  miX: { background: "transparent", border: "none", color: "#8aa0c0", cursor: "pointer", padding: 0, display: "flex" },
  routineRow: { display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", borderRadius: 9, background: "#0c1226", border: "1px solid #1a2440" },
  routineTitle: { fontSize: 12.5, fontWeight: 700, color: "#e8edff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  routineMeta: { fontSize: 10, color: "#8aa0c0", marginTop: 2 },
  secTitle: { fontSize: 9, letterSpacing: 1.5, color: "#5e7088", fontWeight: 700, margin: "2px 0" },
  compose: { display: "flex", flexDirection: "column", gap: 7 },
  select: { padding: "8px 9px", borderRadius: 7, border: "1px solid #243358", background: "#070a14", color: "#e8edff", fontFamily: MONO, fontSize: 11, boxSizing: "border-box", width: "100%", maxWidth: "100%" },
  input: { padding: "9px 10px", borderRadius: 7, border: "1px solid #243358", background: "#070a14", color: "#e8edff", fontFamily: MONO, fontSize: 12, boxSizing: "border-box", width: "100%", maxWidth: "100%" },
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
  projectRow: { display: "flex", alignItems: "center", gap: 12, background: "#0c1226", border: "1px solid #1a2440", borderRadius: 10, padding: "11px 13px" },
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
  humanAvatarWrap: { position: "relative", width: 40, height: 40 },
  humanCrown: { position: "absolute", top: -9, left: "50%", transform: "translateX(-50%)", zIndex: 1 },
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
  modalPrompt: { fontSize: 12, color: "#9db0c8", background: "#070a14", border: "1px solid #161f3a", borderRadius: 8, padding: 10, marginBottom: 14, whiteSpace: "pre-wrap", lineHeight: 1.5, maxHeight: "22vh", overflowY: "auto" },
  resultBox: { fontSize: 12.5, color: "#cfe3d8", background: "#070a14", border: "1px solid #1a2440", borderRadius: 8, padding: 12, whiteSpace: "pre-wrap", lineHeight: 1.55, marginTop: 4, maxHeight: "40vh", overflowY: "auto" },
  reviewNote: { fontSize: 11, color: "#bbf7d0", marginTop: 10 },
  failReason: { display: "flex", gap: 8, fontSize: 11.5, color: "#fcd9b6", background: "rgba(251,146,60,.1)", border: "1px solid rgba(251,146,60,.35)", borderRadius: 8, padding: "9px 11px", margin: "10px 0 4px", lineHeight: 1.45 },
  continueBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(74,222,128,.45)", background: "rgba(74,222,128,.12)", color: "#bbf7d0", fontWeight: 700, fontSize: 9.5, letterSpacing: 1, cursor: "pointer", fontFamily: MONO },
  modalActions: { display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" },
  downloadBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8, border: "1px solid #a855f7", background: "#a855f7", color: "#0b1020", fontWeight: 700, fontSize: 9.5, letterSpacing: 1, cursor: "pointer", fontFamily: MONO },
  ghostBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8, border: "1px solid #243358", background: "transparent", color: "#9db0c8", fontWeight: 700, fontSize: 9.5, letterSpacing: 1, cursor: "pointer", fontFamily: MONO },
  previewBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8, border: "1px solid #4ade80", background: "#4ade80", color: "#08130c", fontWeight: 700, fontSize: 9.5, letterSpacing: 1, cursor: "pointer", fontFamily: MONO },
  previewCard: { display: "flex", flexDirection: "column", width: "min(1340px, calc(100vw - 28px))", height: "min(940px, 93vh)", background: "#0b1020", border: "1px solid #243358", borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,.6)" },
  previewHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", borderBottom: "1px solid #18223e", flexShrink: 0 },
  previewTitle: { display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: 1, color: "#4ade80", fontFamily: MONO, flexShrink: 0 },
  previewDevices: { display: "flex", gap: 3, padding: 3, background: "#0a1020", border: "1px solid #1a2440", borderRadius: 8 },
  previewDevBtn: { padding: "5px 9px", borderRadius: 6, border: "none", background: "transparent", color: "#8aa0c0", fontWeight: 700, fontSize: 9.5, letterSpacing: 0.5, cursor: "pointer", fontFamily: MONO, whiteSpace: "nowrap" },
  previewDevOn: { background: "#4ade80", color: "#08130c" },
  previewLink: { fontSize: 11, color: "#9db0c8", textDecoration: "none", fontFamily: MONO, whiteSpace: "nowrap" },
  previewBody: { flex: 1, minHeight: 0, display: "flex", justifyContent: "center", background: "#0a0e1a", overflow: "auto" },
  previewFrame: { height: "100%", border: "none", display: "block", background: "#fff", boxShadow: "0 0 0 1px #243358", flexShrink: 0 },
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
.courier { position:absolute; z-index:7; display:flex; flex-direction:column; align-items:center; pointer-events:none; transition:left 1.2s cubic-bezier(.45,.05,.3,1), top 1.2s cubic-bezier(.45,.05,.3,1), opacity .3s ease; }
.courier-shadow { background:#facc15; }
@keyframes jayBob { 0%,100%{transform:translateY(0);} 50%{transform:translateY(-3px);} }
.jay-bob { animation:jayBob 2.4s ease-in-out infinite; display:block; }
.courier-say { position:absolute; bottom:100%; margin-bottom:4px; font-family:'JetBrains Mono'; font-weight:700; font-size:9px; color:#fde68a; background:#070a14; border:1px solid #facc15; border-radius:6px; padding:3px 8px; white-space:nowrap; max-width:220px; overflow:hidden; text-overflow:ellipsis; box-shadow:0 0 10px #facc1555; }
.agent-tag { position:absolute; bottom:2px; left:0; right:0; text-align:center; font-family:'Press Start 2P',monospace; font-size:7px; letter-spacing:1px; opacity:.85; z-index:2; }
.speech { position:absolute; bottom:100%; margin-bottom:5px; left:50%; transform:translateX(-50%); font-size:9px; font-family:'JetBrains Mono'; background:#070a14; border:1px solid; border-radius:6px; padding:2px 7px; z-index:7; white-space:nowrap; }
.cue { position:absolute; left:50%; transform:translateX(-50%); bottom:100%; margin-bottom:6px; font-family:'Press Start 2P',monospace; font-size:11px; z-index:7; animation:cueFloat 1.4s ease-in-out infinite; }
.cue.zzz { font-size:8px; color:#64786d; letter-spacing:2px; }
@keyframes cueFloat { 0%,100%{transform:translateX(-50%) translateY(0);opacity:.6;} 50%{transform:translateX(-50%) translateY(-4px);opacity:1;} }
@keyframes octoBob { 0%,100%{transform:translateY(0);} 50%{transform:translateY(-4px);} }
@keyframes pacChompA { 0%,49.9%{opacity:1;} 50%,100%{opacity:0;} }
@keyframes pacChompB { 0%,49.9%{opacity:0;} 50%,100%{opacity:1;} }
.pac-a { animation-name:pacChompA; animation-timing-function:steps(1,end); animation-iteration-count:infinite; }
.pac-b { animation-name:pacChompB; animation-timing-function:steps(1,end); animation-iteration-count:infinite; }
.octo-bob { animation:octoBob .55s ease-in-out infinite; }
@keyframes octoTilt { 0%,100%{transform:rotate(-3deg);} 50%{transform:rotate(3deg);} }
.octo-tilt { animation:octoTilt 1.8s ease-in-out infinite; }
.tw { animation:twk 1.6s ease-in-out infinite; } @keyframes twk { 0%,100%{opacity:.3;} 50%{opacity:1;} }
.spin { animation:spin 1.3s linear infinite; } @keyframes spin { to{transform:rotate(360deg);} }
.code-type { animation:codeType 1.8s ease-in-out infinite; } @keyframes codeType { 0%{transform:scaleX(.04);} 55%{transform:scaleX(1);} 100%{transform:scaleX(1);} }
.code-cursor { animation:blink .9s step-end infinite; } @keyframes blink { 0%,49%{opacity:1;} 50%,100%{opacity:0;} }
.work-bubble { position:absolute; bottom:100%; margin-bottom:5px; left:50%; transform:translateX(-50%); z-index:7; font-family:'JetBrains Mono'; font-weight:700; font-size:8px; letter-spacing:.5px; padding:2px 8px; border-radius:99px; background:rgba(7,10,20,.92); border:1px solid currentColor; white-space:nowrap; box-shadow:0 0 10px rgba(0,0,0,.4); animation:workPulse 1.7s ease-in-out infinite; }
@keyframes workPulse { 0%,100%{opacity:.6;} 50%{opacity:1;} }
.work-dots { animation:blink 1s step-end infinite; }
.courier-say.thinking { animation:workPulse 1.4s ease-in-out infinite; }
/* bubbles point down at the agent + pop in */
.speech::after, .work-bubble::after { content:''; position:absolute; top:100%; left:50%; transform:translateX(-50%); width:0; height:0; border:4px solid transparent; border-top-color:#070a14; }
.speech { animation:popIn .22s ease-out; }
.work-bubble { animation:popIn .22s ease-out, workPulse 1.7s ease-in-out infinite; }
.courier-say { animation:popIn .22s ease-out; }
@keyframes popIn { 0%{opacity:0; transform:translateX(-50%) translateY(5px) scale(.7);} 100%{opacity:1; transform:translateX(-50%) translateY(0) scale(1);} }
/* a soft pulse under an actively-working agent */
.walker.busy .oshadow, .walker.atwork .oshadow, .walker.coding .oshadow { animation:shadowPulse 1.3s ease-in-out infinite; }
@keyframes shadowPulse { 0%,100%{opacity:.26; width:34px;} 50%{opacity:.5; width:42px;} }
/* working agent: stays at the workstation with a focused typing lean */
.walker.atwork { animation:typeLean .85s ease-in-out infinite; }
@keyframes typeLean { 0%,100%{transform:translateX(-50%) translateY(0) rotate(0deg);} 30%{transform:translateX(-50%) translateY(1px) rotate(.8deg);} 70%{transform:translateX(-50%) translateY(-1px) rotate(-.8deg);} }
/* Orbit coding: moves between the keyboard and the screens, busily */
.walker.coding { animation:codeMove 3.4s cubic-bezier(.45,.05,.3,1) infinite; }
@keyframes codeMove { 0%{left:43%;} 24%{left:43%;} 50%{left:58%;} 74%{left:58%;} 100%{left:43%;} }
/* eyeballs darting between keyboard (down) and screen (up) while working */
.iris-scan { animation:irisScan 2.6s ease-in-out infinite; }
@keyframes irisScan { 0%,12%{transform:translate(0,0);} 28%,40%{transform:translate(-.5px,1.6px);} 56%,70%{transform:translate(.5px,-1.4px);} 88%,100%{transform:translate(0,0);} }
/* work particles rising from the agent (code symbols for Orbit, etc.) */
.work-fx { position:absolute; bottom:64%; left:50%; width:0; height:0; z-index:6; pointer-events:none; }
.work-particle { position:absolute; bottom:0; font-family:'JetBrains Mono'; font-weight:700; font-size:9px; white-space:nowrap; opacity:0; animation:floatUp 2.6s ease-in infinite; }
@keyframes floatUp { 0%{opacity:0; transform:translateY(6px) scale(.7);} 22%{opacity:.95;} 100%{opacity:0; transform:translateY(-32px) scale(1.15);} }
/* keyboard key-presses while coding */
.key-flash { animation:keyFlash .55s ease-in-out infinite; } @keyframes keyFlash { 0%,100%{opacity:.3;} 50%{opacity:1;} }
.mc-marquee { animation:marq 26s linear infinite; will-change:transform; } @keyframes marq { from{transform:translateX(0);} to{transform:translateX(-50%);} }
.mc-btn:hover { filter:brightness(1.15); } .mc-btn:active { transform:scale(.97); }
`;
