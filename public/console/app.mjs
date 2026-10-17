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
  arrow: "M19 12H5m6-6-6 6 6 6",
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
  '<div class="brand"><span>Agent<span>Gate</span></span><img src="/console/logo.svg" alt=""></div>';
const nav = [
  ["overview", "نظرة عامة", "grid"],
  ["executions", "التنفيذات", "bolt"],
  ["approvals", "الموافقات", "shield"],
  ["agents", "الوكلاء والمفاتيح", "agents"],
  ["budgets", "ميزانية الاسترداد", "wallet"],
  ["studies", "المحاكاة والمراقبة", "flask"],
  ["playground", "جرّب فعلًا", "bolt"],
  ["help", "دليل البداية", "info"],
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
    ? new Date(value).toLocaleString("ar-EG", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const btn = (text, act, cls = "", data = "") =>
  `<button type="button" class="btn ${cls}" data-act="${act}" ${data}>${text}</button>`;
const badge = (status) =>
  `<span class="pill ${["SUCCEEDED", "APPROVED", "ACTIVE", "ALLOW"].includes(status) ? "good" : ["FAILED", "DENIED", "REJECTED", "DENY", "SUSPENDED"].includes(status) ? "bad" : status === "EXECUTING" ? "blue" : "warn"}">${e(labels[status] || status || "غير متاح")}</span>`;
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
  dialog.innerHTML = `<header class="dialog-head"><h2 id="dialog-title">${e(title)}</h2>${btn(icon("close"), "close", "ghost compact", 'aria-label="إغلاق"')}</header><div class="dialog-body">${body}</div>`;
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
    throw new Error(agent ? "اربط مفتاح وكيل أولًا." : "سجّل الدخول أولًا.");
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
        logout("انتهت جلسة الدخول. سجّل الدخول من جديد.");
        throw new StaleRequest();
      }
      if (response.status === 401 && agent) state.agent = null;
      const err = new Error(
        response.status >= 500
          ? "الخدمة غير متاحة الآن. لو الطلب قد ينفّذ فعلًا، تحقّق من النتيجة قبل أي محاولة جديدة."
          : Array.isArray(data.message)
            ? data.message.join("، ")
            : data.message || "تعذر إكمال الطلب.",
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
      "تعذر تأكيد الرد. افحص الاتصال؛ لا تفترض أن الفعل لم يُنفَّذ. احتفظ بنفس مفتاح الطلب.",
    );
  } finally {
    clearTimeout(timer);
  }
}
// Submit is intentionally separate: never rotate keys or retry automatically on transport failure.
async function submitIntent(intent) {
  if (state.agent?.agentId !== state.intentAgentId)
    throw new Error(
      "الطلب المثبت مرتبط بوكيل مختلف. اربط نفس الوكيل قبل إعادة الإرسال.",
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
            "تعذر تأكيد نتيجة التنفيذ. احتفظ بنفس المفتاح وتحقق من الحالة.",
        }
      : data;
  } catch (error) {
    if (current !== epoch || error instanceof StaleRequest)
      throw new StaleRequest();
    return {
      statusCode: 0,
      message:
        "الرد غير مؤكد. الطلب ومفتاحه محفوظان في هذه الصفحة. أعد إرسال نفس الطلب فقط؛ لا تبدأ طلبًا جديدًا.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
function authScreen(register = false) {
  root.innerHTML = `<div class="auth"><section class="auth-intro">${brand}<div><div class="eyebrow">A HOME FOR SAFE AGENT ACTIONS</div><h1>وكلاؤك يعملون.<br>والقرار في إيدك.</h1><p>مكان واحد لمتابعة الأفعال، مراجعة الموافقات، وفهم ما حدث بالفعل.</p><div class="hive-visual"><div class="hive-cell"><strong>الوكيل يقترح</strong><span>فعل محدّد، وهوية موثوقة</span></div><div class="hive-center"><img src="/console/logo.svg" alt=""></div><div class="hive-cell"><strong>أنت تتحكم</strong><span>سياسة، موافقة، ثم تنفيذ</span></div></div></div><div class="auth-foot"><span>◈ عزل المؤسسات</span><span>◈ موافقة على الفعل نفسه</span><span>◈ تتبّع النتيجة</span></div></section><main id="main" class="auth-form"><div class="auth-card"><div class="eyebrow">AGENTGATE CONSOLE</div><h2>${register ? "ابدأ مساحة عملك" : "أهلًا بعودتك"}</h2><p class="muted">${register ? "أنشئ حسابًا، وبعدها جهّز مؤسستك وأول وكيل." : "سجّل الدخول لمتابعة مؤسستك والوكلاء."}</p><form class="form" data-form="${register ? "register" : "login"}">${field("البريد الإلكتروني", "email", 'type="email" autocomplete="username" required maxlength="320" dir="ltr" placeholder="you@company.com"')}${field("كلمة المرور", "password", `type="password" autocomplete="${register ? "new-password" : "current-password"}" required ${register ? 'minlength="15"' : ""} maxlength="128" dir="ltr"`, register ? "15 حرفًا على الأقل." : "")}<div class="form-error" role="alert"></div><button class="btn primary full" type="submit">${register ? "إنشاء حساب" : "تسجيل الدخول"} ${icon("arrow")}</button></form><div class="auth-bottom"><span class="muted">${register ? "عندك حساب؟" : "أول مرة هنا؟"}</span> ${btn(register ? "تسجيل الدخول" : "إنشاء حساب", register ? "login-view" : "register-view", "ghost compact")}</div><p class="footer-note">الجلسة في ذاكرة الصفحة فقط. إعادة تحميل الصفحة تتطلب تسجيل الدخول.</p></div></main></div>`;
}
function shell() {
  root.innerHTML = `<div class="app-shell"><aside class="sidebar">${brand}<div class="workspace"><label for="workspace">مساحة العمل</label><select id="workspace" aria-label="المؤسسة">${state.workspaces.map((w) => `<option value="${e(w.id)}" ${w.id === state.org?.id ? "selected" : ""}>${e(w.name)}</option>`).join("") || "<option>لا توجد مؤسسة بعد</option>"}</select><div class="role">${owner() ? "OWNER · إدارة وموافقة" : state.org ? "MEMBER · مراقبة" : "ابدأ بمؤسسة جديدة"}</div>${btn("+ مؤسسة جديدة", "new-org", "ghost compact")}</div><div><div class="nav-label">مساحة التحكم</div><nav class="nav" aria-label="القائمة الرئيسية">${nav.map(([id, name, ic]) => `<button type="button" data-act="nav" data-page="${id}" class="${state.page === id ? "active" : ""}" ${state.page === id ? 'aria-current="page"' : ""}>${icon(ic)}${name}</button>`).join("")}</nav></div><div class="sidebar-bottom"><div class="sidebar-note">نسخة تجريبية · Fake Commerce<br>الأفعال المالية هنا محاكاة.</div><div class="session-card"><div class="avatar">${e(state.email[0]?.toUpperCase() || "A")}</div><div class="session-info"><strong dir="ltr">${e(state.email)}</strong><span>جلسة مؤقتة وآمنة من التخزين الدائم</span></div>${btn(icon("logout"), "logout", "ghost compact", 'aria-label="تسجيل الخروج"')}</div></div></aside><div class="main-area"><header class="topbar"><div class="row">${btn(icon("menu"), "menu", "ghost mobile-toggle", 'aria-label="فتح القائمة"')}<div class="breadcrumb">مساحة العمل / <b>${e(nav.find((n) => n[0] === state.page)?.[1])}</b></div></div><div class="row"><span class="pill" id="health-indicator">فحص الاتصال</span>${btn(icon("refresh"), "refresh", "ghost compact", 'aria-label="تحديث البيانات"')}</div></header><main id="main" class="content" tabindex="-1"><div class="loading"><div class="spinner"></div>جارٍ تحميل بيانات مؤسستك…</div></main></div></div>`;
  api("/health/ready", { anonymous: true })
    .then(() => {
      const el = document.querySelector("#health-indicator");
      if (el) {
        el.className = "pill good";
        el.textContent = "الخدمة متصلة";
      }
    })
    .catch(() => {
      const el = document.querySelector("#health-indicator");
      if (el) {
        el.className = "pill bad";
        el.textContent = "الخدمة غير جاهزة";
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
  if (result.hasMore) notify("تُعرض أول 100 مؤسسة فقط في لوحة التحكم.");
}
async function navigate(page = state.page) {
  state.page = page;
  const id = ++loadId;
  shell();
  try {
    if (!state.org) {
      document.querySelector("#main").innerHTML = empty(
        "خلّيتك لسه في البداية",
        "أنشئ مؤسسة، أضف وكيلًا، وبعدها جرّب أول فعل.",
        btn("إنشاء مؤسسة", "new-org", "primary"),
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
      "تعذر تحميل البيانات",
      error.message,
      btn("حاول مرة أخرى", "refresh", "primary"),
    );
  }
}
function executionTable(items) {
  return items.length
    ? `<div class="table-wrap"><table class="table"><thead><tr><th>الفعل / المعرّف</th><th>الوكيل</th><th>الحالة</th><th>السياسة</th><th>الوقت</th></tr></thead><tbody>${items.map((x) => `<tr><td><button class="link mono" type="button" data-act="execution" data-id="${e(x.id)}">${e(x.actionName)}</button><small class="mono">${e(shortId(x.id))}</small></td><td><code>${e(x.agent?.name || shortId(x.agentId))}</code></td><td>${badge(x.status)}</td><td>${x.policyDecision ? badge(x.policyDecision) : '<span class="muted">لا توجد لقطة سياسة</span>'}</td><td>${e(date(x.createdAt))}</td></tr>`).join("")}</tbody></table></div>`
    : empty(
        "لا توجد تنفيذات بعد",
        "أول طلب يمرّ على AgentGate هيظهر هنا بنتيجته الحقيقية.",
        btn("جرّب فعلًا", "nav", "primary", 'data-page="playground"'),
      );
}
async function overviewView() {
  const data = await api(url("overview"));
  state.overview = data;
  const stat = (title, value, sub, ic, featured = "") =>
    `<article class="stat ${featured}"><div class="stat-top">${title}<span class="stat-icon">${icon(ic)}</span></div><div class="number">${e(value)}</div><span class="small muted">${sub}</span></article>`;
  return `${pageHead("كل فعل، تحت نظرك.", "صورة واضحة عن الوكلاء والقرارات داخل " + state.org.name, btn(icon("plus") + " جرّب فعلًا", "nav", "primary", 'data-page="playground"'))}<div class="row"><span class="pill">${e(data.environment)}</span><span class="small muted">${data.fakeExecutionEnabled ? "معمل التنفيذ التجريبي مفعّل" : "التنفيذ التجريبي غير مفعّل على السيرفر"} · الأرقام لجميع الأوقات</span></div><section class="stats">${stat("إجمالي التنفيذات", data.totalExecutions, "طلبات محفوظة داخل المؤسسة", "bolt")}${stat("بانتظار الموافقة", data.pendingApprovals, "قرارك هو الخطوة التالية", "shield", "featured")}${stat("الوكلاء النشطون", data.activeAgents, "من أصل " + data.agents + " وكلاء", "agents")}${stat("نتائج غير مؤكدة", data.counts.OUTCOME_UNKNOWN || 0, "تحتاج التحقق من النتيجة", "clock")}</section><div class="two"><section class="panel"><div class="panel-title"><div><h2>حالة التنفيذات</h2><p class="small muted">توزيع الحالات المحفوظة، وليس تقديرًا.</p></div>${icon("grid")}</div>${["SUCCEEDED", "RECEIVED", "EXECUTING", "DENIED", "FAILED", "OUTCOME_UNKNOWN"].map((s) => `<div class="bar-row"><span>${e(labels[s])}</span><progress max="${Math.max(data.totalExecutions, 1)}" value="${data.counts[s] || 0}" aria-label="${e(labels[s])}"></progress><b>${data.counts[s] || 0}</b></div>`).join("")}</section><section class="panel"><div class="panel-title"><h2>رحلة الفعل المحمي</h2><span class="pill good">داخل AgentGate</span></div>${[
    ["agents", "هوية موثوقة", "الوكيل والمؤسسة من المفتاح، مش من ادعاء الطلب."],
    ["shield", "قرار واضح", "سياسة محفوظة وموافقة مرتبطة بالفعل نفسه."],
    ["wallet", "تنفيذ محسوب", "حجز التنفيذ والميزانية قبل استدعاء المزوّد."],
    [
      "clock",
      "نتيجة قابلة للتتبع",
      "الرد المفقود يظل غير مؤكد لحد التحقق منه.",
    ],
  ]
    .map(
      ([ic, t, s]) =>
        `<div class="activity"><span class="line-icon">${icon(ic)}</span><div><strong>${t}</strong><p>${s}</p></div></div>`,
    )
    .join(
      "",
    )}</section></div><section class="panel"><div class="panel-title"><div><h2>أحدث التنفيذات</h2><p class="small muted">آخر 8 طلبات داخل مؤسستك</p></div>${btn("عرض الكل " + icon("arrow"), "nav", "ghost compact", 'data-page="executions"')}</div>${executionTable(data.recent)}</section><div class="guide-card"><div class="row"><img src="/console/logo.svg" alt=""><div><h3>من أول وكيل، لأول فعل.</h3><p>دليل قصير يوصّلك لتجربة كاملة من غير Postman.</p></div></div>${btn("دليل البداية", "nav", "", 'data-page="help"')}</div>`;
}
async function executionsView() {
  const q = new URLSearchParams();
  if (state.filter) q.set("status", state.filter);
  if (state.cursor) q.set("cursor", state.cursor);
  const data = await api(url("executions") + "?" + q);
  return `${pageHead("التنفيذات", "تتبّع القرار والمحاولات والنتيجة، من نفس السجل.")}<section class="panel"><div class="panel-title"><h2>سجل الأفعال</h2><select id="execution-filter" class="control" aria-label="تصفية الحالة"><option value="">كل الحالات</option>${["RECEIVED", "EXECUTING", "SUCCEEDED", "FAILED", "DENIED", "OUTCOME_UNKNOWN"].map((s) => `<option value="${s}" ${state.filter === s ? "selected" : ""}>${labels[s]}</option>`).join("")}</select></div>${executionTable(data.items)}<div class="pager"><span>حتى 25 طلبًا في الصفحة</span><div class="row">${state.cursor ? btn("الأحدث", "exec-first", "compact") : ""}${data.nextCursor ? btn("الأقدم", "exec-next", "compact", `data-id="${e(data.nextCursor)}"`) : ""}</div></div></section>`;
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
  return `${pageHead("الوكلاء والمفاتيح", "هوية منفصلة لكل وكيل. المفتاح الجديد يُعرض مرة واحدة.", owner() ? btn(icon("plus") + " إضافة وكيل", "new-agent", "primary") : "")}<section class="panel">${data.items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>الوكيل</th><th>الحالة</th><th>تاريخ الإضافة</th><th>إدارة المفتاح</th></tr></thead><tbody>${data.items.map((a) => `<tr><td><strong class="mono">${e(a.name)}</strong><small class="mono">${e(a.id)}</small></td><td>${badge(a.status)}</td><td>${e(date(a.createdAt))}</td><td>${owner() ? btn(icon("key") + " إصدار مفتاح", "issue-key", "compact", `data-id="${e(a.id)}" data-name="${e(a.name)}"`) : '<span class="muted">متاح للمالك فقط</span>'}</td></tr>`).join("")}</tbody></table></div>` : empty("أضف أول وكيل", "استخدم اسمًا واضحًا مثل refund-agent علشان تميّز طلباته.", owner() ? btn("إضافة وكيل", "new-agent", "primary") : "")}<div class="pager"><span>20 وكيلًا لكل صفحة</span><div class="row">${state.agentOffset ? btn("السابق", "agent-prev", "compact") : ""}${data.hasMore ? btn("التالي", "agent-next", "compact") : ""}</div></div></section><p class="footer-note">إيقاف الوكيل وإلغاء المفاتيح من الواجهة غير متاحين في هذه النسخة.</p>`;
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
  return `${pageHead("الموافقات", "راجع الفعل المحفوظ قبل القرار. الموافقة وحدها لا تنفّذه.")}<div class="notice">${owner() ? "قرار الموافقة أو الرفض نهائي. افتح الطلب وراجع قيمه قبل اتخاذ القرار." : "صلاحية MEMBER تتيح متابعة الملخصات فقط. تفاصيل الطلب والقرار للمالك."}</div><section class="panel">${data.items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>الفعل</th><th>حالة الموافقة</th><th>حالة التنفيذ</th><th>وقت الطلب</th><th></th></tr></thead><tbody>${data.items.map((a) => `<tr><td><code>${e(a.actionName)}</code><small class="mono">${e(shortId(a.id))}</small></td><td>${badge(a.status)}</td><td>${badge(a.executionStatus)}</td><td>${e(date(a.createdAt))}</td><td>${btn(owner() ? "مراجعة الطلب" : "عرض الملخص", "approval", "compact", `data-id="${e(a.id)}"`)}</td></tr>`).join("")}</tbody></table></div>` : empty("لا توجد موافقات بعد", "الطلبات التي تحتاج قرارًا بشريًا ستظهر هنا.")}<div class="pager"><span>الأحدث أولًا</span><div class="row">${state.approvalOffset ? btn("السابق", "approval-prev", "compact") : ""}${data.items.length === 20 && state.approvalOffset < 10000 ? btn("التالي", "approval-next", "compact") : ""}</div></div></section>`;
}
function budgetView() {
  return `${pageHead("ميزانية الاسترداد", "السعة اليومية للمؤسسة، محسوبة حسب يوم بدء التنفيذ بتوقيت UTC.")}<section class="panel"><form data-form="budget" class="row">${field("اليوم — UTC", "day", `type="date" value="${new Date().toISOString().slice(0, 10)}" required`)}<label class="field">البيئة<select name="environment">${["development", "staging", "production"].map((x) => `<option ${state.overview?.environment === x ? "selected" : ""}>${x}</option>`).join("")}</select></label><button class="btn primary" type="submit">عرض الميزانية</button><div class="form-error" role="alert"></div></form></section><div id="budget-result">${empty("اختر اليوم والبيئة", "تظهر الميزانية بعد فتح أول حجز في نطاق مفعّل. عدم وجود سجل لا يعني أن المتاح صفر.")}</div><div class="notice">النتيجة غير المؤكدة تحتفظ بالحجز. إعادة المحاولة تستخدم نفس الحجز، حتى لو بدأ يوم جديد.</div>`;
}
async function studiesView() {
  const q = state.studyCursor
    ? "?cursor=" + encodeURIComponent(state.studyCursor)
    : "";
  const data = await api(
    `/v1/organizations/${state.org.id}/policy-observations${q}`,
  );
  return `${pageHead("راقب قبل ما تنفّذ", "قرارات افتراضية ومحاكاة تاريخية؛ لا تمنح إذن تنفيذ.", owner() ? btn(icon("flask") + " محاكاة سياسة", "simulate", "primary") : "")}<div class="notice">نتيجة ALLOW هنا ليست موافقة تنفيذ. المحاكاة لا تفحص الرصيد أو حالة المزوّد ولا تغيّر السياسة الفعلية.</div><section class="panel">${data.items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>الدراسة</th><th>النوع</th><th>السماح / المنع / الموافقة</th><th>التاريخ</th><th></th></tr></thead><tbody>${data.items.map((s) => `<tr><td><code>${e(shortId(s.id))}</code></td><td>${s.mode === "SIMULATE" ? "محاكاة تاريخية" : "مراقبة فعل"}</td><td><code>${e(s.summary?.allow ?? 0)} / ${e(s.summary?.deny ?? 0)} / ${e(s.summary?.requireApproval ?? 0)}</code></td><td>${e(date(s.createdAt))}</td><td>${btn("التفاصيل", "study", "compact", `data-id="${e(s.id)}"`)}</td></tr>`).join("")}</tbody></table></div>` : empty("لا توجد دراسات بعد", "استخدم «راقب فقط» في تجربة الفعل، أو حاكي سياسة على تنفيذات محفوظة.")}<div class="pager"><span>السجلات غير المنتهية فقط · صلاحية 30 يومًا</span><div class="row">${state.studyCursor ? btn("الأحدث", "study-first", "compact") : ""}${data.nextCursor ? btn("الأقدم", "study-next", "compact", `data-id="${e(data.nextCursor)}"`) : ""}</div></div></section>`;
}
function playgroundView() {
  const d = state.draft;
  return `${pageHead("جرّب فعلًا", "طلب حقيقي للـ API، وتنفيذ وهمي داخل Fake Commerce.")}<div class="two"><section class="panel stack"><div class="panel-title"><h2>إعداد الطلب</h2><code>refund.create</code></div><div class="key-state">${icon("key")}<span>${state.agent ? "وكيل متصل · " + e(shortId(state.agent.agentId)) : "لم يتم ربط مفتاح وكيل"}</span>${btn(state.agent ? "تغيير" : "ربط المفتاح", "bind-key", "ghost compact")}</div><form class="form" data-form="action">${field("معرّف الدفعة", "paymentId", `value="${e(d.paymentId)}" placeholder="payment_demo" dir="ltr" required maxlength="128" ${state.intent ? "disabled" : ""}`, "لازم الدفعة تكون متجهّزة في المعمل لنفس المؤسسة.")}${field("المبلغ بالدولار USD", "amount", `value="${e(d.amount)}" inputmode="decimal" dir="ltr" required ${state.intent ? "disabled" : ""}`, "مثال: 100.00 دولار = 10000 سنت. التحويل يتم تلقائيًا.")}${field("مفتاح منع التكرار", "idempotencyKey", `value="${e(d.key)}" dir="ltr" required maxlength="128" ${state.intent ? "disabled" : ""}`, "نفس المفتاح ونفس الطلب يرجّعان السجل نفسه.")}<div class="form-error" role="alert"></div><div class="row"><button type="submit" class="btn primary" name="mode" value="submit" ${!state.agent ? "disabled" : ""}>${icon("bolt")}${state.intent ? "إعادة إرسال نفس الطلب" : "إرسال الفعل"}</button><button type="submit" class="btn" name="mode" value="observe" ${!state.agent ? "disabled" : ""}>${icon("flask")}راقب فقط</button></div></form>${state.intent ? `<div class="notice">الطلب مثبت بمفتاحه في ذاكرة الصفحة. احتفظ بالمعرّف قبل إغلاقها، ولا تبدأ طلبًا جديدًا لو النتيجة غير مؤكدة.</div>${btn("نسخ المفتاح", "copy-intent", "compact")}${btn("بدء طلب جديد", "new-intent", "ghost compact")}` : ""}</section><section class="panel stack"><div><h2>النتيجة</h2><p class="small muted">رد السيرفر كما هو، بدون تغيير حالة التنفيذ من الواجهة.</p></div>${state.lastResult ? resultView(state.lastResult) : empty("النتيجة هتظهر هنا", "ابدأ بالمراقبة لو عايز تفهم قرار السياسة قبل إرسال الفعل.")}${state.lastObserved ? `<div class="result"><h3>آخر مراقبة — لم يُنفَّذ فعل</h3>${json(state.lastObserved)}</div>` : ""}</section></div>`;
}
function resultView(data) {
  return `<div class="result">${data.status ? badge(data.status) : data.decision ? badge(data.decision) : '<span class="pill warn">رد يحتاج مراجعة</span>'}${data.message ? `<p>${e(data.message)}</p>` : ""}${json(data)}<div class="row">${(data.id && !data.mode) || data.executionId ? btn("عرض التنفيذ", "execution", "compact", `data-id="${e(data.executionId || data.id)}"`) : ""}${data.approvalId ? btn("مراجعة الموافقة", "approval", "compact", `data-id="${e(data.approvalId)}"`) : ""}</div></div>`;
}
function helpView() {
  return `${pageHead("خلّيتك، خطوة بخطوة.", "ابدأ بتجربة صغيرة ومفهومة؛ البيانات هنا من سيرفرك الفعلي.")}<div class="two"><section class="panel"><div class="help-list"><div class="help-item"><div><h3>مؤسسة ووكيل</h3><p>أنشئ مؤسسة، ثم أضف وكيلًا باسم مثل refund-agent. استخدم «إصدار مفتاح» واحتفظ به خارج الريبو.</p>${btn("الوكلاء والمفاتيح", "nav", "ghost compact", 'data-page="agents"')}</div></div><div class="help-item"><div><h3>جهّز سياسة السيرفر</h3><p>السياسة الفعلية في POLICY_RULES_JSON. الافتراضي هو المنع. استخدم السكربت التالي لإنتاج قواعد تجريبية، وضع الناتج في .env ثم أعد تشغيل السيرفر.</p><pre>node scripts/print-demo-policy.mjs ${e(state.org.id)}</pre></div></div><div class="help-item"><div><h3>جهّز دفعة وهمية</h3><p>شغّل السكربت من نافذة تطوير متصلة بقاعدة البيانات الصحيحة ومعمل Fake Commerce مفعّل. القيمة 100000 تعني 1000 دولار.</p><pre>node scripts/seed-fake-payment.mjs ${e(state.org.id)} payment_console 100000</pre></div></div><div class="help-item"><div><h3>راقب، وافق، ثم نفّذ</h3><p>اربط مفتاح الوكيل في «جرّب فعلًا». لو طلب موافقة، راجعها كمالك، ثم استكمل التنفيذ من تفاصيله. القرار وحده لا يستدعي المزوّد.</p>${btn("تجربة الفعل", "nav", "primary compact", 'data-page="playground"')}</div></div></div></section><section class="panel stack"><h2>حدود واضحة، تجربة أوضح.</h2><div class="notice">لو NODE_ENV=production، التنفيذ الوهمي ممنوع. الواجهة لا تغيّر إعدادات السيرفر.</div><p>الجلسة ومفتاح الوكيل في ذاكرة الصفحة فقط، ولا يُحفظان في localStorage أو ملفات المتصفح. إعادة التحميل أو تسجيل الخروج يمسحهما.</p><p>المالك يراجع بيانات الطلب ويتخذ القرار. العضو يتابع ملخصات آمنة بدون arguments أو result.</p><p>كل تنفيذ يظل خاضعًا لسياسات الباك إند والموافقة والحجز والميزانية. إخفاء زر في الواجهة ليس صلاحية أمنية.</p><div class="separator"></div><h3>مرجع المؤسسة</h3><div class="code-row"><code>${e(state.org.id)}</code>${btn(icon("copy"), "copy-org", "ghost compact", 'aria-label="نسخ معرف المؤسسة"')}</div><p class="small muted">صفحة الإعداد الحالية لا تغيّر السياسات أو الميزانيات، ولا تضيف مزوّد دفع حقيقي.</p></section></div>`;
}
async function openExecution(id) {
  const x = await api(url("executions/" + encodeURIComponent(id)));
  const bound = state.agent?.agentId === x.agentId;
  const canResume =
    x.status === "RECEIVED" && x.approval?.status === "APPROVED";
  const uncertain = ["EXECUTING", "OUTCOME_UNKNOWN"].includes(x.status);
  modal(
    "تفاصيل التنفيذ",
    `<div class="row between"><code>${e(x.actionName)}</code>${badge(x.status)}</div><div class="code-row"><code>${e(x.id)}</code>${btn(icon("copy"), "copy-text", "ghost compact", `data-text="${e(x.id)}" aria-label="نسخ معرف التنفيذ"`)}</div><div class="detail-grid"><div><span>الوكيل</span><strong class="mono">${e(x.agent.name)}</strong></div><div><span>البيئة</span><strong>${e(x.environment)}</strong></div><div><span>قرار السياسة الأصلي</span>${x.policyDecision ? badge(x.policyDecision) : "غير محفوظ"}</div><div><span>سبب القرار</span><code>${e(x.policyReason || "—")}</code></div><div><span>الاستلام</span><strong>${e(date(x.requestedAt))}</strong></div><div><span>آخر تحديث</span><strong>${e(date(x.updatedAt))}</strong></div></div>${x.errorCode ? `<div class="notice error"><code>${e(x.errorCode)}</code></div>` : ""}${x.blockedPolicyDecision ? `<div class="notice">تشديد لاحق للسياسة: ${badge(x.blockedPolicyDecision)} · ${e(date(x.blockedAt))}</div>` : ""}${x.approval ? `<div class="row between"><span>الموافقة ${badge(x.approval.status)}</span>${btn("عرض الموافقة", "approval", "compact", `data-id="${e(x.approval.id)}"`)}</div>` : ""}${owner() ? `<div><h3>البيانات المحفوظة</h3>${json({ arguments: x.arguments, result: x.result, resourceType: x.resourceType, resourceId: x.resourceId })}</div>` : '<div class="notice">عرض MEMBER: ملخص بدون بيانات الطلب والنتيجة الحساسة.</div>'}<div><h3>محاولات التنفيذ</h3>${x.attempts.length ? `<div class="timeline">${x.attempts.map((a) => `<div><div class="row"><b>المحاولة ${a.attemptNumber}</b>${badge(a.status)}</div><small>${e(date(a.startedAt))}</small>${a.resolvedStatus ? `<p class="small">تم تأكيد النتيجة: ${badge(a.resolvedStatus)}</p>` : ""}${a.errorCode ? `<code>${e(a.errorCode)}</code>` : ""}</div>`).join("")}</div>` : '<p class="muted small">لم يبدأ استدعاء المزوّد.</p>'}</div>${uncertain ? '<div class="notice">عدم وصول رد لا يعني عدم التنفيذ. ابدأ بالتحقق من النتيجة. السيرفر يحدد أهلية إعادة المحاولة.</div>' : ""}<div class="row">${canResume && bound ? btn("استكمال التنفيذ", "execution-op", "primary", `data-id="${e(x.id)}" data-op="resume"`) : ""}${uncertain && (owner() || bound) ? btn("التحقق من النتيجة", "execution-op", "", `data-id="${e(x.id)}" data-op="reconcile"`) : ""}${x.status === "OUTCOME_UNKNOWN" && bound && x.attemptCount < 3 ? btn("طلب إعادة محاولة آمنة", "execution-op", "", `data-id="${e(x.id)}" data-op="retry"`) : ""}${btn("تحديث", "execution", "ghost", `data-id="${e(x.id)}"`)}</div>${(canResume || uncertain) && !bound ? '<p class="small muted">لاستكمال أو إعادة محاولة التنفيذ، اربط مفتاح نفس الوكيل في صفحة «جرّب فعلًا».</p>' : ""}`,
  );
}
async function openApproval(id) {
  const a = await api("/v1/approvals/" + encodeURIComponent(id));
  modal(
    "مراجعة الموافقة",
    `<div class="row between"><code>${e(a.actionName)}</code>${badge(a.status)}</div><div class="detail-grid"><div><span>معرّف الموافقة</span><code>${e(a.id)}</code></div><div><span>وقت الاستلام</span>${e(date(a.createdAt))}</div><div><span>حالة التنفيذ</span>${badge(a.executionStatus)}</div><div><span>وقت القرار</span>${e(date(a.decidedAt))}</div></div>${a.request ? `<div class="notice">راجع القيم التالية. القرار مرتبط بهذه البيانات المحفوظة، ولا يمكن تغييره بعد تسجيله.</div>${a.request.action.name === "refund.create" ? `<div class="row"><strong class="ltr">${money(a.request.arguments.amountMinor)}</strong><code>${e(a.request.arguments.paymentId)}</code></div>` : ""}${json(a.request)}` : '<div class="notice">تفاصيل الفعل متاحة للمالك فقط.</div>'}${a.status === "PENDING" && owner() && a.request ? `<form data-form="decision" data-id="${e(a.id)}" class="form"><label class="checkline"><input type="checkbox" required>راجعت الفعل والقيم والمؤسسة. أعرف أن القرار نهائي وأن الموافقة لا تنفّذ الفعل تلقائيًا.</label><div class="form-error" role="alert"></div><div class="row"><button class="btn primary" name="decision" value="APPROVED" type="submit">موافقة على الفعل</button><button class="btn danger" name="decision" value="REJECTED" type="submit">رفض الفعل</button></div></form>` : ""}${btn("عرض التنفيذ المرتبط", "execution", "ghost", `data-id="${e(a.executionId)}"`)}`,
  );
}
function bindModal() {
  modal(
    "ربط مفتاح وكيل",
    `<p>المفتاح يبقى في ذاكرة الصفحة فقط. هنتحقق إن الوكيل تابع للمؤسسة الحالية قبل أي فعل.</p><form class="form" data-form="bind">${field("API key", "key", 'type="password" autocomplete="off" spellcheck="false" required dir="ltr" placeholder="agt_live_…"')}<div class="form-error" role="alert"></div><button class="btn primary" type="submit">تحقق واربط الوكيل</button></form>${state.agent ? btn("فصل المفتاح الحالي", "unbind", "ghost") : ""}`,
  );
}
async function bindKey(key) {
  const identity = await api("/v1/console-agent/identity", { key });
  if (identity.organizationId !== state.org.id)
    throw new Error(
      "المفتاح تابع لمؤسسة أخرى. اختَر المؤسسة الصحيحة أو استخدم مفتاحًا تابعًا للمؤسسة الحالية.",
    );
  if (state.intent && identity.agentId !== state.intentAgentId)
    throw new Error(
      "الطلب المثبت مرتبط بوكيل آخر. اربط نفس الوكيل أو راجع نتيجته قبل بدء طلب جديد.",
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
      "إنشاء مؤسسة",
      `<p class="muted">مساحة مستقلة لوكلائك وسياساتك وتنفيذاتك. هتكون مالك المؤسسة الجديدة.</p><form class="form" data-form="organization">${field("اسم المؤسسة", "name", 'required maxlength="120" placeholder="مثال: فريق المتجر"')}<div class="form-error" role="alert"></div><button class="btn primary" type="submit">إنشاء المؤسسة</button></form>`,
    );
    return;
  }
  if (act === "new-agent") {
    modal(
      "إضافة وكيل",
      `<form class="form" data-form="agent">${field("اسم الوكيل", "name", 'required maxlength="100" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" dir="ltr" placeholder="refund-agent"', "حروف إنجليزية صغيرة وأرقام وشرطات منفردة.")}<div class="form-error" role="alert"></div><button class="btn primary" type="submit">إضافة الوكيل</button></form>`,
    );
    return;
  }
  if (act === "issue-key") {
    if (
      !confirm(
        `إصدار مفتاح جديد للوكيل ${target.dataset.name}؟ المفتاح يمنح هوية الوكيل، وهيظهر مرة واحدة.`,
      )
    )
      return;
    const data = await api(`/agents/${target.dataset.id}/credentials`, {
      method: "POST",
      body: { organizationId: state.org.id },
    });
    generatedKey = data.apiKey;
    modal(
      "احتفظ بمفتاح الوكيل",
      `<div class="notice">المفتاح يُعرض مرة واحدة. احفظه في مدير أسرار، ومتشاركوش في الصور أو الريبو. إصدار مفتاح جديد لا يلغي المفاتيح القديمة.</div><label class="field">المفتاح الجديد<textarea id="issued-key" class="secret" readonly aria-label="المفتاح الجديد" spellcheck="false"></textarea></label><div class="row">${btn("نسخ المفتاح", "copy-key", "primary")}${btn("استخدامه في تجربة الفعل", "use-key", "")}</div><p class="small muted">إغلاق النافذة يمسح نسخة العرض. لو ربطته بالتجربة، يحتفظ به التطبيق في الذاكرة حتى الخروج.</p>`,
    );
    document.querySelector("#issued-key").value = data.apiKey;
    return;
  }
  if (act === "copy-key") {
    await navigator.clipboard.writeText(generatedKey);
    notify("تم نسخ المفتاح. احتفظ به بأمان.");
    return;
  }
  if (act === "use-key") {
    await bindKey(generatedKey);
    closeDialog();
    await navigate("playground");
    notify("تم ربط الوكيل بالمؤسسة الحالية.");
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
          ? "هتطلب إعادة محاولة لنفس التنفيذ ونفس مفتاح المزوّد. السيرفر هيفحص الأهلية والسياسة والميزانية. نكمل؟"
          : "استكمال تنفيذ الفعل المحفوظ بعد التحقق من الموافقة والسياسة والميزانية؟",
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
    notify("تم تحديث حالة التنفيذ.");
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
      "تفاصيل الدراسة",
      `<div class="notice">دراسة فقط. لا تنفيذ ولا تصريح تنفيذ.</div>${json(data)}`,
    );
    return;
  }
  if (act === "simulate") {
    modal(
      "محاكاة سياسة على التاريخ",
      `<p>اختَر حتى 100 معرّف تنفيذ من المؤسسة الحالية. القواعد المقترحة لا تستبدل سياسة السيرفر.</p><form class="form" data-form="simulation"><label class="field">معرّفات التنفيذات، معرّف في كل سطر<textarea name="ids" required dir="ltr" placeholder="execution UUID"></textarea></label><label class="field">القواعد المقترحة — JSON بدون organizationId<textarea name="policies" required dir="ltr" spellcheck="false">[]</textarea><small>قائمة فارغة تعني المنع الافتراضي. راجع صيغة السياسة في توثيق المشروع.</small></label><div class="form-error" role="alert"></div><button class="btn primary" type="submit">تشغيل المحاكاة فقط</button></form>`,
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
    notify("تم النسخ.");
    return;
  }
  if (act === "new-intent") {
    if (
      !confirm(
        "طلب جديد بمفتاح جديد قد ينفّذ أثرًا جديدًا. متبدأش طلبًا جديدًا لو نتيجة الطلب السابق غير مؤكدة. هل تريد المتابعة؟",
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
      () => logout("انتهت جلسة الدخول. سجّل الدخول من جديد."),
      Math.min(session.expiresIn, 3600) * 1000,
    );
    try {
      await loadWorkspaces();
      await navigate("overview");
    } catch (error) {
      if (error instanceof StaleRequest) return;
      logout("تم الدخول لكن تعذر تحميل المؤسسات. حاول تسجيل الدخول مرة أخرى.");
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
    notify("مؤسستك جاهزة. أضف أول وكيل.");
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
    notify("تمت إضافة الوكيل.");
    return;
  }
  if (name === "bind") {
    await bindKey(data.get("key").trim());
    form.reset();
    closeDialog();
    await navigate();
    notify("تم التحقق من المفتاح وربطه.");
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
    notify("تم تسجيل القرار. الموافقة لا تنفّذ الفعل تلقائيًا.");
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
        `<section class="panel"><div class="panel-title"><h2>المتاح للاسترداد</h2><span class="pill">${e(x.environment)} · USD</span></div><div class="budget-amount ltr">${money(x.availableMinor)}</div><p class="muted">من إجمالي ${money(x.limitMinor)} · ${e(String(x.day).slice(0, 10))} UTC</p><progress max="${Math.max(x.limitMinor, 1)}" value="${x.reservedMinor + x.consumedMinor}" aria-label="السعة المحجوزة والمستهلكة"></progress><div class="metric-list"><div><span>مستهلك — نتائج مؤكدة</span><b class="ltr">${money(x.consumedMinor)}</b></div><div><span>محجوز — لم يُسوَّ بعد</span><b class="ltr">${money(x.reservedMinor)}</b></div><div><span>متاح</span><b class="ltr">${money(x.availableMinor)}</b></div></div></section>`;
    } catch (error) {
      if (error.status === 404) {
        document.querySelector("#budget-result").innerHTML = empty(
          "لا يوجد سجل ميزانية لهذا اليوم",
          "لم يُفتح bucket لهذا النطاق. لا نفترض أن الميزانية صفر أو أنها غير محدودة.",
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
      throw new Error("صيغة JSON للقواعد غير صحيحة.");
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
      "نتيجة المحاكاة",
      `<div class="notice">لا تغيّر هذه النتيجة صلاحية أي تنفيذ.</div>${json(result)}`,
    );
    return;
  }
  if (name === "action") {
    if (!state.agent) throw new Error("اربط مفتاح وكيل أولًا.");
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
          `إرسال طلب استرداد تجريبي بقيمة ${money(body.arguments.amountMinor)} للدفعة ${body.arguments.paymentId}؟`,
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
