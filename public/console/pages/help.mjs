// Rendering only; API calls retain the shared session and stale-response checks.
export default function create(context) {
  const { e, btn, pageHead, icon } = context;
  return function helpView() {
    const state = context.getState();
    return `${pageHead("Your hive, step by step.", "Start with a small, understandable experiment using your actual server data.")}<div class="two">
<section class="panel">
<div class="help-list">
<div class="help-item">
<div>
<h3>A workspace and an agent</h3>
<p>Create a workspace, then add an agent such as refund-agent. Select Issue key and keep the secret outside your repository.</p>${btn("Agents & keys", "nav", "ghost compact", 'data-page="agents"')}</div>
</div>
<div class="help-item">
<div>
<h3>Prepare the server policy</h3>
<p>The active policy is configured in POLICY_RULES_JSON. The default is deny. Run this script to generate sample rules, put the output in .env, then restart the server.</p>
<pre>node scripts/print-demo-policy.mjs ${e(state.org.id)}</pre>
</div>
</div>
<div class="help-item">
<div>
<h3>Prepare a fake payment</h3>
<p>Run this script in a development terminal connected to the correct database with Fake Commerce enabled. The value 100000 means $1000.</p>
<pre>node scripts/seed-fake-payment.mjs ${e(state.org.id)} payment_console 100000</pre>
</div>
</div>
<div class="help-item">
<div>
<h3>Observe, approve, then execute</h3>
<p>Connect an agent key in the playground. If approval is required, review it as owner, then resume from execution details. The decision alone does not call the provider.</p>${btn("Try an action", "nav", "primary compact", 'data-page="playground"')}</div>
</div>
</div>
</section>
<section class="panel stack">
<h2>Clear boundaries. A clearer experience.</h2>
<div class="notice">Fake execution is prohibited when NODE_ENV=production. The console does not change server settings.</div>
<p>The session and agent key stay in page memory only, never in localStorage or browser files. Reloading or signing out clears them.</p>
<p>Owners review request details and make decisions. Members see safe summaries without arguments or results.</p>
<p>Every execution remains subject to backend policy, approvals, claims and budget checks. Hiding a button does not grant or enforce authority.</p>
<div class="separator">
</div>
<h3>Workspace reference</h3>
<div class="code-row">
<code>${e(state.org.id)}</code>${btn(icon("copy"), "copy-org", "ghost compact", 'aria-label="Copy workspace ID"')}</div>
<p class="small muted">This console does not edit policies or budgets, or add a real payment provider.</p>
</section>
</div>`;
  };
}
