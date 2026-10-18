// Rendering only; API calls retain the shared session and stale-response checks.
export default function create(context) {
  const { e, shortId, api, owner, btn, empty, pageHead, date, icon } = context;
  return async function studiesView() {
    const state = context.getState();
    const q = state.studyCursor
      ? "?cursor=" + encodeURIComponent(state.studyCursor)
      : "";
    const data = await api(
      `/v1/organizations/${state.org.id}/policy-observations${q}`,
    );
    return `${pageHead("Observe before you execute", "Hypothetical decisions and historical simulations do not authorize execution.", owner() ? btn(icon("flask") + " Simulate policy", "simulate", "primary") : "")}<div class="notice">ALLOW here is not execution approval. Simulation does not check budget or provider state and does not change the active policy.</div>
<section class="panel">${
      data.items.length
        ? `<div class="table-wrap">
<table class="table">
<thead>
<tr>
<th>Study</th>
<th>Type</th>
<th>Allow / deny / approval</th>
<th>Date</th>
<th>
</th>
</tr>
</thead>
<tbody>${data.items
            .map(
              (s) => `<tr>
<td>
<code>${e(shortId(s.id))}</code>
</td>
<td>${s.mode === "SIMULATE" ? "Historical simulation" : "Action observation"}</td>
<td>
<code>${e(s.summary?.allow ?? 0)} / ${e(s.summary?.deny ?? 0)} / ${e(s.summary?.requireApproval ?? 0)}</code>
</td>
<td>${e(date(s.createdAt))}</td>
<td>${btn("Details", "study", "compact", `data-id="${e(s.id)}"`)}</td>
</tr>`,
            )
            .join("")}</tbody>
</table>
</div>`
        : empty(
            "No studies yet",
            "Use Observe only in the playground, or simulate a policy against stored executions.",
          )
    }<div class="pager">
<span>Unexpired records only · 30-day retention</span>
<div class="row">${state.studyCursor ? btn("Newest", "study-first", "compact") : ""}${data.nextCursor ? btn("Older", "study-next", "compact", `data-id="${e(data.nextCursor)}"`) : ""}</div>
</div>
</section>`;
  };
}
