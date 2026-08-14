import { ObjectId } from "mongodb";
import { getDb, getClient } from "./db";
import { Order, OrderStatus, OrderWithStatus, Payment, LineItem, Cents } from "./types";
import { computeOrderTotal, deriveStatus } from "./order-logic";

// Re-export pure logic for convenience
export { computeOrderTotal, deriveStatus } from "./order-logic";

// ---------- Orders ----------

export async function createOrder(
  userId: string,
  customer: string,
  dueDate: string,
  lineItems: LineItem[]
): Promise<Order> {
  const db = await getDb();
  const totalCents = computeOrderTotal(lineItems);

  const order: Order = {
    userId: new ObjectId(userId),
    customer,
    dueDate,
    lineItems,
    totalCents,
    paidCents: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await db.collection("orders").insertOne(order);
  order._id = result.insertedId;
  return order;
}

export async function getOrderById(
  orderId: string,
  userId: string
): Promise<OrderWithStatus | null> {
  const db = await getDb();
  const order = await db.collection<Order>("orders").findOne({
    _id: new ObjectId(orderId),
    userId: new ObjectId(userId),
  });
  if (!order) return null;
  return toOrderWithStatus(order);
}

export async function listOrders(
  userId: string,
  statusFilter?: OrderStatus
): Promise<OrderWithStatus[]> {
  const db = await getDb();
  const orders = await db
    .collection<Order>("orders")
    .find({ userId: new ObjectId(userId) })
    .sort({ createdAt: -1 })
    .toArray();

  const enriched = orders.map(toOrderWithStatus);

  if (statusFilter) {
    return enriched.filter((o) => o.status === statusFilter);
  }
  return enriched;
}

/**
 * Update an order. Uses atomic filter (paidCents: 0) to reject if payments exist.
 * No TOCTOU race — the condition is evaluated atomically with the write.
 */
export async function updateOrder(
  orderId: string,
  userId: string,
  data: { customer?: string; dueDate?: string; lineItems?: LineItem[] }
): Promise<OrderWithStatus | null> {
  const db = await getDb();
  const oid = new ObjectId(orderId);
  const uid = new ObjectId(userId);

  const updateFields: Record<string, unknown> = { updatedAt: new Date() };
  if (data.customer !== undefined) updateFields.customer = data.customer;
  if (data.dueDate !== undefined) updateFields.dueDate = data.dueDate;
  if (data.lineItems !== undefined) {
    updateFields.lineItems = data.lineItems;
    updateFields.totalCents = computeOrderTotal(data.lineItems);
  }

  const result = await db.collection<Order>("orders").findOneAndUpdate(
    { _id: oid, userId: uid, paidCents: 0 },
    { $set: updateFields },
    { returnDocument: "after" }
  );

  if (!result) {
    const exists = await db
      .collection<Order>("orders")
      .findOne({ _id: oid, userId: uid });
    if (!exists) return null;
    throw new OrderLockedError(
      "ORDER_HAS_PAYMENTS",
      "Cannot edit an order that has payments recorded. Orders become read-only after the first payment."
    );
  }

  return toOrderWithStatus(result);
}

/**
 * Delete an order. Uses atomic filter (paidCents: 0) to reject if payments exist.
 */
export async function deleteOrder(
  orderId: string,
  userId: string
): Promise<boolean> {
  const db = await getDb();
  const oid = new ObjectId(orderId);
  const uid = new ObjectId(userId);

  const result = await db.collection<Order>("orders").deleteOne({
    _id: oid,
    userId: uid,
    paidCents: 0,
  });

  if (result.deletedCount === 0) {
    const exists = await db
      .collection<Order>("orders")
      .findOne({ _id: oid, userId: uid });
    if (!exists) return false;
    throw new OrderLockedError(
      "ORDER_HAS_PAYMENTS",
      "Cannot delete an order that has payments recorded."
    );
  }
  return true;
}

// ---------- Payments ----------

/**
 * Record a payment atomically using a MongoDB transaction.
 *
 * Concurrency strategy:
 * 1. The order document's `paidCents` field is the concurrency boundary.
 *    We use `findOneAndUpdate` with a `$expr` filter that atomically checks
 *    whether `paidCents + amount <= totalCents` before incrementing.
 *
 * 2. Both the order update AND the payment insert happen inside a single
 *    MongoDB transaction. This guarantees:
 *    - If the order update succeeds but the payment insert fails → rollback.
 *    - If the process crashes between the two → rollback.
 *    - paidCents ALWAYS equals SUM(payments.amountCents).
 *
 * If two payments arrive simultaneously:
 * - Request A: finds paidCents=60000, checks 60000+30000<=100000 → true → increments to 90000
 * - Request B: finds paidCents=90000, checks 90000+30000<=100000 → false → filter miss → rejected
 *
 * The atomic `$expr` + `$inc` on a single document provides the race protection.
 * The transaction provides all-or-nothing consistency between order and payment records.
 */
export async function recordPayment(
  orderId: string,
  userId: string,
  amountCents: Cents,
  date: string,
  note?: string
): Promise<Payment> {
  const client = await getClient();
  const session = client.startSession();

  try {
    let payment: Payment | null = null;

    await session.withTransaction(async () => {
      const db = client.db();
      const oid = new ObjectId(orderId);
      const uid = new ObjectId(userId);

      // Step 1: Atomic conditional increment of paidCents
      const updateResult = await db.collection<Order>("orders").findOneAndUpdate(
        {
          _id: oid,
          userId: uid,
          $expr: { $lte: [{ $add: ["$paidCents", amountCents] }, "$totalCents"] },
        },
        { $inc: { paidCents: amountCents }, $set: { updatedAt: new Date() } },
        { returnDocument: "after", session }
      );

      if (!updateResult) {
        // Determine why: order not found, or overpayment
        const order = await db
          .collection<Order>("orders")
          .findOne({ _id: oid, userId: uid }, { session });

        if (!order) {
          throw new PaymentError(
            "ORDER_NOT_FOUND",
            "Order not found or does not belong to you."
          );
        }

        const remainingCents = order.totalCents - order.paidCents;
        throw new PaymentError(
          "PAYMENT_EXCEEDS_AMOUNT_DUE",
          `Payment of $${(amountCents / 100).toFixed(2)} exceeds the remaining amount due of $${(remainingCents / 100).toFixed(2)}.`,
          {
            requestedAmountCents: amountCents,
            remainingAmountCents: remainingCents,
            maxAllowedAmount: remainingCents / 100,
          }
        );
      }

      // Step 2: Insert payment record (within the same transaction)
      const newPayment: Payment = {
        orderId: oid,
        userId: uid,
        amountCents,
        date,
        note: note || undefined,
        createdAt: new Date(),
      };

      const insertResult = await db
        .collection("payments")
        .insertOne(newPayment, { session });
      newPayment._id = insertResult.insertedId;
      payment = newPayment;
    });

    return payment!;
  } finally {
    await session.endSession();
  }
}

export async function getPaymentsForOrder(
  orderId: string,
  userId: string
): Promise<Payment[]> {
  const db = await getDb();
  return db
    .collection<Payment>("payments")
    .find({
      orderId: new ObjectId(orderId),
      userId: new ObjectId(userId),
    })
    .sort({ createdAt: 1 })
    .toArray();
}

// ---------- Enrichment ----------

/**
 * Convert an Order document to OrderWithStatus.
 * Status is derived from paidCents (on the document) and dueDate.
 * No additional aggregation query — eliminates N+1.
 */
function toOrderWithStatus(order: Order): OrderWithStatus {
  const dueCents = Math.max(0, order.totalCents - order.paidCents);
  const status = deriveStatus(order.totalCents, order.paidCents, order.dueDate);

  return {
    ...order,
    _id: order._id!.toString(),
    userId: order.userId,
    status,
    paidCents: order.paidCents,
    dueCents,
  };
}

// ---------- Errors ----------

export class PaymentError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "PaymentError";
  }
}

export class OrderLockedError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "OrderLockedError";
  }
}
