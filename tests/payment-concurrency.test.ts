/**
 * Integration test: Concurrent payment atomicity.
 *
 * Verifies two properties:
 * 1. Two concurrent payments that together exceed remaining → exactly one rejected
 * 2. The invariant: order.paidCents === initialPaidCents + SUM(new payments) — always
 *
 * Requires: MONGODB_URI environment variable pointing to a replica set.
 * Run with: MONGODB_URI=<uri> JWT_SECRET=test-secret-for-tests npm test
 *
 * If MONGODB_URI is not set, this test suite is skipped gracefully.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, ObjectId, Db, Collection } from "mongodb";
import { recordPayment } from "@/lib/orders.service";
import type { Order, Payment } from "@/lib/types";

const MONGODB_URI = process.env.MONGODB_URI;
const describeWithDb = MONGODB_URI ? describe : describe.skip;

describeWithDb("Payment concurrency (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let ordersCol: Collection<Order>;
  let paymentsCol: Collection<Payment>;
  const testUserId = new ObjectId();

  beforeAll(async () => {
    // Set JWT_SECRET for auth module (required but not used in these tests)
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-minimum-32-characters-long";

    client = new MongoClient(MONGODB_URI!);
    await client.connect();
    db = client.db();
    ordersCol = db.collection<Order>("orders");
    paymentsCol = db.collection<Payment>("payments");
  });

  afterAll(async () => {
    // Clean up all test data
    await ordersCol.deleteMany({ userId: testUserId });
    await paymentsCol.deleteMany({ userId: testUserId });
    await client.close();
  });

  /**
   * Helper: create a test order with initial payments pre-seeded.
   * Creates matching payment records so the ledger invariant holds from the start.
   */
  async function createTestOrder(
    totalCents: number,
    initialPaidCents: number
  ): Promise<string> {
    const orderId = new ObjectId();

    await ordersCol.insertOne({
      _id: orderId,
      userId: testUserId,
      customer: "Concurrency Test",
      dueDate: "2099-12-31",
      lineItems: [{ description: "Widget", quantity: 1, unitPriceCents: totalCents }],
      totalCents,
      paidCents: initialPaidCents,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // If there are pre-existing payments, insert a matching seed record
    // so the invariant (paidCents === SUM(payments)) holds from the start
    if (initialPaidCents > 0) {
      await paymentsCol.insertOne({
        orderId,
        userId: testUserId,
        amountCents: initialPaidCents,
        date: "2026-08-01",
        note: "Pre-seeded payment for test setup",
        createdAt: new Date(),
      });
    }

    return orderId.toString();
  }

  /**
   * Verify the critical invariant:
   * order.paidCents MUST equal SUM(payments.amountCents) for that order.
   */
  async function assertLedgerConsistency(orderId: string) {
    const order = await ordersCol.findOne({ _id: new ObjectId(orderId) });
    const payments = await paymentsCol
      .find({ orderId: new ObjectId(orderId) })
      .toArray();
    const paymentSum = payments.reduce((sum, p) => sum + p.amountCents, 0);

    expect(order!.paidCents).toBe(paymentSum);
  }

  it("rejects concurrent payments that together exceed remaining — one succeeds, one fails", async () => {
    // Order: $1,000 total, $600 already paid → $400 remaining
    // Two $300 requests arrive simultaneously. Only one can succeed.
    const orderId = await createTestOrder(100000, 60000);
    const userId = testUserId.toString();

    const results = await Promise.allSettled([
      recordPayment(orderId, userId, 30000, "2026-08-14", "Payment A"),
      recordPayment(orderId, userId, 30000, "2026-08-14", "Payment B"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one succeeds, one fails
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // The rejected one should have the right error code
    const rejection = rejected[0] as PromiseRejectedResult;
    expect(rejection.reason.code).toBe("PAYMENT_EXCEEDS_AMOUNT_DUE");

    // Final state: paidCents = 90000 ($600 + $300)
    const finalOrder = await ordersCol.findOne({ _id: new ObjectId(orderId) });
    expect(finalOrder!.paidCents).toBe(90000);

    // Exactly 2 payment records: 1 seed + 1 new
    const payments = await paymentsCol
      .find({ orderId: new ObjectId(orderId) })
      .toArray();
    expect(payments.length).toBe(2); // seed (60000) + new (30000)

    // Invariant holds: paidCents === SUM(payments)
    await assertLedgerConsistency(orderId);
  });

  it("accepts concurrent payments that together stay within remaining", async () => {
    // Order: $1,000 total, $600 paid → $400 remaining
    // Two $150 requests. Both fit. Both should succeed.
    const orderId = await createTestOrder(100000, 60000);
    const userId = testUserId.toString();

    const results = await Promise.allSettled([
      recordPayment(orderId, userId, 15000, "2026-08-14", "Payment A"),
      recordPayment(orderId, userId, 15000, "2026-08-14", "Payment B"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(2);

    // Final state: 60000 + 15000 + 15000 = 90000
    const finalOrder = await ordersCol.findOne({ _id: new ObjectId(orderId) });
    expect(finalOrder!.paidCents).toBe(90000);

    // 3 payment records: 1 seed + 2 new
    const payments = await paymentsCol
      .find({ orderId: new ObjectId(orderId) })
      .toArray();
    expect(payments.length).toBe(3);

    // Invariant holds
    await assertLedgerConsistency(orderId);
  });

  it("rejects overpayment by one cent", async () => {
    // Order: $1,000 total, $600 paid → remaining = $400 (40000 cents)
    // Attempt $400.01 (40001 cents) → should be rejected
    const orderId = await createTestOrder(100000, 60000);
    const userId = testUserId.toString();

    await expect(
      recordPayment(orderId, userId, 40001, "2026-08-14")
    ).rejects.toMatchObject({ code: "PAYMENT_EXCEEDS_AMOUNT_DUE" });

    // No new payment recorded, paidCents unchanged
    const finalOrder = await ordersCol.findOne({ _id: new ObjectId(orderId) });
    expect(finalOrder!.paidCents).toBe(60000);

    // Only the seed payment exists
    const payments = await paymentsCol
      .find({ orderId: new ObjectId(orderId) })
      .toArray();
    expect(payments.length).toBe(1); // only seed

    await assertLedgerConsistency(orderId);
  });

  it("accepts exact remaining amount", async () => {
    // Order: $1,000 total, $600 paid → remaining = $400 (40000 cents)
    // Pay exactly $400 → should succeed, fully paid
    const orderId = await createTestOrder(100000, 60000);
    const userId = testUserId.toString();

    const payment = await recordPayment(orderId, userId, 40000, "2026-08-14", "Final payment");
    expect(payment.amountCents).toBe(40000);

    const finalOrder = await ordersCol.findOne({ _id: new ObjectId(orderId) });
    expect(finalOrder!.paidCents).toBe(100000); // Fully paid

    // 2 records: seed + final
    const payments = await paymentsCol
      .find({ orderId: new ObjectId(orderId) })
      .toArray();
    expect(payments.length).toBe(2);

    await assertLedgerConsistency(orderId);
  });
});
