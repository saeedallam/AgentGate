// Rendering only; API calls retain the shared session and stale-response checks.
export default function create(context) {
  const { empty, pageHead, field } = context;
  return function budgetView() {
    const state = context.getState();
    return `${pageHead("Refund budget", "Daily workspace capacity, scoped to the UTC day execution first starts.")}<section class="panel">
<form data-form="budget" class="row">${field("Day — UTC", "day", `type="date" value="${new Date().toISOString().slice(0, 10)}" required`)}<label class="field">Environment<select name="environment">${["development", "staging", "production"].map((x) => `<option ${state.overview?.environment === x ? "selected" : ""}>${x}</option>`).join("")}</select>
</label>
<button class="btn primary" type="submit">View budget</button>
<div class="form-error" role="alert">
</div>
</form>
</section>
<div id="budget-result">${empty("Choose a day and environment", "A budget record appears after the first reservation in an enabled scope. No record does not mean zero capacity.")}</div>
<div class="notice">Uncertain outcomes retain their reservation. Retries reuse it, even after a new day begins.</div>`;
  };
}
