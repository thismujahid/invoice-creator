export function requiredRule(v: unknown): true | string {
  if (typeof v === "number") v = String(v);
  return !!v ? true : "مينفعش تسيبه فاضي";
}

export function positiveNumberRule(v: unknown): true | string {
  if (v === null || v === undefined || v === "") return true;
  const n = Number(v);
  if (!Number.isFinite(n)) return "يجب إدخال رقم صحيح";
  if (n < 0) return "القيمة لا يمكن أن تكون سالبة";
  return true;
}

export function discountRule(v: unknown, isPercent: boolean): true | string {
  if (v === null || v === undefined || v === "") return true;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return "قيمة الخصم غير صالحة";
  if (isPercent && n > 100) return "النسبة المئوية لا تتجاوز 100";
  return true;
}
