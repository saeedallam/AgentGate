// Rendering only; API calls retain the shared session and stale-response checks.
export default function create(context) {
  const { modal, e, money, api, owner, btn, badge, json, date } = context;
  return async function openApproval(id) {
    const a = await api("/v1/approvals/" + encodeURIComponent(id));
    modal(
      "Review approval",
      `<div class="row between">
<code>${e(a.actionName)}</code>${badge(a.expired ? "EXPIRED" : a.status)}</div>
<div class="detail-grid">
<div>
<span>Approval ID</span>
<code>${e(a.id)}</code>
</div>
<div>
<span>Received at</span>${e(date(a.createdAt))}</div>
<div>
<span>Execution status</span>${badge(a.executionStatus)}</div>
<div>
<span>Expires at</span>${e(date(a.expiresAt))}${a.expired ? " — Expired" : ""}</div><div><span>Decided at</span>${e(date(a.decidedAt))}</div>
</div>${
        a.request
          ? `<div class="notice">Review these values. Your decision binds to this stored action and cannot change once recorded.</div>${
              a.request.action.name === "refund.create"
                ? `<div class="row">
<strong class="ltr">${money(a.request.arguments.amountMinor)}</strong>
<code>${e(a.request.arguments.paymentId)}</code>
</div>`
                : ""
            }${json(a.request)}`
          : '<div class="notice">Action details are available to the owner only.</div>'
      }${
        a.status === "PENDING" && !a.expired && owner() && a.request
          ? `<form data-form="decision" data-id="${e(a.id)}" class="form">
<label class="checkline">
<input type="checkbox" required>I reviewed the action, values and organization. I understand the decision is final and approval does not execute the action automatically.</label>
<div class="form-error" role="alert">
</div>
<div class="row">
<button class="btn primary" name="decision" value="APPROVED" type="submit">Approve action</button>
<button class="btn danger" name="decision" value="REJECTED" type="submit">Reject action</button>
</div>
</form>`
          : ""
      }${btn("View linked execution", "execution", "ghost", `data-id="${e(a.executionId)}"`)}`,
    );
  };
}
