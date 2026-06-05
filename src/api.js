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
  createTask: (t) => req("/api/tasks", { method: "POST", body: JSON.stringify(t) }),
  deleteTask: (id) => req(`/api/tasks/${id}`, { method: "DELETE" }),
  control: (action, extra = {}) =>
    req("/api/control", { method: "POST", body: JSON.stringify({ action, ...extra }) }),
  logout: () => req("/api/logout", { method: "POST" }),
};
