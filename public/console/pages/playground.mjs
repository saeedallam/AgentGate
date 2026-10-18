// Rendering only; API calls retain the shared session and stale-response checks.
export default function create(context) {
  const { e, shortId, btn, empty, pageHead, json, field, icon, resultView } =
    context;
  return function playgroundView() {
    const state = context.getState();
    const d = state.draft;
    return `${pageHead("Action playground", "Real API requests. Simulated effects inside Fake Commerce.")}<div class="two">
<section class="panel stack">
<div class="panel-title">
<h2>Propose an action</h2>
<code>refund.create</code>
</div>
<div class="key-state">${icon("key")}<span>${state.agent ? "Agent connected · " + e(shortId(state.agent.agentId)) : "No agent key connected"}</span>${btn(state.agent ? "Change" : "Connect key", "bind-key", "ghost compact")}</div>
<form class="form" data-form="action">${field("Payment ID", "paymentId", `value="${e(d.paymentId)}" placeholder="payment_demo" dir="ltr" required maxlength="128" ${state.intent ? "disabled" : ""}`, "Prepare this payment in the lab for the same organization first.")}${field("Amount (USD)", "amount", `value="${e(d.amount)}" inputmode="decimal" dir="ltr" required ${state.intent ? "disabled" : ""}`, "Example: $100.00 = 10000 cents. Conversion is automatic.")}${field("Idempotency key", "idempotencyKey", `value="${e(d.key)}" dir="ltr" required maxlength="128" ${state.intent ? "disabled" : ""}`, "The same key and payload return the same execution record.")}<div class="form-error" role="alert">
</div>
<div class="row">
<button type="submit" class="btn primary" name="mode" value="submit" ${!state.agent ? "disabled" : ""}>${icon("bolt")}${state.intent ? "Resend the same request" : "Submit action"}</button>
<button type="submit" class="btn" name="mode" value="observe" ${!state.agent ? "disabled" : ""}>${icon("flask")}Observe only</button>
</div>
</form>${state.intent ? `<div class="notice">This page keeps the request and its key in memory. Save its ID before closing. Do not start a new request if the outcome is uncertain.</div>${btn("Copy key", "copy-intent", "compact")}${btn("Start a new request", "new-intent", "ghost compact")}` : ""}</section>
<section class="panel stack">
<div>
<h2>Gate response</h2>
<p class="small muted">The server response, without changing execution state in the browser.</p>
</div>${state.lastResult ? resultView(state.lastResult) : empty("Ready when you are.", "Start with observation to understand the policy decision before submitting an action.")}${
      state.lastObserved
        ? `<div class="result">
<h3>Latest observation — no action executed</h3>${json(state.lastObserved)}</div>`
        : ""
    }</section>
</div>`;
  };
}
