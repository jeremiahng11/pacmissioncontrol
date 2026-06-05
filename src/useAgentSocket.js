// Live feed hook: replaces the old fake setInterval. Connects to /ws, applies
// the snapshot + incremental {agent,task,event,settings} frames, and exposes
// action senders. Reconnects with backoff; bounces to /login on auth loss.

import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "./api";

export function useAgentSocket() {
  const [agents, setAgents] = useState({});
  const [tasks, setTasks] = useState({});
  const [events, setEvents] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [memory, setMemory] = useState([]);
  const [issues, setIssues] = useState([]);
  const [routines, setRoutines] = useState([]);
  const [settings, setSettings] = useState({ paused: false, autonomous: true });
  const [gemini, setGemini] = useState(false);
  const [model, setModel] = useState("");
  const [demoModel, setDemoModel] = useState("");
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
      setDocuments(s.documents || []);
      setMemory(s.memory || []);
      setIssues(s.issues || []);
      setRoutines(s.routines || []);
      if (s.settings) setSettings(s.settings);
      if (typeof s.gemini === "boolean") setGemini(s.gemini);
      if (typeof s.model === "string") setModel(s.model);
      if (typeof s.demoModel === "string") setDemoModel(s.demoModel);
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
          case "tasks": setTasks(Object.fromEntries((m.tasks || []).map((t) => [t.id, t]))); break;
          case "event": setEvents((p) => [m.event, ...p].slice(0, 60)); break;
          case "document":
            if (m.document.deleted) setDocuments((p) => p.filter((d) => d.id !== m.document.id));
            else setDocuments((p) => [m.document, ...p.filter((d) => d.id !== m.document.id)].slice(0, 60));
            break;
          case "memory":
            if (m.memory.deleted) setMemory((p) => p.filter((x) => x.scope !== m.memory.scope));
            else setMemory((p) => [m.memory, ...p.filter((x) => x.scope !== m.memory.scope)]);
            break;
          case "issue":
            if (m.issue.resolved) setIssues((p) => p.filter((i) => i.id !== m.issue.id));
            else setIssues((p) => [m.issue, ...p.filter((i) => i.id !== m.issue.id)]);
            break;
          case "issues": setIssues(m.issues || []); break;
          case "routine":
            if (m.routine.deleted) setRoutines((p) => p.filter((x) => x.id !== m.routine.id));
            else setRoutines((p) => { const i = p.findIndex((x) => x.id === m.routine.id); if (i < 0) return [...p, m.routine]; const n = [...p]; n[i] = m.routine; return n; });
            break;
          case "settings": setSettings(m.settings); break;
          default: break;
        }
      };
    };

    connect();
    return () => { stopped = true; try { ws && ws.close(); } catch {} };
  }, []);

  const assignTask = useCallback((t, files) => api.createTask(t, files).catch((e) => console.error(e)), []);
  const deleteTask = useCallback((id) => api.deleteTask(id).catch(() => {}), []);
  const retryTask = useCallback((id) => api.retryTask(id), []); // let callers see errors
  const clearTasks = useCallback((scope) => api.clearTasks(scope).catch(() => {}), []);
  const control = useCallback((a, extra) => api.control(a, extra).catch(() => {}), []);
  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    location.href = "/login";
  }, []);
  const openDocument = useCallback((id) => api.document(id), []);
  const deleteDocument = useCallback((id) => api.deleteDocument(id).catch(() => {}), []);
  const deleteMemory = useCallback((scope) => api.deleteMemory(scope).catch(() => {}), []);
  const resolveIssue = useCallback((id) => {
    setIssues((p) => p.filter((i) => i.id !== id)); // optimistic: clear from the list immediately
    return api.resolveIssue(id).catch(() => {});
  }, []);
  const clearIssues = useCallback(() => {
    setIssues([]);
    return api.clearIssues().catch(() => {});
  }, []);
  const createRoutine = useCallback((r) => api.createRoutine(r).catch((e) => console.error(e)), []);
  const updateRoutine = useCallback((id, patch) => api.updateRoutine(id, patch).catch(() => {}), []);
  const deleteRoutine = useCallback((id) => api.deleteRoutine(id).catch(() => {}), []);

  return { agents, tasks, events, documents, memory, issues, routines, settings, gemini, model, demoModel, connected, assignTask, deleteTask, retryTask, clearTasks, control, logout, openDocument, deleteDocument, deleteMemory, resolveIssue, clearIssues, createRoutine, updateRoutine, deleteRoutine };
}
