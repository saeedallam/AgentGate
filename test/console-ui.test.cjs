const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const { JSDOM } = require("jsdom");

const orgA = "11111111-1111-4111-8111-111111111111",
  orgB = "22222222-2222-4222-8222-222222222222";
const agent = "33333333-3333-4333-8333-333333333333";
const approval = "44444444-4444-4444-8444-444444444444";
const execution = "55555555-5555-4555-8555-555555555555";
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await tick();
  }
  throw new Error("DOM condition did not become true");
}

async function setup(custom = () => undefined) {
  const model = await import("../public/console/model.mjs");
  const dom = new JSDOM(readFileSync("public/console/index.html", "utf8"), {
    url: "http://localhost:3000/console",
    runScripts: "outside-only",
  });
  const w = dom.window,
    calls = [];
  let decided = false;
  Object.assign(w, {
    e: model.escapeHtml,
    labels: model.labels,
    money: model.money,
    usdToMinor: model.usdToMinor,
    refundPayload: model.refundPayload,
    lockIntent: model.lockIntent,
    shortId: model.shortId,
  });
  w.crypto.randomUUID = randomUUID;
  w.confirm = () => true;
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new w.Event("close"));
  };
  w.fetch = async (path, options) => {
    const call = {
      path,
      options,
      body: options.body ? JSON.parse(options.body) : null,
    };
    calls.push(call);
    const result = await custom(call);
    if (result !== undefined)
      return {
        ok: (result.status || 200) < 400,
        status: result.status || 200,
        json: async () => result.data,
      };
    let data;
    if (path === "/auth/login")
      data = { accessToken: "human-test-token", expiresIn: 900 };
    else if (path === "/health/ready") data = { status: "ok" };
    else if (path === "/v1/console/workspaces")
      data = {
        items: [
          { id: orgA, name: "<img src=x onerror=alert(1)>", role: "OWNER" },
          { id: orgB, name: "Other workspace", role: "MEMBER" },
        ],
      };
    else if (path.endsWith("/overview"))
      data = {
        counts: {},
        agents: 0,
        activeAgents: 0,
        pendingApprovals: 0,
        totalExecutions: 0,
        recent: [],
        environment: "development",
        fakeExecutionEnabled: true,
      };
    else if (path === "/v1/console-agent/identity")
      data = {
        organizationId:
          options.headers.Authorization === "Bearer wrong-org-key"
            ? orgB
            : orgA,
        agentId: agent,
      };
    else if (path.startsWith("/v1/approvals?"))
      data = {
        items: [
          {
            id: approval,
            executionId: execution,
            status: "PENDING",
            executionStatus: "RECEIVED",
            actionName: "refund.create",
            createdAt: new Date().toISOString(),
          },
        ],
      };
    else if (path === "/v1/approvals/" + approval + "/decision") {
      decided = true;
      data = { status: "APPROVED" };
    } else if (path === "/v1/approvals/" + approval)
      data = {
        id: approval,
        executionId: execution,
        status: decided ? "APPROVED" : "PENDING",
        executionStatus: "RECEIVED",
        actionName: "refund.create",
        request: {
          organizationId: orgA,
          action: { name: "refund.create" },
          arguments: {
            paymentId: "private-payment",
            amountMinor: 10000,
            currency: "USD",
          },
        },
      };
    else if (path.startsWith("/agents?")) data = { items: [], hasMore: false };
    else throw new Error("Unexpected request " + path);
    return { ok: true, status: 200, json: async () => data };
  };
  w.eval(
    readFileSync("public/console/app.mjs", "utf8").replace(
      /^import[\s\S]*?;\s*/,
      "",
    ),
  );
  const doc = w.document;
  function click(selector) {
    const el = doc.querySelector(selector);
    assert.ok(el, selector);
    el.click();
  }
  function submit(selector, values = {}, submitter) {
    const form = doc.querySelector(selector);
    assert.ok(form, selector);
    for (const [name, value] of Object.entries(values))
      form.elements.namedItem(name).value = value;
    const button = submitter
      ? form.querySelector(submitter)
      : form.querySelector('button[type="submit"]');
    form.dispatchEvent(
      new w.SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
        submitter: button,
      }),
    );
  }
  async function login() {
    submit('[data-form="login"]', {
      email: "owner@example.test",
      password: "unchanged password",
    });
    await until(() => doc.querySelector(".stats"));
  }
  return { dom, w, doc, calls, click, submit, login };
}

