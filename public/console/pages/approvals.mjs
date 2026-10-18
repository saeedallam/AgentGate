// Rendering only; API calls retain the shared session and stale-response checks.
export default function create(context) {
  const { e, shortId, api, owner, btn, badge, empty, pageHead, date } = context;
  return async function approvalsView() {
    const state = context.getState();
    const data = await api(
      "/v1/approvals?" +
        new URLSearchParams({
          organizationId: state.org.id,
          limit: "20",
          offset: String(state.approvalOffset),
        }),
    );
    return `${pageHead("Approvals", "Review the stored action before deciding. Approval alone does not execute it.")}<div class="notice">${owner() ? "Approval and rejection decisions are final. Open the request and review its values before deciding." : "MEMBER access includes summaries only. Request details and decisions are restricted to the owner."}</div>
<section class="panel">${
      data.items.length
        ? `<div class="table-wrap">
<table class="table">
<thead>
<tr>
<th>Action</th>
<th>Approval status</th>
<th>Execution status</th>
<th>Requested</th>
<th>
</th>
</tr>
</thead>
<tbody>${data.items
            .map(
              (a) => `<tr>
<td>
<code>${e(a.actionName)}</code>
<small class="mono">${e(shortId(a.id))}</small>
</td>
<td>${badge(a.expired ? "EXPIRED" : a.status)}</td>
<td>${badge(a.executionStatus)}</td>
<td>${e(date(a.createdAt))}</td>
<td>${btn(owner() ? "Review request" : "View summary", "approval", "compact", `data-id="${e(a.id)}"`)}</td>
</tr>`,
            )
            .join("")}</tbody>
</table>
</div>`
        : empty(
            "No approvals yet",
            "Requests that need a human decision will appear here.",
          )
    }<div class="pager">
<span>Newest first</span>
<div class="row">${state.approvalOffset ? btn("Previous", "approval-prev", "compact") : ""}${data.items.length === 20 && state.approvalOffset < 10000 ? btn("Next", "approval-next", "compact") : ""}</div>
</div>
</section>`;
  };
}
