# Tools Roadmap — giving agents real-world reach

Today agents reason only over **in-app data** (the task prompt, attached files,
and their department **memory**). To do *real* external work — Warden checking a
live endpoint, Scout researching the web, Orbit reading a repo — agents need
**tools**. This is the plan; it's a separate, security-sensitive build.

## Design

Add a **tool-use loop** around the Gemini call (Gemini supports function
calling). Each agent is granted a scoped set of tools; the model may call them,
we execute server-side, feed results back, and loop until it produces the
deliverable. Every tool call is **logged** to the event log and tied to the task.

```
runWork(agent, task):
  tools = toolsFor(agent.department)            # least-privilege per role
  loop (max N steps):
    res = gemini.generateContent({ tools, contents, history })
    if res.functionCalls: execute each (allow-listed) -> append results -> continue
    else: return res.text                        # final deliverable
```

## Phases (smallest, safest first)

1. **Web fetch (read-only)** — `fetch_url(url)` returning readable text.
   - Unlocks: Scout live research, Warden checking a public URL/health endpoint,
     Scribe summarizing a page.
   - Guardrails: allow-list/deny-list of hosts, timeout, size cap, no localhost/
     private IPs (SSRF protection), rate limit.
2. **Web search** — `search(query)` via a search API (needs an API key).
   - Unlocks: real research instead of model-memory.
3. **Repo / GitHub (read)** — `read_file(path)`, `list_dir`, `search_code` against
   a connected repo (GitHub token, read-only scope).
   - Unlocks: Orbit reviewing code, Warden scanning for secrets/vulns in a repo.
4. **HTTP/API probes for Security** — `http_check(url)` returning status/headers/
   TLS info; optional header/secret scanner over fetched content.
   - Unlocks: Warden's automatic security sweeps against real targets.
5. **Write actions (gated)** — open a PR, post to Slack/Discord, file an issue.
   - Highest risk: require explicit per-tool enablement + human approval step;
     log everything; never enabled by default.

## Cross-cutting guardrails

- **Least privilege:** tools granted per department (Warden: http_check/repo-read;
  Scout: web; Orbit: repo; others: none unless needed).
- **Allow-lists & SSRF protection** for any network tool.
- **Secrets** (search/GitHub keys) only in env, never in prompts or the event log.
- **Step + token budget** per task to cap cost and loops.
- **Audit:** every tool call recorded (tool, args summary, result size) on the task.
- Tie into the existing **Issues** system: a denied/failed tool call raises an issue.

## Suggested order to ship

`fetch_url` (phase 1) first — it's the highest value for the least risk and makes
Scout/Warden/Scribe genuinely useful, then web search, then repo read.
