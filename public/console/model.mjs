export const labels = Object.freeze({
  RECEIVED: "تم الاستلام",
  EXECUTING: "قيد التنفيذ",
  SUCCEEDED: "نجح",
  FAILED: "فشل",
  OUTCOME_UNKNOWN: "النتيجة غير مؤكدة",
  DENIED: "ممنوع",
  PENDING: "بانتظار القرار",
  APPROVED: "تمت الموافقة",
  REJECTED: "مرفوض",
  ACTIVE: "نشط",
  SUSPENDED: "موقوف",
  ALLOW: "مسموح",
  DENY: "منع",
  REQUIRE_APPROVAL: "يحتاج موافقة",
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
    throw new Error("اكتب مبلغًا موجبًا بدولار USD وبحد أقصى منزلتين عشريتين.");
  const [whole, fraction = ""] = value.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor <= 0)
    throw new Error("المبلغ غير صالح.");
  return minor;
}
export function refundPayload(paymentId, amount) {
  if (!/^[A-Za-z0-9_-]+$/.test(paymentId) || paymentId.length > 128)
    throw new Error("معرّف الدفعة يقبل الحروف والأرقام و - و _ فقط.");
  return {
    action: { name: "refund.create" },
    arguments: { paymentId, amountMinor: usdToMinor(amount), currency: "USD" },
  };
}
// Freeze an intent before the network call; transport errors must not rotate its key.
export function lockIntent(existing, body, key) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(key))
    throw new Error("مفتاح منع التكرار غير صالح.");
  if (existing) {
    if (
      existing.key !== key ||
      JSON.stringify(existing.body) !== JSON.stringify(body)
    )
      throw new Error(
        "الطلب محفوظ بمفتاحه. أعد إرسال نفس الطلب أو ابدأ طلبًا جديدًا بشكل صريح.",
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
