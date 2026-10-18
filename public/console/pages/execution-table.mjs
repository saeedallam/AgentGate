// Rendering only; API calls retain the shared session and stale-response checks.
export default function create(context) {
  const { e, shortId, btn, badge, empty, date } = context;
  return function executionTable(items) {
    return items.length
      ? `<div class="table-wrap">
<table class="table">
<thead>
<tr>
<th>Action / execution</th>
<th>Agent</th>
<th>Status</th>
<th>Policy</th>
<th>Time</th>
</tr>
</thead>
<tbody>${items
          .map(
            (x) => `<tr>
<td>
<button class="link mono" type="button" data-act="execution" data-id="${e(x.id)}">${e(x.actionName)}</button>
<small class="mono">${e(shortId(x.id))}</small>
</td>
<td>
<code>${e(x.agent?.name || shortId(x.agentId))}</code>
</td>
<td>${badge(x.status)}</td>
<td>${x.policyDecision ? badge(x.policyDecision) : '<span class="muted">No policy snapshot</span>'}</td>
<td>${e(date(x.createdAt))}</td>
</tr>`,
          )
          .join("")}</tbody>
</table>
</div>`
      : empty(
          "No executions yet",
          "Your first AgentGate request will appear here with its actual outcome.",
          btn("Action playground", "nav", "primary", 'data-page="playground"'),
        );
  };
}
