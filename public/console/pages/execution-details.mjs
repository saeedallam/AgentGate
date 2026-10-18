// Rendering only; API calls retain the shared session and stale-response checks.
export default function create(context) {
  const { modal, e, api, url, owner, btn, badge, json, date, icon } = context;
  return async function openExecution(id) {
    const state = context.getState();
    const x = await api(url("executions/" + encodeURIComponent(id)));
    const bound = state.agent?.agentId === x.agentId;
    const canResume =
      x.status === "RECEIVED" && x.approval?.status === "APPROVED";
    const uncertain = ["EXECUTING", "OUTCOME_UNKNOWN"].includes(x.status);
    modal(
      "Execution details",
      `<div class="row between">
<code>${e(x.actionName)}</code>${badge(x.status)}</div>
<div class="code-row">
<code>${e(x.id)}</code>${btn(icon("copy"), "copy-text", "ghost compact", `data-text="${e(x.id)}" aria-label="Copy execution ID"`)}</div>
<div class="detail-grid">
<div>
<span>Agent</span>
<strong class="mono">${e(x.agent.name)}</strong>
</div>
<div>
<span>Environment</span>
<strong>${e(x.environment)}</strong>
</div>
<div>
<span>Original policy decision</span>${x.policyDecision ? badge(x.policyDecision) : "Not recorded"}</div>
<div>
<span>Decision reason</span>
<code>${e(x.policyReason || "—")}</code>
</div>
<div>
<span>Received</span>
<strong>${e(date(x.requestedAt))}</strong>
</div>
<div>
<span>Last updated</span>
<strong>${e(date(x.updatedAt))}</strong>
</div>
</div>${
        x.errorCode
          ? `<div class="notice error">
<code>${e(x.errorCode)}</code>
</div>`
          : ""
      }${x.blockedPolicyDecision ? `<div class="notice">Policy tightened later: ${badge(x.blockedPolicyDecision)} · ${e(date(x.blockedAt))}</div>` : ""}${
        x.approval
          ? `<div class="row between">
<span>Approval ${badge(x.approval.status)}</span>${btn("View approval", "approval", "compact", `data-id="${e(x.approval.id)}"`)}</div>`
          : ""
      }${
        owner()
          ? `<div>
<h3>Stored data</h3>${json({ arguments: x.arguments, result: x.result, resourceType: x.resourceType, resourceId: x.resourceId })}</div>`
          : '<div class="notice">MEMBER view: a summary without sensitive request or result data.</div>'
      }<div>
<h3>Execution attempts</h3>${
        x.attempts.length
          ? `<div class="timeline">${x.attempts
              .map(
                (a) => `<div>
<div class="row">
<b>Attempt ${a.attemptNumber}</b>${badge(a.status)}</div>
<small>${e(date(a.startedAt))}</small>${a.resolvedStatus ? `<p class="small">Outcome confirmed: ${badge(a.resolvedStatus)}</p>` : ""}${a.errorCode ? `<code>${e(a.errorCode)}</code>` : ""}</div>`,
              )
              .join("")}</div>`
          : '<p class="muted small">The provider has not been called.</p>'
      }</div>${uncertain ? '<div class="notice">A missing response does not prove non-execution. Start by checking the outcome. The server determines retry eligibility.</div>' : ""}<div class="row">${canResume && bound ? btn("Resume execution", "execution-op", "primary", `data-id="${e(x.id)}" data-op="resume"`) : ""}${uncertain && (owner() || bound) ? btn("Check outcome", "execution-op", "", `data-id="${e(x.id)}" data-op="reconcile"`) : ""}${x.status === "OUTCOME_UNKNOWN" && bound && x.attemptCount < 3 ? btn("Request a safe retry", "execution-op", "", `data-id="${e(x.id)}" data-op="retry"`) : ""}${btn("Refresh", "execution", "ghost", `data-id="${e(x.id)}"`)}</div>${(canResume || uncertain) && !bound ? '<p class="small muted">To resume or retry, connect a key for the same agent in the playground.</p>' : ""}`,
    );
  };
}
