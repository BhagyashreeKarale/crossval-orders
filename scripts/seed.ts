/**
 * Seed script — creates indexes.
 * Run: npx tsx scripts/seed.ts
 *
 * Requires MONGODB_URI environment variable.
 */
import { MongoClient } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("Set MONGODB_URI environment variable");
  process.exit(1);
}

async function seed() {
  const client = new MongoClient(MONGODB_URI!);
  await client.connect();
  const db = client.db();

  console.log("Creating indexes...");

  // Users: unique email (prevents signup race condition)
  await db.collection("users").createIndex(
    { email: 1 },
    { unique: true, name: "users_email_unique" }
  );

  // Orders: lookup by user, sorted by creation
  await db.collection("orders").createIndex(
    { userId: 1, createdAt: -1 },
    { name: "orders_userId_createdAt" }
  );

  // Payments: lookup by order (for payment history)
  await db.collection("payments").createIndex(
    { orderId: 1, createdAt: 1 },
    { name: "payments_orderId_createdAt" }
  );

  // Payments: compound for user-scoped queries
  await db.collection("payments").createIndex(
    { orderId: 1, userId: 1 },
    { name: "payments_orderId_userId" }
  );

  console.log("Indexes created successfully:");
  console.log("  - users.email (unique)");
  console.log("  - orders.userId + createdAt");
  console.log("  - payments.orderId + createdAt");
  console.log("  - payments.orderId + userId");

  await client.close();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
