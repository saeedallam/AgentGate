import {
  escapeHtml as e,
  labels,
  money,
  usdToMinor,
  refundPayload,
  lockIntent,
  shortId,
} from "./model.mjs";

const root = document.querySelector("#root");
const dialog = document.querySelector("#dialog");
const toast = document.querySelector("#toast");
const paths = {
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  bolt: "m13 2-9 12h7l-1 8 10-13h-7z",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6",
  agents: "M8 3v3m8-3v3M5 7h14v13H5zM9 11v2m6-2v2M9 17h6M2 11v5m20-5v5",
  check: "m5 12 4 4L19 6",
  clock: "M12 8v5l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  wallet: "M3 6h16v14H3zM3 6l13-3v3m-2 6h7v5h-7z",
  flask: "M9 3h6m-5 0v7L4 20h16l-6-10V3M8 14h8",
  key: "M14 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M10 11v11m0-5h4m-4 3h3",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  plus: "M12 5v14M5 12h14",
  refresh: "M20 7a8 8 0 1 0 0 10m0-14v5h-5",
  close: "m6 6 12 12M18 6 6 18",
  menu: "M4 6h16M4 12h16M4 18h16",
  logout: "M10 4H4v16h6m4-12 4 4-4 4m-6-4h10",
  info: "M12 11v6m0-11v1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  copy: "M8 8h12v13H8zM16 8V3H3v13h5",
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.info}"/></svg>`;
const brand =
  '<div class="brand"><img src="/console/logo.svg" alt=""><span>AgentGate</span><small>β</small></div>';
const nav = [
  ["overview", "Overview", "grid"],
  ["playground", "Action playground", "bolt"],
  ["executions", "Executions", "clock"],
  ["agents", "Agents & keys", "agents"],
  ["approvals", "Approvals", "shield"],
  ["budgets", "Refund budget", "wallet"],
  ["studies", "Observe & simulate", "flask"],
  ["help", "Getting started", "info"],
];
let state = {
  token: "",
  email: "",
  workspaces: [],
  org: null,
  page: "overview",
  agent: null,
  overview: null,
  cursor: null,
  agentOffset: 0,
  approvalOffset: 0,
  studyCursor: null,
  filter: "",
  intent: null,
  lastResult: null,
  lastObserved: null,
  draft: { paymentId: "", amount: "100.00", key: crypto.randomUUID() },
};
let epoch = 0,
  loadId = 0,
  toastTimer,
  expiryTimer,
  generatedKey = "";
class StaleRequest extends Error {}
const owner = () => state.org?.role === "OWNER";
const url = (path) => `/v1/console/${state.org.id}/${path}`;
const date = (value) =>
  value
    ? new Date(value).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const btn = (text, act, cls = "", data = "") =>
  `<button type="button" class="btn ${cls}" data-act="${act}" ${data}>${text}</button>`;
const badge = (status) =>
  `<span class="pill ${["SUCCEEDED", "APPROVED", "ACTIVE", "ALLOW"].includes(status) ? "good" : ["FAILED", "DENIED", "REJECTED", "DENY", "SUSPENDED"].includes(status) ? "bad" : status === "EXECUTING" ? "blue" : "warn"}">${e(labels[status] || status || "Unavailable")}</span>`;
const empty = (title, message, action = "") =>
  `<div class="empty"><div class="empty-icon">${icon("flask")}</div><h2>${e(title)}</h2><p>${e(message)}</p>${action}</div>`;
const pageHead = (title, sub, action = "") =>
  `<div class="page-head"><div><h1>${e(title)}</h1><p>${e(sub)}</p></div>${action}</div>`;
const json = (data) =>
  `<pre tabindex="0">${e(JSON.stringify(data, null, 2))}</pre>`;
const field = (label, name, attrs = "", hint = "") =>
  `<label class="field">${label}<input name="${name}" ${attrs}>${hint ? `<small>${hint}</small>` : ""}</label>`;