test("console DOM login escapes workspace names, separates agent identity and replays ambiguous intent with the same key", async () => {
  let submissions = 0;
  const h = await setup((call) => {
    if (call.path === "/v1/actions") {
      submissions++;
      if (submissions === 1) throw new Error("simulated transport loss");
      return { data: { id: execution, status: "SUCCEEDED" } };
    }
  });
  try {
    await h.login();
    assert.equal(h.doc.querySelector('img[src="x"]'), null);
    assert.equal(h.w.localStorage.length, 0);
    assert.equal(h.w.sessionStorage.length, 0);
    h.click('[data-page="playground"]');
    await until(() => h.doc.querySelector('[data-form="action"]'));
    h.click('[data-act="bind-key"]');
    h.submit('[data-form="bind"]', { key: "wrong-org-key" });
    await until(() =>
      h.doc
        .querySelector('[data-form="bind"] .form-error')
        .textContent.includes("أخرى"),
    );
    assert.equal(h.calls.filter((c) => c.path === "/v1/actions").length, 0);
    h.submit('[data-form="bind"]', { key: "right-org-key" });
    await until(() => !h.doc.querySelector('[data-form="bind"]'));
    h.submit(
      '[data-form="action"]',
      {
        paymentId: "payment_demo",
        amount: "100.01",
        idempotencyKey: "stable-key-1",
      },
      '[value="submit"]',
    );
    await until(() => h.doc.querySelector('[data-act="new-intent"]'));
    assert.equal(submissions, 1);
    assert.equal(h.doc.querySelector('[name="paymentId"]').disabled, true);
    h.submit('[data-form="action"]', {}, '[value="submit"]');
    await until(() => submissions === 2);
    await until(() =>
      h.doc.querySelector("#main").textContent.includes("SUCCEEDED"),
    );
    const sent = h.calls.filter((c) => c.path === "/v1/actions");
    assert.deepEqual(sent[0].body, sent[1].body);
    assert.equal(sent[0].body.arguments.amountMinor, 10001);
    assert.equal(sent[0].options.headers["Idempotency-Key"], "stable-key-1");
    assert.equal(sent[1].options.headers["Idempotency-Key"], "stable-key-1");
    assert.equal(sent[0].options.headers.Authorization, "Bearer right-org-key");
    h.click('[data-act="logout"]');
    assert.ok(h.doc.querySelector('[data-form="login"]'));
    assert.equal(h.doc.body.textContent.includes("right-org-key"), false);
  } finally {
    h.dom.window.close();
  }
});

test("console DOM approval uses the human session, records the exact decision and never dispatches automatically", async () => {
  const h = await setup();
  try {
    await h.login();
    h.click('[data-page="approvals"]');
    await until(() => h.doc.querySelector('[data-act="approval"]'));
    h.click('[data-act="approval"]');
    await until(() => h.doc.querySelector('[data-form="decision"]'));
    assert.ok(
      h.doc.querySelector("#dialog").textContent.includes("private-payment"),
    );
    h.submit('[data-form="decision"]', {}, '[value="APPROVED"]');
    await until(() => h.calls.some((c) => c.path.endsWith("/decision")));
    await until(() => !h.doc.querySelector('[data-form="decision"]'));
    const call = h.calls.find((c) => c.path.endsWith("/decision"));
    assert.deepEqual(call.body, { decision: "APPROVED" });
    assert.equal(call.options.headers.Authorization, "Bearer human-test-token");
    assert.equal(
      h.calls.some(
        (c) => c.path === "/v1/actions" || c.path.endsWith("/resume"),
      ),
      false,
    );
  } finally {
    h.dom.window.close();
  }
});

test("console DOM ignores responses from the previous workspace and clears the agent binding when switching", async () => {
  let release;
  const h = await setup((call) =>
    call.path.startsWith("/agents?") && call.path.includes(orgA)
      ? new Promise((resolve) => {
          release = resolve;
        })
      : undefined,
  );
  try {
    await h.login();
    h.click('[data-page="playground"]');
    await until(() => h.doc.querySelector('[data-form="action"]'));
    h.click('[data-act="bind-key"]');
    h.submit('[data-form="bind"]', { key: "right-org-key" });
    await until(() => !h.doc.querySelector('[data-form="bind"]'));
    assert.equal(h.doc.querySelector('[value="submit"]').disabled, false);
    h.click('[data-page="agents"]');
    await until(() => release);
    const select = h.doc.querySelector("#workspace");
    select.value = orgB;
    select.dispatchEvent(new h.w.Event("change", { bubbles: true }));
    await until(() =>
      h.doc.querySelector("#main").textContent.includes("أول وكيل"),
    );
    release({
      data: {
        items: [{ id: agent, name: "PRIVATE-OLD-WORKSPACE", status: "ACTIVE" }],
        hasMore: false,
      },
    });
    await tick();
    await tick();
    assert.equal(
      h.doc.body.textContent.includes("PRIVATE-OLD-WORKSPACE"),
      false,
    );
    assert.equal(h.doc.querySelector('[data-act="new-agent"]'), null);
    h.click('[data-page="playground"]');
    await until(() => h.doc.querySelector('[data-form="action"]'));
    assert.equal(h.doc.querySelector('[value="submit"]').disabled, true);
  } finally {
    h.dom.window.close();
  }
});
