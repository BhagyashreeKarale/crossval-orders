import { Cents } from "./types";

/**
 * Convert a dollar amount (number or string) to integer cents.
 * Rounds to nearest cent to handle floating-point inputs like 19.99.
 */
export function toCents(dollars: number): Cents {
  return Math.round(dollars * 100);
}

/**
 * Convert integer cents back to dollars for display.
 */
export function toDollars(cents: Cents): number {
  return cents / 100;
}

/**
 * Format cents as a dollar string.
 */
export function formatCents(cents: Cents): string {
  return `$${toDollars(cents).toFixed(2)}`;
}
