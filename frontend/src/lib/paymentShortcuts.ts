/** A payment shortcut the user created. Nothing here is inferred or suggested. */
export interface PaymentShortcut {
  _id: string;
  label: string;
  amount: number;
  category: string;
  paymentMode: string;
  description: string;
  usageCount: number;
  lastUsedAt: string | null;
}

/** Same payment, however it was spelled. */
const keyOf = (category: string, paymentMode: string, description: string) =>
  [category, paymentMode, description].map(v => v.trim().toLowerCase()).join('|');

/** True when the form already holds exactly what this shortcut would fill in. */
export function matchesShortcut(
  shortcut: Pick<PaymentShortcut, 'category' | 'paymentMode' | 'description'>,
  values: { category: string; paymentMode: string; description: string }
): boolean {
  return (
    keyOf(shortcut.category, shortcut.paymentMode, shortcut.description) ===
    keyOf(values.category, values.paymentMode, values.description)
  );
}
