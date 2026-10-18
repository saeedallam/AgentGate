// Rendering only; API calls retain the shared session and stale-response checks.
export default function create(context) {
  const { e, labels, api, url, btn, pageHead, icon, executionTable, hiveArt } =
    context;
  return async function overviewView() {
    const state = context.getState();
    const data = await api(url("overview"));
    state.overview = data;
    const stat = (title, value, sub, ic) =>
      `<article class="stat">
<div class="stat-top">${title}<span class="stat-icon">${icon(ic)}</span>
</div>
<div class="number">${e(String(value).padStart(2, "0"))}</div>
<span class="small muted">${sub}</span>
</article>`;
    return `${pageHead("Your hive, under control.", "A clear view of what your agents are doing — and what they are allowed to do.", btn("+ Try an action", "nav", "primary", 'data-page="playground"'))}
    <section class="hero">
<div class="hero-copy">
<div class="eyebrow">The control layer for your agents</div>
<h2>Let agents do the work.<br>
<em>You set the boundaries.</em>
</h2>
<p>Every action meets your policies before it reaches execution.<br>Explore the gate. See every decision.</p>${btn("Open the playground ↗", "nav", "hero-button", 'data-page="playground"')}</div>${hiveArt()}</section>
    <section class="stats">${stat("Total requests", data.totalExecutions, "Across your workspace · all time", "bolt")}${stat("Awaiting approval", data.pendingApprovals, "Waiting for a human decision", "shield")}${stat("Active agents", data.activeAgents, "Out of " + data.agents + (data.agents === 1 ? " agent" : " agents"), "agents")}${stat("Uncertain outcomes", data.counts.OUTCOME_UNKNOWN || 0, "Check before attempting again", "clock")}</section>
    <div class="overview-columns">
<section class="panel">
<div class="panel-title">
<div>
<h2>Recent executions</h2>
<p class="small muted">The latest activity across your hive</p>
</div>${btn("View all ↗", "nav", "ghost compact", 'data-page="executions"')}</div>${executionTable(data.recent)}</section>
    <section class="panel">
<div class="panel-title">
<h2>Execution breakdown</h2>
<span class="small muted">ALL TIME</span>
</div>
<p class="small muted">Recorded execution outcomes</p>${[
      "SUCCEEDED",
      "RECEIVED",
      "EXECUTING",
      "DENIED",
      "FAILED",
      "OUTCOME_UNKNOWN",
    ]
      .map(
        (status) => `<div class="bar-row">
<span>${e(labels[status])}</span>
<progress max="${Math.max(data.totalExecutions, 1)}" value="${data.counts[status] || 0}" aria-label="${e(labels[status])}">
</progress>
<b>${data.counts[status] || 0}</b>
</div>`,
      )
      .join("")}</section>
</div>
    <div class="guide-card">
<div class="row">
<img src="/console/logo.svg" alt="">
<div>
<h3>From your first agent to your first action.</h3>
<p>A short guide to a complete workflow without Postman.</p>
</div>
</div>${btn("Getting started ↗", "nav", "", 'data-page="help"')}</div>
    <div class="console-footer">
<span>${e(state.org.name)} · ${e(data.environment)}</span>
<span>${data.fakeExecutionEnabled ? "Fake Commerce enabled · effects are simulated" : "Fake execution disabled"} · Connected backend</span>
</div>`;
  };
}
