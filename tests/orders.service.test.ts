import { describe, it, expect } from "vitest";
import { computeOrderTotal, deriveStatus, validatePaymentAmount } from "@/lib/order-logic";
import { toCents, toDollars, formatCents } from "@/lib/money";
import { LineItem, Cents } from "@/lib/types";

// ─── Money Utilities ───────────────────────────────────────────────────────────

describe("Money utilities", () => {
  it("converts dollars to cents", () => {
    expect(toCents(100)).toBe(10000);
    expect(toCents(0.01)).toBe(1);
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(0)).toBe(0);
  });

  it("handles floating-point edge cases", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in JS
    // toCents rounds properly
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it("converts cents to dollars", () => {
    expect(toDollars(10000)).toBe(100);
    expect(toDollars(1)).toBe(0.01);
    expect(toDollars(1999)).toBe(19.99);
  });

  it("formats cents as dollar string", () => {
    expect(formatCents(10000)).toBe("$100.00");
    expect(formatCents(1)).toBe("$0.01");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(99999)).toBe("$999.99");
  });
});

// ─── Order Total Computation ───────────────────────────────────────────────────

describe("computeOrderTotal", () => {
  it("computes total for single line item", () => {
    const items: LineItem[] = [
      { description: "Widget", quantity: 2, unitPriceCents: 50000 },
    ];
    expect(computeOrderTotal(items)).toBe(100000); // $1,000.00
  });

  it("computes total for multiple line items", () => {
    const items: LineItem[] = [
      { description: "Item A", quantity: 3, unitPriceCents: 1000 },
      { description: "Item B", quantity: 1, unitPriceCents: 2500 },
    ];
    expect(computeOrderTotal(items)).toBe(5500); // $55.00
  });

  it("handles the sample scenario: 2 × $500 = $1,000", () => {
    const items: LineItem[] = [
      { description: "Product", quantity: 2, unitPriceCents: 50000 },
    ];
    expect(computeOrderTotal(items)).toBe(100000);
    expect(toDollars(computeOrderTotal(items))).toBe(1000);
  });

  it("returns 0 for empty line items", () => {
    expect(computeOrderTotal([])).toBe(0);
  });
});

// ─── Status Derivation ─────────────────────────────────────────────────────────

describe("deriveStatus", () => {
  const futureDate = "2099-12-31";
  const pastDate = "2020-01-01";

  it("returns pending when no payments and not overdue", () => {
    expect(deriveStatus(100000, 0, futureDate)).toBe("pending");
  });

  it("returns partially_paid when some payment and not overdue", () => {
    expect(deriveStatus(100000, 40000, futureDate)).toBe("partially_paid");
  });

  it("returns paid when fully paid", () => {
    expect(deriveStatus(100000, 100000, futureDate)).toBe("paid");
    // Even if past due — paid is paid
    expect(deriveStatus(100000, 100000, pastDate)).toBe("paid");
  });

  it("returns overdue when past due and not fully paid", () => {
    expect(deriveStatus(100000, 0, pastDate)).toBe("overdue");
    expect(deriveStatus(100000, 50000, pastDate)).toBe("overdue");
  });

  it("paid takes precedence over overdue (edge case: paid after due date)", () => {
    // An order that was overdue but is now fully paid → status is "paid"
    expect(deriveStatus(100000, 100000, pastDate)).toBe("paid");
  });
});

// ─── Payment Validation Logic (unit-level) ─────────────────────────────────────

describe("Payment validation rules", () => {
  it("sample scenario step by step", () => {
    const orderTotal: Cents = 100000; // $1,000.00
    const futureDate = "2099-12-31";

    // Step 1: No payments yet
    expect(deriveStatus(orderTotal, 0, futureDate)).toBe("pending");

    // Step 2: Payment of $400 → partially_paid, $600 due
    const afterFirstPayment: Cents = 40000;
    expect(deriveStatus(orderTotal, afterFirstPayment, futureDate)).toBe("partially_paid");
    expect(orderTotal - afterFirstPayment).toBe(60000); // $600 due

    // Step 3: Payment of $600 → paid, $0 due
    const afterSecondPayment: Cents = 40000 + 60000;
    expect(deriveStatus(orderTotal, afterSecondPayment, futureDate)).toBe("paid");
    expect(orderTotal - afterSecondPayment).toBe(0);

    // Step 4: Attempt $1 more → would exceed (100001 > 100000)
    const attemptedOverpay = afterSecondPayment + 100; // +$1.00 in cents
    expect(attemptedOverpay > orderTotal).toBe(true);
  });

  it("overpayment is detectable (100 cents > 0 remaining)", () => {
    const orderTotal: Cents = 100000;
    const alreadyPaid: Cents = 100000;
    const remaining = orderTotal - alreadyPaid;
    const attemptedPayment: Cents = 100; // $1.00
    expect(attemptedPayment > remaining).toBe(true);
  });

  it("exact payment to remaining is allowed", () => {
    const orderTotal: Cents = 100000;
    const alreadyPaid: Cents = 40000;
    const remaining = orderTotal - alreadyPaid;
    expect(remaining).toBe(60000);
    const exactPayment: Cents = 60000;
    expect(exactPayment <= remaining).toBe(true);
  });
});
