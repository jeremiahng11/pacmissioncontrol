// Live feed hook: replaces the old fake setInterval. Connects to /ws, applies
// the snapshot + incremental {agent,task,event,settings} frames, and exposes
// action senders. Reconnects with backoff; bounces to /login on auth loss.

import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "./api";

export function useAgentSocket() {
  const [agents, setAgents] = useState({});
  const [tasks, setTasks] = useState({});
  const [events, setEvents] = useState([]);
  const [settings, setSettings] = useState({ paused: false, autonomous: true });
  const [gemini, setGemini] = useState(false);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    let stopped = false;
    let retry = 0;
    let ws;

    const applySnapshot = (s) => {
      setAgents(Object.fromEntries((s.agents || []).map((a) => [a.id, a])));
      setTasks(Object.fromEntries((s.tasks || []).map((t) => [t.id, t])));
      setEvents(s.events || []);
      if (s.settings) setSettings(s.settings);
      if (typeof s.gemini === "boolean") setGemini(s.gemini);
    };

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => { setConnected(true); retry = 0; };
      ws.onerror = () => { try { ws.close(); } catch {} };
      ws.onclose = (e) => {
        setConnected(false);
        if (e.code === 4001 || e.code === 1008) { location.href = "/login"; return; }
        if (!stopped) {
          retry = Math.min(retry + 1, 6);
          setTimeout(connect, 400 * 2 ** retry);
        }
      };
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        switch (m.type) {
          case "snapshot": applySnapshot(m); break;
          case "agent": setAgents((p) => ({ ...p, [m.agent.id]: m.agent })); break;
          case "task":
            if (m.task.deleted)
              setTasks((p) => { const n = { ...p }; delete n[m.task.id]; return n; });
            else setTasks((p) => ({ ...p, [m.task.id]: m.task }));
            break;
          case "event": setEvents((p) => [m.event, ...p].slice(0, 60)); break;
          case "settings": setSettings(m.settings); break;
          default: break;
        }
      };
    };

    connect();
    return () => { stopped = true; try { ws && ws.close(); } catch {} };
  }, []);

  const assignTask = useCallback((t) => api.createTask(t).catch((e) => console.error(e)), []);
  const deleteTask = useCallback((id) => api.deleteTask(id).catch(() => {}), []);
  const control = useCallback((a, extra) => api.control(a, extra).catch(() => {}), []);
  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    location.href = "/login";
  }, []);

  return { agents, tasks, events, settings, gemini, connected, assignTask, deleteTask, control, logout };
}
