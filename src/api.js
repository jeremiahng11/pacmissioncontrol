// Thin REST client. 401 anywhere means the session lapsed -> back to login.

async function req(path, opts = {}) {
  const r = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (r.status === 401) {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || r.statusText);
  }
  if (r.status === 204) return null;
  return r.json();
}

export const api = {
  state: () => req("/api/state"),
  document: (id) => req(`/api/documents/${id}`),
  deleteDocument: (id) => req(`/api/documents/${id}`, { method: "DELETE" }),
  deleteMemory: (scope) => req(`/api/memory/${scope}`, { method: "DELETE" }),
  createTask: (t, files) => {
    if (files && files.length) {
      const fd = new FormData();
      fd.append("title", t.title);
      if (t.prompt) fd.append("prompt", t.prompt);
      if (t.department) fd.append("department", t.department);
      for (const f of files) fd.append("files", f);
      return fetch("/api/tasks", { method: "POST", credentials: "same-origin", body: fd }).then((r) => {
        if (r.status === 401) { window.location.href = "/login"; throw new Error("unauthorized"); }
        if (!r.ok) throw new Error("upload failed");
        return r.json();
      });
    }
    return req("/api/tasks", { method: "POST", body: JSON.stringify(t) });
  },
  deleteTask: (id) => req(`/api/tasks/${id}`, { method: "DELETE" }),
  retryTask: (id) => req(`/api/tasks/${id}/retry`, { method: "POST" }),
  clearTasks: (scope) => req("/api/tasks/clear", { method: "POST", body: JSON.stringify({ scope }) }),
  resolveIssue: (id) => req(`/api/issues/${id}/resolve`, { method: "POST" }),
  clearIssues: () => req("/api/issues/clear", { method: "POST" }),
  control: (action, extra = {}) =>
    req("/api/control", { method: "POST", body: JSON.stringify({ action, ...extra }) }),
  logout: () => req("/api/logout", { method: "POST" }),
};