function notify(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toastTimer = setTimeout(() => {
    toast.textContent = "";
  }, 6500);
}
function closeDialog() {
  dialog.close();
  dialog.innerHTML = "";
  generatedKey = "";
}
function modal(title, body) {
  dialog.innerHTML = `<header class="dialog-head"><h2 id="dialog-title">${e(title)}</h2>${btn(icon("close"), "close", "ghost compact", 'aria-label="Close"')}</header><div class="dialog-body">${body}</div>`;
  if (!dialog.open) dialog.showModal();
}
dialog.addEventListener("close", () => {
  dialog.innerHTML = "";
  generatedKey = "";
});
function logout(message = "") {
  epoch++;
  loadId++;
  clearTimeout(expiryTimer);
  closeDialog();
  state = {
    ...state,
    token: "",
    email: "",
    org: null,
    workspaces: [],
    agent: null,
    overview: null,
    intent: null,
    lastResult: null,
    lastObserved: null,
    draft: { paymentId: "", amount: "100.00", key: crypto.randomUUID() },
  };
  authScreen();
  if (message) notify(message);
}
async function api(
  path,
  { method = "GET", body, agent = false, key, anonymous = false } = {},
) {
  const current = epoch;
  const secret = key ?? (agent ? state.agent?.key : state.token);
  if (!anonymous && !secret)
    throw new Error(agent ? "Connect an agent key first." : "Sign in first.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, {
      method,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
      headers: {
        ...(anonymous ? {} : { Authorization: `Bearer ${secret}` }),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (current !== epoch) throw new StaleRequest();
    const data = await response.json();
    if (current !== epoch) throw new StaleRequest();
    if (!response.ok) {
      if (response.status === 401 && !anonymous && !agent && !key) {
        logout("Your session has expired. Please sign in again.");
        throw new StaleRequest();
      }
      if (response.status === 401 && agent) state.agent = null;
      const err = new Error(
        response.status >= 500
          ? "The service is unavailable. If the request could execute an action, check its outcome before trying again."
          : Array.isArray(data.message)
            ? data.message.join(", ")
            : data.message || "Unable to complete the request.",
      );
      err.status = response.status;
      err.data =
        response.status >= 500
          ? { statusCode: response.status, message: err.message }
          : data;
      throw err;
    }
    return data;
  } catch (error) {
    if (current !== epoch) throw new StaleRequest();
    if (error instanceof StaleRequest || error.status) throw error;
    throw new Error(
      "Could not confirm the response. Check your connection; do not assume the action did not execute. Keep the same request key.",
    );
  } finally {
    clearTimeout(timer);
  }
}
// Submit is intentionally separate: never rotate keys or retry automatically on transport failure.
async function submitIntent(intent) {
  if (state.agent?.agentId !== state.intentAgentId)
    throw new Error(
      "This saved request belongs to a different agent. Connect the same agent before resending.",
    );
  const current = epoch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch("/v1/actions", {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${state.agent.key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": intent.key,
      },
      body: JSON.stringify(intent.body),
    });
    if (current !== epoch) throw new StaleRequest();
    const data = await response.json();
    if (current !== epoch) throw new StaleRequest();
    if (response.status === 401) state.agent = null;
    return response.status >= 500
      ? {
          statusCode: response.status,
          message:
            "Could not confirm the execution outcome. Keep the same key and check its status.",
        }
      : data;
  } catch (error) {
    if (current !== epoch || error instanceof StaleRequest)
      throw new StaleRequest();
    return {
      statusCode: 0,
      message:
        "The response is uncertain. This page retains your request and key. Resend only the same request; do not start a new one.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
function authScreen(register = false) {
  root.innerHTML = `<div class="auth"><section class="auth-intro">${brand}<div><div class="eyebrow">A HOME FOR SAFE AGENT ACTIONS</div><h1>Let agents do the work.<br>You set the boundaries.</h1><p>One place to follow actions, review approvals and understand what actually happened.</p><div class="hive-visual"><div class="hive-cell"><strong>The agent proposes</strong><span>A specific action. A trusted identity.</span></div><div class="hive-center"><img src="/console/logo.svg" alt=""></div><div class="hive-cell"><strong>You stay in control</strong><span>Policy, approval, then execution</span></div></div></div><div class="auth-foot"><span>◈ Tenant isolation</span><span>◈ Exact-action approvals</span><span>◈ Traceable outcomes</span></div></section><main id="main" class="auth-form"><div class="auth-card"><div class="eyebrow">AGENTGATE CONSOLE</div><h2>${register ? "Start your workspace" : "Welcome back"}</h2><p class="muted">${register ? "Create an account, then set up your organization and first agent." : "Sign in to manage your workspace and agents."}</p><form class="form" data-form="${register ? "register" : "login"}">${field("Email address", "email", 'type="email" autocomplete="username" required maxlength="320" dir="ltr" placeholder="you@company.com"')}${field("Password", "password", `type="password" autocomplete="${register ? "new-password" : "current-password"}" required ${register ? 'minlength="15"' : ""} maxlength="128" dir="ltr"`, register ? "At least 15 characters." : "")}<div class="form-error" role="alert"></div><button class="btn primary full" type="submit">${register ? "Create account" : "Sign in"} ${icon("arrow")}</button></form><div class="auth-bottom"><span class="muted">${register ? "Already have an account?" : "New to AgentGate?"}</span> ${btn(register ? "Sign in" : "Create account", register ? "login-view" : "register-view", "ghost compact")}</div><p class="footer-note">Your session stays in page memory. Reloading requires signing in again.</p></div></main></div>`;
}
function shell() {
  root.innerHTML = `<div class="app-shell"><aside class="sidebar">${brand}<div class="workspace"><label for="workspace">Workspace</label><select id="workspace" aria-label="Organization">${state.workspaces.map((w) => `<option value="${e(w.id)}" ${w.id === state.org?.id ? "selected" : ""}>${e(w.name)}</option>`).join("") || "<option>No workspace yet</option>"}</select><div class="role">${owner() ? "OWNER · Manage & approve" : state.org ? "MEMBER · Monitor" : "Start with a new workspace"}</div>${btn("+ New workspace", "new-org", "ghost compact")}</div><div><div class="nav-label">WORKSPACE</div><nav class="nav" aria-label="Main navigation">${nav.map(([id, name, ic]) => `<button type="button" data-act="nav" data-page="${id}" class="${state.page === id ? "active" : ""}" ${state.page === id ? 'aria-current="page"' : ""}>${icon(ic)}${name}</button>`).join("")}</nav></div><div class="sidebar-bottom"><div class="sidebar-note"><div class="bee" aria-hidden="true">◌ ⬡ ◌</div><b>A little freedom.<br>A lot of control.</b><p>Your agents move fast.<br>Your boundaries stay put.</p></div><div class="session-card"><div class="avatar">${e(state.email[0]?.toUpperCase() || "A")}</div><div class="session-info"><strong dir="ltr">${e(state.email)}</strong><span>Session stored in memory only</span></div>${btn(icon("logout"), "logout", "ghost compact", 'aria-label="Sign out"')}</div></div></aside><div class="main-area"><header class="topbar"><div class="row">${btn(icon("menu"), "menu", "ghost mobile-toggle", 'aria-label="Open navigation"')}<div class="breadcrumb">Workspace / <b>${e(nav.find((n) => n[0] === state.page)?.[1])}</b></div></div><div class="row"><span class="pill" id="health-indicator">Checking connection</span>${btn(icon("refresh"), "refresh", "ghost compact", 'aria-label="Refresh data"')}</div></header><main id="main" class="content" tabindex="-1"><div class="loading"><div class="spinner"></div>Loading your workspace…</div></main></div></div>`;
  api("/health/ready", { anonymous: true })
    .then(() => {
      const el = document.querySelector("#health-indicator");
      if (el) {
        el.className = "pill good";
        el.textContent = "Service connected";
      }
    })
    .catch(() => {
      const el = document.querySelector("#health-indicator");
      if (el) {
        el.className = "pill bad";
        el.textContent = "Service not ready";
      }
    });
}
async function loadWorkspaces(selected) {
  const result = await api("/v1/console/workspaces");
  state.workspaces = result.items;
  state.org =
    state.workspaces.find((w) => w.id === selected) ||
    state.workspaces[0] ||
    null;
  if (result.hasMore) notify("The console shows your first 100 workspaces.");
}
async function navigate(page = state.page) {
  state.page = page;
  const id = ++loadId;
  shell();
  try {
    if (!state.org) {
      document.querySelector("#main").innerHTML = empty(
        "Your hive starts here",
        "Create a workspace, add an agent, then try your first action.",
        btn("Create workspace", "new-org", "primary"),
      );
      return;
    }
    let html;
    if (page === "overview") html = await overviewView();
    else if (page === "executions") html = await executionsView();
    else if (page === "agents") html = await agentsView();
    else if (page === "approvals") html = await approvalsView();
    else if (page === "budgets") html = budgetView();
    else if (page === "studies") html = await studiesView();
    else if (page === "playground") html = playgroundView();
    else html = helpView();
    if (id !== loadId) return;
    document.querySelector("#main").innerHTML = html;
  } catch (error) {
    if (id !== loadId || error instanceof StaleRequest) return;
    document.querySelector("#main").innerHTML = empty(
      "Could not load data",
      error.message,
      btn("Try again", "refresh", "primary"),
    );
  }
}
function executionTable(items) {
  return items.length
    ? `<div class="table-wrap"><table class="table"><thead><tr><th>Action / execution</th><th>Agent</th><th>Status</th><th>Policy</th><th>Time</th></tr></thead><tbody>${items.map((x) => `<tr><td><button class="link mono" type="button" data-act="execution" data-id="${e(x.id)}">${e(x.actionName)}</button><small class="mono">${e(shortId(x.id))}</small></td><td><code>${e(x.agent?.name || shortId(x.agentId))}</code></td><td>${badge(x.status)}</td><td>${x.policyDecision ? badge(x.policyDecision) : '<span class="muted">No policy snapshot</span>'}</td><td>${e(date(x.createdAt))}</td></tr>`).join("")}</tbody></table></div>`
    : empty(
        "No executions yet",
        "Your first AgentGate request will appear here with its actual outcome.",
        btn("Action playground", "nav", "primary", 'data-page="playground"'),
      );
}
function hiveArt() {
  return `<svg class="hive-art" viewBox="0 0 400 240" fill="none" aria-hidden="true"><defs><pattern id="hex" width="76" height="88" patternUnits="userSpaceOnUse"><path d="M38 1 75 22v44L38 87 1 66V22Z" stroke="#b8c8ab" stroke-opacity=".12"/></pattern><radialGradient id="glow"><stop stop-color="#b0b979" stop-opacity=".17"/><stop offset="1" stop-color="#b0b979" stop-opacity="0"/></radialGradient></defs><rect width="400" height="240" fill="url(#hex)"/><circle cx="220" cy="125" r="125" fill="url(#glow)"/><path d="M205 40 269 77v74l-64 37-64-37V77Z" stroke="#e5c86d" stroke-opacity=".25"/><path d="m205 57 49 28v58l-49 28-49-28V85Z" fill="#2c4735" stroke="#d8bf68"/><path d="m205 79 30 17v13h-14v-6l-16-9-16 9v24l16 9 16-9v-3h-17v-13h31v24l-30 18-30-18V96Z" fill="#e9cd76"/><path d="M20 115h75l27-15h34M255 115h40l23 14h65" stroke="#cab469" stroke-dasharray="4 5"/><circle cx="95" cy="115" r="4" fill="#d6bd65"/><circle cx="320" cy="129" r="4" fill="#d6bd65"/><rect x="265" y="174" width="94" height="25" rx="12" fill="#3c5140" stroke="#637255"/><circle cx="279" cy="187" r="3" fill="#bdd694"/><text x="289" y="190" fill="#d1dec4" font-size="8" font-family="sans-serif">Policy gate</text><path d="m99 36 7 4v8l-7 4-7-4v-8Z" fill="#c9ac53" fill-opacity=".5"/></svg>`;
}
async function overviewView() {
  const data = await api(url("overview"));
  state.overview = data;
  const stat = (title, value, sub, ic) =>
    `<article class="stat"><div class="stat-top">${title}<span class="stat-icon">${icon(ic)}</span></div><div class="number">${e(String(value).padStart(2, "0"))}</div><span class="small muted">${sub}</span></article>`;
  return `${pageHead("Your hive, under control.", "A clear view of what your agents are doing — and what they are allowed to do.", btn("+ Try an action", "nav", "primary", 'data-page="playground"'))}
    <section class="hero"><div class="hero-copy"><div class="eyebrow">The control layer for your agents</div><h2>Let agents do the work.<br><em>You set the boundaries.</em></h2><p>Every action meets your policies before it reaches execution.<br>Explore the gate. See every decision.</p>${btn("Open the playground ↗", "nav", "hero-button", 'data-page="playground"')}</div>${hiveArt()}</section>
    <section class="stats">${stat("Total requests", data.totalExecutions, "Across your workspace · all time", "bolt")}${stat("Awaiting approval", data.pendingApprovals, "Waiting for a human decision", "shield")}${stat("Active agents", data.activeAgents, "Out of " + data.agents + " agents", "agents")}${stat("Uncertain outcomes", data.counts.OUTCOME_UNKNOWN || 0, "Check before attempting again", "clock")}</section>
    <div class="overview-columns"><section class="panel"><div class="panel-title"><div><h2>Recent executions</h2><p class="small muted">The latest activity across your hive</p></div>${btn("View all ↗", "nav", "ghost compact", 'data-page="executions"')}</div>${executionTable(data.recent)}</section>
    <section class="panel"><div class="panel-title"><h2>Execution breakdown</h2><span class="small muted">ALL TIME</span></div><p class="small muted">Recorded execution outcomes</p>${["SUCCEEDED", "RECEIVED", "EXECUTING", "DENIED", "FAILED", "OUTCOME_UNKNOWN"].map((status) => `<div class="bar-row"><span>${e(labels[status])}</span><progress max="${Math.max(data.totalExecutions, 1)}" value="${data.counts[status] || 0}" aria-label="${e(labels[status])}"></progress><b>${data.counts[status] || 0}</b></div>`).join("")}</section></div>
    <div class="guide-card"><div class="row"><img src="/console/logo.svg" alt=""><div><h3>From your first agent to your first action.</h3><p>A short guide to a complete workflow without Postman.</p></div></div>${btn("Getting started ↗", "nav", "", 'data-page="help"')}</div>
    <div class="console-footer"><span>${e(state.org.name)} · ${e(data.environment)}</span><span>${data.fakeExecutionEnabled ? "Fake Commerce enabled · effects are simulated" : "Fake execution disabled"} · Connected backend</span></div>`;
}
async function executionsView() {
  const q = new URLSearchParams();
  if (state.filter) q.set("status", state.filter);
  if (state.cursor) q.set("cursor", state.cursor);
  const data = await api(url("executions") + "?" + q);
  return `${pageHead("Executions", "Follow the decision, attempts and outcome in one record.")}<section class="panel"><div class="panel-title"><h2>Action history</h2><select id="execution-filter" class="control" aria-label="Filter by status"><option value="">All statuses</option>${["RECEIVED", "EXECUTING", "SUCCEEDED", "FAILED", "DENIED", "OUTCOME_UNKNOWN"].map((s) => `<option value="${s}" ${state.filter === s ? "selected" : ""}>${labels[s]}</option>`).join("")}</select></div>${executionTable(data.items)}<div class="pager"><span>Up to 25 requests per page</span><div class="row">${state.cursor ? btn("Newest", "exec-first", "compact") : ""}${data.nextCursor ? btn("Older", "exec-next", "compact", `data-id="${e(data.nextCursor)}"`) : ""}</div></div></section>`;
}
async function agentsView() {
  const data = await api(
    "/agents?" +
      new URLSearchParams({
        organizationId: state.org.id,
        limit: "20",
        offset: String(state.agentOffset),
      }),
  );
  return `${pageHead("Agents & keys", "Distinct agent identities. New keys are shown only once.", owner() ? btn(icon("plus") + " Add agent", "new-agent", "primary") : "")}<section class="panel">${data.items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Agent</th><th>Status</th><th>Created</th><th>Key management</th></tr></thead><tbody>${data.items.map((a) => `<tr><td><strong class="mono">${e(a.name)}</strong><small class="mono">${e(a.id)}</small></td><td>${badge(a.status)}</td><td>${e(date(a.createdAt))}</td><td>${owner() ? btn(icon("key") + " Issue key", "issue-key", "compact", `data-id="${e(a.id)}" data-name="${e(a.name)}"`) : '<span class="muted">Owner access only</span>'}</td></tr>`).join("")}</tbody></table></div>` : empty("Add your first agent", "Use a clear name such as refund-agent to identify its requests.", owner() ? btn("Add agent", "new-agent", "primary") : "")}<div class="pager"><span>20 agents per page</span><div class="row">${state.agentOffset ? btn("Previous", "agent-prev", "compact") : ""}${data.hasMore ? btn("Next", "agent-next", "compact") : ""}</div></div></section><p class="footer-note">Agent suspension and key revocation are not available in this console release.</p>`;
}
async function approvalsView() {
  const data = await api(
    "/v1/approvals?" +
      new URLSearchParams({
        organizationId: state.org.id,
        limit: "20",
        offset: String(state.approvalOffset),
      }),
  );
  return `${pageHead("Approvals", "Review the stored action before deciding. Approval alone does not execute it.")}<div class="notice">${owner() ? "Approval and rejection decisions are final. Open the request and review its values before deciding." : "MEMBER access includes summaries only. Request details and decisions are restricted to the owner."}</div><section class="panel">${data.items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Action</th><th>Approval status</th><th>Execution status</th><th>Requested</th><th></th></tr></thead><tbody>${data.items.map((a) => `<tr><td><code>${e(a.actionName)}</code><small class="mono">${e(shortId(a.id))}</small></td><td>${badge(a.status)}</td><td>${badge(a.executionStatus)}</td><td>${e(date(a.createdAt))}</td><td>${btn(owner() ? "Review request" : "View summary", "approval", "compact", `data-id="${e(a.id)}"`)}</td></tr>`).join("")}</tbody></table></div>` : empty("No approvals yet", "Requests that need a human decision will appear here.")}<div class="pager"><span>Newest first</span><div class="row">${state.approvalOffset ? btn("Previous", "approval-prev", "compact") : ""}${data.items.length === 20 && state.approvalOffset < 10000 ? btn("Next", "approval-next", "compact") : ""}</div></div></section>`;
}
function budgetView() {
  return `${pageHead("Refund budget", "Daily workspace capacity, scoped to the UTC day execution first starts.")}<section class="panel"><form data-form="budget" class="row">${field("Day — UTC", "day", `type="date" value="${new Date().toISOString().slice(0, 10)}" required`)}<label class="field">Environment<select name="environment">${["development", "staging", "production"].map((x) => `<option ${state.overview?.environment === x ? "selected" : ""}>${x}</option>`).join("")}</select></label><button class="btn primary" type="submit">View budget</button><div class="form-error" role="alert"></div></form></section><div id="budget-result">${empty("Choose a day and environment", "A budget record appears after the first reservation in an enabled scope. No record does not mean zero capacity.")}</div><div class="notice">Uncertain outcomes retain their reservation. Retries reuse it, even after a new day begins.</div>`;
}
async function studiesView() {
  const q = state.studyCursor
    ? "?cursor=" + encodeURIComponent(state.studyCursor)
    : "";
  const data = await api(
    `/v1/organizations/${state.org.id}/policy-observations${q}`,
  );
  return `${pageHead("Observe before you execute", "Hypothetical decisions and historical simulations do not authorize execution.", owner() ? btn(icon("flask") + " Simulate policy", "simulate", "primary") : "")}<div class="notice">ALLOW here is not execution approval. Simulation does not check budget or provider state and does not change the active policy.</div><section class="panel">${data.items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Study</th><th>Type</th><th>Allow / deny / approval</th><th>Date</th><th></th></tr></thead><tbody>${data.items.map((s) => `<tr><td><code>${e(shortId(s.id))}</code></td><td>${s.mode === "SIMULATE" ? "Historical simulation" : "Action observation"}</td><td><code>${e(s.summary?.allow ?? 0)} / ${e(s.summary?.deny ?? 0)} / ${e(s.summary?.requireApproval ?? 0)}</code></td><td>${e(date(s.createdAt))}</td><td>${btn("Details", "study", "compact", `data-id="${e(s.id)}"`)}</td></tr>`).join("")}</tbody></table></div>` : empty("No studies yet", "Use Observe only in the playground, or simulate a policy against stored executions.")}<div class="pager"><span>Unexpired records only · 30-day retention</span><div class="row">${state.studyCursor ? btn("Newest", "study-first", "compact") : ""}${data.nextCursor ? btn("Older", "study-next", "compact", `data-id="${e(data.nextCursor)}"`) : ""}</div></div></section>`;
}
function playgroundView() {
  const d = state.draft;
  return `${pageHead("Action playground", "Real API requests. Simulated effects inside Fake Commerce.")}<div class="two"><section class="panel stack"><div class="panel-title"><h2>Propose an action</h2><code>refund.create</code></div><div class="key-state">${icon("key")}<span>${state.agent ? "Agent connected · " + e(shortId(state.agent.agentId)) : "No agent key connected"}</span>${btn(state.agent ? "Change" : "Connect key", "bind-key", "ghost compact")}</div><form class="form" data-form="action">${field("Payment ID", "paymentId", `value="${e(d.paymentId)}" placeholder="payment_demo" dir="ltr" required maxlength="128" ${state.intent ? "disabled" : ""}`, "Prepare this payment in the lab for the same organization first.")}${field("Amount (USD)", "amount", `value="${e(d.amount)}" inputmode="decimal" dir="ltr" required ${state.intent ? "disabled" : ""}`, "Example: $100.00 = 10000 cents. Conversion is automatic.")}${field("Idempotency key", "idempotencyKey", `value="${e(d.key)}" dir="ltr" required maxlength="128" ${state.intent ? "disabled" : ""}`, "The same key and payload return the same execution record.")}<div class="form-error" role="alert"></div><div class="row"><button type="submit" class="btn primary" name="mode" value="submit" ${!state.agent ? "disabled" : ""}>${icon("bolt")}${state.intent ? "Resend the same request" : "Submit action"}</button><button type="submit" class="btn" name="mode" value="observe" ${!state.agent ? "disabled" : ""}>${icon("flask")}Observe only</button></div></form>${state.intent ? `<div class="notice">This page keeps the request and its key in memory. Save its ID before closing. Do not start a new request if the outcome is uncertain.</div>${btn("Copy key", "copy-intent", "compact")}${btn("Start a new request", "new-intent", "ghost compact")}` : ""}</section><section class="panel stack"><div><h2>Gate response</h2><p class="small muted">The server response, without changing execution state in the browser.</p></div>${state.lastResult ? resultView(state.lastResult) : empty("Ready when you are.", "Start with observation to understand the policy decision before submitting an action.")}${state.lastObserved ? `<div class="result"><h3>Latest observation — no action executed</h3>${json(state.lastObserved)}</div>` : ""}</section></div>`;
}
function resultView(data) {
  return `<div class="result">${data.status ? badge(data.status) : data.decision ? badge(data.decision) : '<span class="pill warn">Response needs review</span>'}${data.message ? `<p>${e(data.message)}</p>` : ""}${json(data)}<div class="row">${(data.id && !data.mode) || data.executionId ? btn("View execution", "execution", "compact", `data-id="${e(data.executionId || data.id)}"`) : ""}${data.approvalId ? btn("Review approval", "approval", "compact", `data-id="${e(data.approvalId)}"`) : ""}</div></div>`;
}
function helpView() {
  return `${pageHead("Your hive, step by step.", "Start with a small, understandable experiment using your actual server data.")}<div class="two"><section class="panel"><div class="help-list"><div class="help-item"><div><h3>A workspace and an agent</h3><p>Create a workspace, then add an agent such as refund-agent. Select Issue key and keep the secret outside your repository.</p>${btn("Agents & keys", "nav", "ghost compact", 'data-page="agents"')}</div></div><div class="help-item"><div><h3>Prepare the server policy</h3><p>The active policy is configured in POLICY_RULES_JSON. The default is deny. Run this script to generate sample rules, put the output in .env, then restart the server.</p><pre>node scripts/print-demo-policy.mjs ${e(state.org.id)}</pre></div></div><div class="help-item"><div><h3>Prepare a fake payment</h3><p>Run this script in a development terminal connected to the correct database with Fake Commerce enabled. The value 100000 means $1000.</p><pre>node scripts/seed-fake-payment.mjs ${e(state.org.id)} payment_console 100000</pre></div></div><div class="help-item"><div><h3>Observe, approve, then execute</h3><p>Connect an agent key in the playground. If approval is required, review it as owner, then resume from execution details. The decision alone does not call the provider.</p>${btn("Try an action", "nav", "primary compact", 'data-page="playground"')}</div></div></div></section><section class="panel stack"><h2>Clear boundaries. A clearer experience.</h2><div class="notice">Fake execution is prohibited when NODE_ENV=production. The console does not change server settings.</div><p>The session and agent key stay in page memory only, never in localStorage or browser files. Reloading or signing out clears them.</p><p>Owners review request details and make decisions. Members see safe summaries without arguments or results.</p><p>Every execution remains subject to backend policy, approvals, claims and budget checks. Hiding a button does not grant or enforce authority.</p><div class="separator"></div><h3>Workspace reference</h3><div class="code-row"><code>${e(state.org.id)}</code>${btn(icon("copy"), "copy-org", "ghost compact", 'aria-label="Copy workspace ID"')}</div><p class="small muted">This console does not edit policies or budgets, or add a real payment provider.</p></section></div>`;
}
async function openExecution(id) {
  const x = await api(url("executions/" + encodeURIComponent(id)));
  const bound = state.agent?.agentId === x.agentId;
  const canResume =
    x.status === "RECEIVED" && x.approval?.status === "APPROVED";
  const uncertain = ["EXECUTING", "OUTCOME_UNKNOWN"].includes(x.status);
  modal(
    "Execution details",
    `<div class="row between"><code>${e(x.actionName)}</code>${badge(x.status)}</div><div class="code-row"><code>${e(x.id)}</code>${btn(icon("copy"), "copy-text", "ghost compact", `data-text="${e(x.id)}" aria-label="Copy execution ID"`)}</div><div class="detail-grid"><div><span>Agent</span><strong class="mono">${e(x.agent.name)}</strong></div><div><span>Environment</span><strong>${e(x.environment)}</strong></div><div><span>Original policy decision</span>${x.policyDecision ? badge(x.policyDecision) : "Not recorded"}</div><div><span>Decision reason</span><code>${e(x.policyReason || "—")}</code></div><div><span>Received</span><strong>${e(date(x.requestedAt))}</strong></div><div><span>Last updated</span><strong>${e(date(x.updatedAt))}</strong></div></div>${x.errorCode ? `<div class="notice error"><code>${e(x.errorCode)}</code></div>` : ""}${x.blockedPolicyDecision ? `<div class="notice">Policy tightened later: ${badge(x.blockedPolicyDecision)} · ${e(date(x.blockedAt))}</div>` : ""}${x.approval ? `<div class="row between"><span>Approval ${badge(x.approval.status)}</span>${btn("View approval", "approval", "compact", `data-id="${e(x.approval.id)}"`)}</div>` : ""}${owner() ? `<div><h3>Stored data</h3>${json({ arguments: x.arguments, result: x.result, resourceType: x.resourceType, resourceId: x.resourceId })}</div>` : '<div class="notice">MEMBER view: a summary without sensitive request or result data.</div>'}<div><h3>Execution attempts</h3>${x.attempts.length ? `<div class="timeline">${x.attempts.map((a) => `<div><div class="row"><b>Attempt ${a.attemptNumber}</b>${badge(a.status)}</div><small>${e(date(a.startedAt))}</small>${a.resolvedStatus ? `<p class="small">Outcome confirmed: ${badge(a.resolvedStatus)}</p>` : ""}${a.errorCode ? `<code>${e(a.errorCode)}</code>` : ""}</div>`).join("")}</div>` : '<p class="muted small">The provider has not been called.</p>'}</div>${uncertain ? '<div class="notice">A missing response does not prove non-execution. Start by checking the outcome. The server determines retry eligibility.</div>' : ""}<div class="row">${canResume && bound ? btn("Resume execution", "execution-op", "primary", `data-id="${e(x.id)}" data-op="resume"`) : ""}${uncertain && (owner() || bound) ? btn("Check outcome", "execution-op", "", `data-id="${e(x.id)}" data-op="reconcile"`) : ""}${x.status === "OUTCOME_UNKNOWN" && bound && x.attemptCount < 3 ? btn("Request a safe retry", "execution-op", "", `data-id="${e(x.id)}" data-op="retry"`) : ""}${btn("Refresh", "execution", "ghost", `data-id="${e(x.id)}"`)}</div>${(canResume || uncertain) && !bound ? '<p class="small muted">To resume or retry, connect a key for the same agent in the playground.</p>' : ""}`,
  );
}
async function openApproval(id) {
  const a = await api("/v1/approvals/" + encodeURIComponent(id));
  modal(
    "Review approval",
    `<div class="row between"><code>${e(a.actionName)}</code>${badge(a.status)}</div><div class="detail-grid"><div><span>Approval ID</span><code>${e(a.id)}</code></div><div><span>Received at</span>${e(date(a.createdAt))}</div><div><span>Execution status</span>${badge(a.executionStatus)}</div><div><span>Decided at</span>${e(date(a.decidedAt))}</div></div>${a.request ? `<div class="notice">Review these values. Your decision binds to this stored action and cannot change once recorded.</div>${a.request.action.name === "refund.create" ? `<div class="row"><strong class="ltr">${money(a.request.arguments.amountMinor)}</strong><code>${e(a.request.arguments.paymentId)}</code></div>` : ""}${json(a.request)}` : '<div class="notice">Action details are available to the owner only.</div>'}${a.status === "PENDING" && owner() && a.request ? `<form data-form="decision" data-id="${e(a.id)}" class="form"><label class="checkline"><input type="checkbox" required>I reviewed the action, values and organization. I understand the decision is final and approval does not execute the action automatically.</label><div class="form-error" role="alert"></div><div class="row"><button class="btn primary" name="decision" value="APPROVED" type="submit">Approve action</button><button class="btn danger" name="decision" value="REJECTED" type="submit">Reject action</button></div></form>` : ""}${btn("View linked execution", "execution", "ghost", `data-id="${e(a.executionId)}"`)}`,
  );
}
function bindModal() {
  modal(
    "Connect an agent key",
    `<p>The key stays in page memory only. We verify that the agent belongs to this workspace before any action.</p><form class="form" data-form="bind">${field("API key", "key", 'type="password" autocomplete="off" spellcheck="false" required dir="ltr" placeholder="agt_live_…"')}<div class="form-error" role="alert"></div><button class="btn primary" type="submit">Verify and connect</button></form>${state.agent ? btn("Disconnect current key", "unbind", "ghost") : ""}`,
  );
}
async function bindKey(key) {
  const identity = await api("/v1/console-agent/identity", { key });
  if (identity.organizationId !== state.org.id)
    throw new Error(
      "This key belongs to another organization. Select that workspace or use a key from the current one.",
    );
  if (state.intent && identity.agentId !== state.intentAgentId)
    throw new Error(
      "This saved request belongs to another agent. Connect the same agent or review its outcome before starting a new request.",
    );
  state.agent = { ...identity, key };
}
async function clickAction(target) {
  const act = target.dataset.act;
  if (act === "close") {
    closeDialog();
    return;
  }
  if (act === "logout") {
    logout();
    return;
  }
  if (act === "login-view" || act === "register-view") {
    authScreen(act === "register-view");
    return;
  }
  if (act === "menu") {
    document.querySelector(".sidebar").classList.toggle("open");
    return;
  }
  if (act === "nav") {
    closeDialog();
    await navigate(target.dataset.page);
    return;
  }
  if (act === "refresh") {
    await navigate();
    return;
  }
  if (act === "new-org") {
    modal(
      "Create workspace",
      `<p class="muted">An isolated space for your agents, policies and executions. You will own the new workspace.</p><form class="form" data-form="organization">${field("Workspace name", "name", 'required maxlength="120" placeholder="e.g. Commerce team"')}<div class="form-error" role="alert"></div><button class="btn primary" type="submit">Create workspace</button></form>`,
    );
    return;
  }
  if (act === "new-agent") {
    modal(
      "Add agent",
      `<form class="form" data-form="agent">${field("Agent name", "name", 'required maxlength="100" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" dir="ltr" placeholder="refund-agent"', "Lowercase English letters, numbers and single hyphens.")}<div class="form-error" role="alert"></div><button class="btn primary" type="submit">Add agent</button></form>`,
    );
    return;
  }
  if (act === "issue-key") {
    if (
      !confirm(
        `Issue a new key for agent ${target.dataset.name}? The key grants the agent identity and will be shown only once.`,
      )
    )
      return;
    const data = await api(`/agents/${target.dataset.id}/credentials`, {
      method: "POST",
      body: { organizationId: state.org.id },
    });
    generatedKey = data.apiKey;
    modal(
      "Save your agent key",
      `<div class="notice">This key is shown only once. Save it in a secret manager, not screenshots or your repository. Issuing a new key does not revoke older keys.</div><label class="field">New key<textarea id="issued-key" class="secret" readonly aria-label="New key" spellcheck="false"></textarea></label><div class="row">${btn("Copy key", "copy-key", "primary")}${btn("Use in playground", "use-key", "")}</div><p class="small muted">Closing clears this displayed copy. If connected to the playground, the app retains it in memory until sign-out.</p>`,
    );
    document.querySelector("#issued-key").value = data.apiKey;
    return;
  }
  if (act === "copy-key") {
    await navigator.clipboard.writeText(generatedKey);
    notify("Key copied. Keep it safe.");
    return;
  }
  if (act === "use-key") {
    await bindKey(generatedKey);
    closeDialog();
    await navigate("playground");
    notify("Agent connected to this workspace.");
    return;
  }
  if (act === "bind-key") {
    bindModal();
    return;
  }
  if (act === "unbind") {
    state.agent = null;
    closeDialog();
    await navigate();
    return;
  }
  if (act === "execution") {
    await openExecution(target.dataset.id);
    return;
  }
  if (act === "approval") {
    await openApproval(target.dataset.id);
    return;
  }
  if (act === "execution-op") {
    const op = target.dataset.op;
    if (!["resume", "retry", "reconcile"].includes(op)) return;
    if (
      op !== "reconcile" &&
      !confirm(
        op === "retry"
          ? "Retry the same execution with the same provider operation key? The server will check eligibility, policy and budget. Continue?"
          : "Resume the stored action after checking approval, policy and budget?",
      )
    )
      return;
    const path =
      op === "reconcile" && owner()
        ? `/v1/organizations/${state.org.id}/executions/${target.dataset.id}/reconcile`
        : `/v1/executions/${target.dataset.id}/${op}`;
    await api(path, {
      method: "POST",
      body: {},
      agent: !(op === "reconcile" && owner()),
    });
    await navigate();
    await openExecution(target.dataset.id);
    notify("Execution status updated.");
    return;
  }
  if (act === "agent-next" || act === "agent-prev") {
    state.agentOffset = Math.max(
      0,
      state.agentOffset + (act === "agent-next" ? 20 : -20),
    );
    await navigate();
    return;
  }
  if (act === "approval-next" || act === "approval-prev") {
    state.approvalOffset = Math.max(
      0,
      state.approvalOffset + (act === "approval-next" ? 20 : -20),
    );
    await navigate();
    return;
  }
  if (act === "exec-next" || act === "exec-first") {
    state.cursor = act === "exec-first" ? null : target.dataset.id;
    await navigate();
    return;
  }
  if (act === "study-next" || act === "study-first") {
    state.studyCursor = act === "study-first" ? null : target.dataset.id;
    await navigate();
    return;
  }
  if (act === "study") {
    const data = await api(
      `/v1/organizations/${state.org.id}/policy-observations/${target.dataset.id}`,
    );
    modal(
      "Study details",
      `<div class="notice">Study only. No execution or authorization.</div>${json(data)}`,
    );
    return;
  }
  if (act === "simulate") {
    modal(
      "Simulate a policy against history",
      `<p>Choose up to 100 execution IDs from this workspace. Candidate rules do not replace the server policy.</p><form class="form" data-form="simulation"><label class="field">Execution IDs, one per line<textarea name="ids" required dir="ltr" placeholder="execution UUID"></textarea></label><label class="field">Candidate rules — JSON without organizationId<textarea name="policies" required dir="ltr" spellcheck="false">[]</textarea><small>An empty list means default deny. See the project documentation for policy syntax.</small></label><div class="form-error" role="alert"></div><button class="btn primary" type="submit">Run simulation only</button></form>`,
    );
    return;
  }
  if (act === "copy-org" || act === "copy-text" || act === "copy-intent") {
    await navigator.clipboard.writeText(
      act === "copy-org"
        ? state.org.id
        : act === "copy-intent"
          ? state.intent.key
          : target.dataset.text,
    );
    notify("Copied.");
    return;
  }
  if (act === "new-intent") {
    if (
      !confirm(
        "A new request with a new key may create a new effect. Do not start one while the previous outcome is uncertain. Continue?",
      )
    )
      return;
    state.intent = null;
    state.lastResult = null;
    state.lastObserved = null;
    state.draft = { ...state.draft, key: crypto.randomUUID() };
    await navigate();
  }
}
async function submitForm(form, submitter) {
  const data = new FormData(form),
    name = form.dataset.form;
  if (name === "login" || name === "register") {
    const credentials = {
      email: data.get("email"),
      password: data.get("password"),
    };
    if (name === "register")
      await api("/auth/register", {
        method: "POST",
        body: credentials,
        anonymous: true,
      });
    const session = await api("/auth/login", {
      method: "POST",
      body: credentials,
      anonymous: true,
    });
    epoch++;
    state.token = session.accessToken;
    state.email = credentials.email;
    state.page = "overview";
    form.reset();
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(
      () => logout("Your session has expired. Please sign in again."),
      Math.min(session.expiresIn, 3600) * 1000,
    );
    try {
      await loadWorkspaces();
      await navigate("overview");
    } catch (error) {
      if (error instanceof StaleRequest) return;
      logout(
        "Signed in, but workspaces could not be loaded. Please sign in again.",
      );
    }
    return;
  }
  if (name === "organization") {
    const org = await api("/organizations", {
      method: "POST",
      body: { name: data.get("name") },
    });
    epoch++;
    state.agent = null;
    state.intent = null;
    state.lastResult = null;
    state.lastObserved = null;
    state.overview = null;
    state.draft = { paymentId: "", amount: "100.00", key: crypto.randomUUID() };
    await loadWorkspaces(org.id);
    closeDialog();
    await navigate("overview");
    notify("Your workspace is ready. Add your first agent.");
    return;
  }
  if (name === "agent") {
    await api("/agents", {
      method: "POST",
      body: { organizationId: state.org.id, name: data.get("name") },
    });
    state.agentOffset = 0;
    closeDialog();
    await navigate("agents");
    notify("Agent added.");
    return;
  }
  if (name === "bind") {
    await bindKey(data.get("key").trim());
    form.reset();
    closeDialog();
    await navigate();
    notify("Key verified and connected.");
    return;
  }
  if (name === "decision") {
    const decision = submitter?.value;
    if (!["APPROVED", "REJECTED"].includes(decision)) return;
    await api(`/v1/approvals/${form.dataset.id}/decision`, {
      method: "POST",
      body: { decision },
    });
    await navigate();
    await openApproval(form.dataset.id);
    notify(
      "Decision recorded. Approval does not execute the action automatically.",
    );
    return;
  }
  if (name === "budget") {
    try {
      const x = await api(
        `/v1/organizations/${state.org.id}/refund-budgets?` +
          new URLSearchParams({
            environment: data.get("environment"),
            day: data.get("day"),
          }),
      );
      document.querySelector("#budget-result").innerHTML =
        `<section class="panel"><div class="panel-title"><h2>Available for refunds</h2><span class="pill">${e(x.environment)} · USD</span></div><div class="budget-amount ltr">${money(x.availableMinor)}</div><p class="muted">Of total ${money(x.limitMinor)} · ${e(String(x.day).slice(0, 10))} UTC</p><progress max="${Math.max(x.limitMinor, 1)}" value="${x.reservedMinor + x.consumedMinor}" aria-label="Reserved and consumed capacity"></progress><div class="metric-list"><div><span>Consumed — confirmed outcomes</span><b class="ltr">${money(x.consumedMinor)}</b></div><div><span>Reserved — not yet settled</span><b class="ltr">${money(x.reservedMinor)}</b></div><div><span>Available</span><b class="ltr">${money(x.availableMinor)}</b></div></div></section>`;
    } catch (error) {
      if (error.status === 404) {
        document.querySelector("#budget-result").innerHTML = empty(
          "No budget record for this day",
          "No bucket has opened for this scope. This does not imply zero or unlimited budget.",
        );
      } else throw error;
    }
    return;
  }
  if (name === "simulation") {
    let policies;
    try {
      policies = JSON.parse(data.get("policies"));
    } catch {
      throw new Error("Invalid policy JSON.");
    }
    const executionIds = data
      .get("ids")
      .split(/[\s,]+/)
      .filter(Boolean);
    const result = await api(
      `/v1/organizations/${state.org.id}/policy-simulations`,
      { method: "POST", body: { executionIds, policies } },
    );
    modal(
      "Simulation result",
      `<div class="notice">This result does not change execution permissions.</div>${json(result)}`,
    );
    return;
  }
  if (name === "action") {
    if (!state.agent) throw new Error("Connect an agent key first.");
    if (!state.intent)
      state.draft = {
        paymentId: data.get("paymentId"),
        amount: data.get("amount"),
        key: data.get("idempotencyKey"),
      };
    const body = refundPayload(state.draft.paymentId, state.draft.amount);
    if (submitter?.value === "observe") {
      state.lastObserved = await api("/v1/actions/observe", {
        method: "POST",
        body,
        agent: true,
      });
    } else {
      usdToMinor(state.draft.amount);
      if (
        !state.intent &&
        !confirm(
          `Submit a simulated refund of ${money(body.arguments.amountMinor)} for payment ${body.arguments.paymentId}?`,
        )
      )
        return;
      state.intent = lockIntent(state.intent, body, state.draft.key);
      state.intentAgentId = state.agent.agentId;
      state.lastResult = await submitIntent(state.intent);
    }
    await navigate("playground");
    return;
  }
}
root.addEventListener("input", (event) => {
  if (event.target.closest('[data-form="action"]') && !state.intent) {
    const f = event.target.form;
    state.draft = {
      paymentId: f.elements.paymentId.value,
      amount: f.elements.amount.value,
      key: f.elements.idempotencyKey.value,
    };
  }
});
root.addEventListener("change", async (event) => {
  try {
    if (event.target.id === "workspace") {
      const org = state.workspaces.find((w) => w.id === event.target.value);
      if (!org || org.id === state.org?.id) return;
      epoch++;
      loadId++;
      state.org = org;
      state.agent = null;
      state.intent = null;
      state.lastResult = null;
      state.lastObserved = null;
      state.overview = null;
      state.cursor = null;
      state.studyCursor = null;
      state.filter = "";
      state.agentOffset = 0;
      state.approvalOffset = 0;
      state.draft = {
        paymentId: "",
        amount: "100.00",
        key: crypto.randomUUID(),
      };
      closeDialog();
      await navigate();
    } else if (event.target.id === "execution-filter") {
      state.filter = event.target.value;
      state.cursor = null;
      await navigate();
    }
  } catch (error) {
    if (!(error instanceof StaleRequest)) notify(error.message);
  }
});
for (const host of [root, dialog]) {
  host.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-act]");
    if (!target || target.disabled) return;
    target.disabled = true;
    try {
      await clickAction(target);
    } catch (error) {
      if (!(error instanceof StaleRequest)) notify(error.message);
    } finally {
      target.disabled = false;
    }
  });
  host.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!form.dataset.form) return;
    event.preventDefault();
    if (form.dataset.busy) return;
    form.dataset.busy = "true";
    const buttons = [...form.querySelectorAll("button")];
    const before = buttons.map((b) => b.disabled);
    buttons.forEach((b) => {
      b.disabled = true;
    });
    const err = form.querySelector(".form-error");
    if (err) err.textContent = "";
    try {
      await submitForm(form, event.submitter);
    } catch (error) {
      if (!(error instanceof StaleRequest)) {
        if (err) {
          err.className = "form-error notice error";
          err.textContent = error.message;
        } else notify(error.message);
      }
    } finally {
      delete form.dataset.busy;
      buttons.forEach((b, i) => {
        b.disabled = before[i];
      });
    }
  });
}
authScreen();
