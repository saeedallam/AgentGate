// Rendering only; API calls retain the shared session and stale-response checks.
export default function create(context) {
  const { e, labels, api, url, btn, pageHead, executionTable } = context;
  return async function executionsView() {
    const state = context.getState();
    const q = new URLSearchParams();
    if (state.filter) q.set("status", state.filter);
    if (state.cursor) q.set("cursor", state.cursor);
    const data = await api(url("executions") + "?" + q);
    return `${pageHead("Executions", "Follow the decision, attempts and outcome in one record.")}<section class="panel">
<div class="panel-title">
<h2>Action history</h2>
<select id="execution-filter" class="control" aria-label="Filter by status">
<option value="">All statuses</option>${["RECEIVED", "EXECUTING", "SUCCEEDED", "FAILED", "DENIED", "OUTCOME_UNKNOWN"].map((s) => `<option value="${s}" ${state.filter === s ? "selected" : ""}>${labels[s]}</option>`).join("")}</select>
</div>${executionTable(data.items)}<div class="pager">
<span>Up to 25 requests per page</span>
<div class="row">${state.cursor ? btn("Newest", "exec-first", "compact") : ""}${data.nextCursor ? btn("Older", "exec-next", "compact", `data-id="${e(data.nextCursor)}"`) : ""}</div>
</div>
</section>`;
  };
}
