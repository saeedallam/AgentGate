export const labels = Object.freeze({
  RECEIVED: "Received",
  EXECUTING: "Executing",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
  OUTCOME_UNKNOWN: "Outcome unknown",
  DENIED: "Denied",
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  ALLOW: "Allowed",
  DENY: "Deny",
  REQUIRE_APPROVAL: "Approval required",
});
export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
export function money(minor) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(minor / 100);
}
export function usdToMinor(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new Error(
      "Enter a positive USD amount with at most two decimal places.",
    );
  const [whole, fraction = ""] = value.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor <= 0)
    throw new Error("Invalid amount.");
  return minor;
}
export function refundPayload(paymentId, amount) {
  if (!/^[A-Za-z0-9_-]+$/.test(paymentId) || paymentId.length > 128)
    throw new Error(
      "Payment IDs accept letters, numbers, hyphens and underscores only.",
    );
  return {
    action: { name: "refund.create" },
    arguments: { paymentId, amountMinor: usdToMinor(amount), currency: "USD" },
  };
}
// Freeze an intent before the network call; transport errors must not rotate its key.
export function lockIntent(existing, body, key) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(key))
    throw new Error("Invalid idempotency key.");
  if (existing) {
    if (
      existing.key !== key ||
      JSON.stringify(existing.body) !== JSON.stringify(body)
    )
      throw new Error(
        "The request is saved with its key. Resend the same request or explicitly start a new one.",
      );
    return existing;
  }
  return Object.freeze({
    key,
    body: Object.freeze({
      action: Object.freeze({ ...body.action }),
      arguments: Object.freeze({ ...body.arguments }),
    }),
  });
}
export const shortId = (value) => String(value ?? "").slice(0, 8);
