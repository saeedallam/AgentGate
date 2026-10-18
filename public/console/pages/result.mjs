// Rendering only; API calls retain the shared session and stale-response checks.
export default function create(context) {
  const { e, btn, badge, json } = context;
  return function resultView(data) {
    return `<div class="result">${data.status ? badge(data.status) : data.decision ? badge(data.decision) : '<span class="pill warn">Response needs review</span>'}${data.message ? `<p>${e(data.message)}</p>` : ""}${json(data)}<div class="row">${(data.id && !data.mode) || data.executionId ? btn("View execution", "execution", "compact", `data-id="${e(data.executionId || data.id)}"`) : ""}${data.approvalId ? btn("Review approval", "approval", "compact", `data-id="${e(data.approvalId)}"`) : ""}</div>
</div>`;
  };
}
