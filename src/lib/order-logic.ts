/**
 * Pure business logic functions — no database dependencies.
 * This module is the single source of truth for order calculations and status derivation.
 * Easily testable without requiring a database connection.
 */

import { LineItem, Cents, OrderStatus } from "./types";

/**
 * Compute the total order amount from line items.
 * Each line: quantity × unitPriceCents (already in cents).
 */
export function computeOrderTotal(lineItems: LineItem[]): Cents {
  return lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitPriceCents,
    0
  );
}

/**
 * Derive order status from payment totals and due date.
 *
 * Rules:
 * - paid: total payments >= order total (takes precedence over overdue)
 * - overdue: past due date AND not fully paid
 * - partially_paid: some payment but less than total, not yet overdue
 * - pending: no payments, not yet overdue
 *
 * Edge case: An order that was overdue but is now fully paid → "paid".
 * Rationale: "paid" is a terminal state — once settled, overdue no longer applies.
 */
export function deriveStatus(
  totalCents: Cents,
  paidCents: Cents,
  dueDate: string
): OrderStatus {
  // Fully paid always wins — even if it was past due
  if (paidCents >= totalCents) return "paid";

  const now = new Date();
  const due = new Date(dueDate + "T23:59:59.999Z");
  const isOverdue = now > due;

  if (paidCents === 0) return isOverdue ? "overdue" : "pending";
  // paidCents > 0 but < totalCents
  return isOverdue ? "overdue" : "partially_paid";
}

/**
 * Validate whether a payment amount is acceptable.
 * Returns null if valid, or an error object if invalid.
 */
export function validatePaymentAmount(
  amountCents: Cents,
  orderTotalCents: Cents,
  currentPaidCents: Cents
): { code: string; message: string; remainingAmountCents: Cents } | null {
  const remainingCents = orderTotalCents - currentPaidCents;

  if (amountCents > remainingCents) {
    return {
      code: "PAYMENT_EXCEEDS_AMOUNT_DUE",
      message: `Payment of $${(amountCents / 100).toFixed(2)} exceeds the remaining amount due of $${(remainingCents / 100).toFixed(2)}.`,
      remainingAmountCents: remainingCents,
    };
  }
  return null;
}
