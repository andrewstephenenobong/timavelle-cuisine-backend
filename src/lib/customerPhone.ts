export function normalizeCustomerPhone(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/[^0-9+]/g, '');
  return digits.startsWith('00') ? `+${digits.slice(2)}` : digits;
}
