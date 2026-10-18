// Rendering only; API calls retain the shared session and stale-response checks.
export default function create(context) {
  const { e, api, owner, btn, badge, empty, pageHead, date, icon } = context;
  return async function agentsView() {
    const state = context.getState();
    const data = await api(
      "/agents?" +
        new URLSearchParams({
          organizationId: state.org.id,
          limit: "20",
          offset: String(state.agentOffset),
        }),
    );
    return `${pageHead("Agents & keys", "Distinct agent identities. New keys are shown only once.", owner() ? btn(icon("plus") + " Add agent", "new-agent", "primary") : "")}<section class="panel">${
      data.items.length
        ? `<div class="table-wrap">
<table class="table">
<thead>
<tr>
<th>Agent</th>
<th>Status</th>
<th>Created</th>
<th>Key management</th>
</tr>
</thead>
<tbody>${data.items
            .map(
              (a) => `<tr>
<td>
<strong class="mono">${e(a.name)}</strong>
<small class="mono">${e(a.id)}</small>
</td>
<td>${badge(a.status)}</td>
<td>${e(date(a.createdAt))}</td>
<td>${owner() ? btn(icon("key") + " Issue key", "issue-key", "compact", `data-id="${e(a.id)}" data-name="${e(a.name)}"`) : '<span class="muted">Owner access only</span>'}</td>
</tr>`,
            )
            .join("")}</tbody>
</table>
</div>`
        : empty(
            "Add your first agent",
            "Use a clear name such as refund-agent to identify its requests.",
            owner() ? btn("Add agent", "new-agent", "primary") : "",
          )
    }<div class="pager">
<span>20 agents per page</span>
<div class="row">${state.agentOffset ? btn("Previous", "agent-prev", "compact") : ""}${data.hasMore ? btn("Next", "agent-next", "compact") : ""}</div>
</div>
</section>
<p class="footer-note">Agent suspension and key revocation are not available in this console release.</p>`;
  };
}
