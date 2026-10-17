const { test } = require("node:test");
const assert = require("node:assert/strict");

test("console escapes untrusted markup and converts dollars without losing cents", async () => {
  const { escapeHtml, usdToMinor, refundPayload } = await import(
    "../public/console/model.mjs"
  );
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
  );
  assert.equal(usdToMinor("100.01"), 10001);
  assert.equal(usdToMinor("0.29"), 29);
  for (const value of [
    "0",
    "-1",
    "1.001",
    "1e3",
    "NaN",
    "1,000",
    "9007199254740991",
  ])
    assert.throws(() => usdToMinor(value));
  assert.deepEqual(refundPayload("payment_1", "50"), {
    action: { name: "refund.create" },
    arguments: { paymentId: "payment_1", amountMinor: 5000, currency: "USD" },
  });
});

test("console intent retains the same key and immutable payload after ambiguous transport", async () => {
  const { lockIntent, refundPayload } = await import(
    "../public/console/model.mjs"
  );
  const body = refundPayload("payment_1", "100");
  const intent = lockIntent(null, body, "console-intent-1");
  body.arguments.amountMinor = 90000;
  assert.equal(intent.body.arguments.amountMinor, 10000);
  assert.equal(
    lockIntent(intent, refundPayload("payment_1", "100"), "console-intent-1"),
    intent,
  );
  assert.throws(() =>
    lockIntent(intent, refundPayload("payment_1", "101"), "console-intent-1"),
  );
  assert.throws(() =>
    lockIntent(intent, refundPayload("payment_1", "100"), "new-key"),
  );
});
