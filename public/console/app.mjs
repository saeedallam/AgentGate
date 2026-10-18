import { createViews } from "./pages/index.mjs";
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
const {
  overviewView,
  executionsView,
  agentsView,
  approvalsView,
  budgetView,
  studiesView,
  playgroundView,
  helpView,
  openExecution,
  openApproval,
} = createViews({
  getState: () => state,
  modal,
  e,
  labels,
  money,
  shortId,
  api,
  url,
  owner,
  btn,
  badge,
  empty,
  pageHead,
  json,
  field,
  date,
  icon,
});

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
        `<section class="panel"><div class="panel-title"><h2>Available for refunds</h2><span class="pill">${e(x.environment)} · USD</span></div><div class="budget-amount ltr">${money(x.availableMinor)}</div><p class="muted">Of total ${money(x.limitMinor)} · ${e(String(x.day).slice(0, 10))} UTC</p><p class="muted">Next UTC day: ${x.nextDayLimitMinor == null ? "No configured cap" : money(x.nextDayLimitMinor)}. Today’s recorded cap remains unchanged.</p><progress max="${Math.max(x.limitMinor, 1)}" value="${x.reservedMinor + x.consumedMinor}" aria-label="Reserved and consumed capacity"></progress><div class="metric-list"><div><span>Consumed — confirmed outcomes</span><b class="ltr">${money(x.consumedMinor)}</b></div><div><span>Reserved — not yet settled</span><b class="ltr">${money(x.reservedMinor)}</b></div><div><span>Available</span><b class="ltr">${money(x.availableMinor)}</b></div></div></section>`;
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
