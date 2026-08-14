# Orders & Settlements

A full-stack order management application with partial payment tracking, atomic settlement processing, and derived status computation.

**Live URL:** https://crossval-orders.vercel.app

---

## Quick Start

### Prerequisites

- Node.js 18+
- MongoDB Atlas (free tier) or local replica set
- npm

### Setup

```bash
git clone <repo-url>
cd crossval-orders
npm install
cp .env.local.example .env.local
# Edit .env.local with your MongoDB URI and JWT secret
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `MONGODB_URI` | MongoDB connection string (replica set) | Yes |
| `JWT_SECRET` | Secret for JWT signing (min 32 chars) | Yes |

Both variables are required for the application to function correctly.

### Run

```bash
# Create database indexes (run once)
npx tsx scripts/seed.ts

# Development
npm run dev

# Production build
npm run build && npm start

# Unit tests (no DB required)
npm test

# Integration tests (requires environment variables)
# PowerShell:
$env:MONGODB_URI="<your-uri>"; $env:JWT_SECRET="<your-secret>"; npm test
# Linux/macOS:
MONGODB_URI=<your-uri> JWT_SECRET=<your-secret> npm test
```

---

## API Overview

All endpoints use **httpOnly cookie authentication**. The JWT is never exposed to client-side JavaScript.

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/signup` | Create account → sets auth cookie |
| POST | `/api/auth/login` | Sign in → sets auth cookie |
| POST | `/api/auth/logout` | Clear auth cookie |
| GET | `/api/auth/me` | Get current user from cookie |

### Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/orders?status=` | List orders (optional status filter) |
| POST | `/api/orders` | Create order with line items |
| GET | `/api/orders/:id` | Get order detail with computed status |
| PATCH | `/api/orders/:id` | Update order (rejected if payments exist) |
| DELETE | `/api/orders/:id` | Delete order (rejected if payments exist) |

### Payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/orders/:id/payments` | List payments for an order |
| POST | `/api/orders/:id/payments` | Record payment (atomic, race-safe) |

---

## Architecture & Engineering Decisions

### Money Representation: Integer Cents

All monetary values are stored and computed as **integer cents** (e.g., `$100.50` → `10050`).

**Why:** JavaScript floating-point arithmetic produces drift (`0.1 + 0.2 = 0.30000000000000004`). Integer arithmetic is exact. Conversion to/from dollars happens only at the API boundary and display layer.

### Status Derivation: Computed, Never Stored

Order status is **never persisted** — it's derived on every read from:
- `totalCents` (order total)
- `paidCents` (maintained atomically on the order document)
- Current date vs `dueDate`

| Status | Condition |
|--------|-----------|
| `pending` | No payments, not past due |
| `partially_paid` | Some payment < total, not past due |
| `paid` | paidCents ≥ totalCents |
| `overdue` | Past due date AND not fully paid |

**Why:** Storing derived state creates consistency bugs. Computing on read guarantees correctness.

### Order Immutability After Payment

Orders become **read-only after the first payment**. The update/delete operations use an atomic filter (`paidCents: 0`) — there is no TOCTOU race between checking for payments and performing the write.

**Why:** Allowing edits after payment creates accounting inconsistencies. In production, you'd issue credit notes. For this scope, immutability is the safest choice.

### Concurrency: Atomic Update Inside Transaction

**The problem:**

```
Order total = $1,000
Currently paid = $600, remaining = $400

Request A: pay $300  (arrives simultaneously)
Request B: pay $300  (arrives simultaneously)

Naïve implementation: both read $400 remaining → both succeed → $1,200 paid on $1,000 order
```

**The solution:**

Payment recording uses a **MongoDB transaction** containing two operations:

1. **Atomic conditional increment** — `findOneAndUpdate` with `$expr` filter:
   ```javascript
   db.orders.findOneAndUpdate(
     { _id: orderId, $expr: { $lte: [{ $add: ["$paidCents", amount] }, "$totalCents"] } },
     { $inc: { paidCents: amount } },
     { session }
   )
   ```
2. **Payment insert** — within the same transaction session

Both succeed or both roll back. This guarantees:
- **Concurrency safety:** The conditional `$expr` + `$inc` is evaluated atomically on the order document. Concurrent payment attempts cannot cause `paidCents` to exceed `totalCents`; MongoDB serializes conflicting writes at the document level, and the losing attempt fails the filter condition.
- **Ledger consistency:** `order.paidCents === SUM(payments.amountCents)` — always. A crash between step 1 and step 2 triggers a transaction rollback, not partial state.

If two payments arrive simultaneously:
1. **Request A** — atomically checks `60000 + 30000 ≤ 100000` → true → increments to 90000, inserts payment → COMMIT
2. **Request B** — atomically checks `90000 + 30000 ≤ 100000` → false → returns null → rejected with actionable error

**Why both primitives:**
- The atomic `$expr` + `$inc` provides the race protection (single-document guarantee)
- The transaction provides all-or-nothing consistency between the order and payment collections

**What I decided NOT to build:**
- Idempotency keys (next priority for production — prevents duplicate payments from network retries)
- Distributed locks (unnecessary — single document update + transaction suffice)
- Saga pattern (overkill for two operations on one database)

### Authentication: Cookie-Only

The JWT is stored **exclusively** in an httpOnly cookie. It is never:
- Returned in API responses
- Stored in localStorage
- Sent via Authorization header
- Accessible to client-side JavaScript

**Why:** An httpOnly cookie cannot be stolen via XSS. localStorage can. For a financial application, this is the correct default.

### Database Indexes

```
users.email        → UNIQUE (prevents signup race condition)
orders.userId      → compound with createdAt (list query)
payments.orderId   → compound with createdAt (payment history)
```

The unique email index means even if two signup requests race, MongoDB guarantees only one succeeds (duplicate key error → clean 409 response).

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Order was overdue but now fully paid | Status = `paid` (paid is terminal, takes precedence) |
| Payment exactly equals remaining | Accepted — status transitions to `paid` |
| Payment exceeds remaining by $0.01 | Rejected with error including max allowed amount |
| Edit order after payment | Rejected (HTTP 409, atomic filter) |
| Delete order after payment | Rejected (HTTP 409, atomic filter) |
| Two simultaneous payments exceeding total | Exactly one succeeds (atomic `$expr` + `$inc`) |
| Order total = $0 | Status = `paid` immediately (0 ≥ 0) |
| Duplicate signup (race condition) | Unique index → clean 409 error |

---

## Error Response Format

All errors follow a consistent structure with **actionable resolution hints**:

```json
{
  "code": "PAYMENT_EXCEEDS_AMOUNT_DUE",
  "message": "Payment of $300.00 exceeds the remaining amount due of $200.00.",
  "remainingAmountCents": 20000,
  "maxAllowedAmount": 200
}
```

Error codes are machine-readable. Messages are human-readable.

---

## Testing

```bash
npm test
```

**Unit tests (16, no DB required):**
- Money conversion (cents ↔ dollars, floating-point edge cases)
- Order total computation (single/multiple line items)
- Status derivation (all 4 states + edge cases)
- Payment validation (overpayment detection, exact-amount acceptance)
- Sample scenario walkthrough

**Integration tests (4, requires MONGODB_URI):**
- Concurrent payments exceeding remaining → exactly one rejected, ledger consistent
- Concurrent payments within remaining → both accepted, ledger consistent
- Off-by-one-cent rejection → no payment record, no paidCents change
- Exact remaining payment → fully paid, ledger consistent

**Critical invariant tested:** After every operation, `order.paidCents === SUM(payments.amountCents)`.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | Next.js 14 (App Router) | Full-stack in one unit; matches CrossVal stack |
| Language | TypeScript | End-to-end type safety |
| Database | MongoDB (Atlas) | Document model fits orders+line items; atomic ops |
| Auth | JWT + bcrypt (httpOnly cookie) | Stateless, XSS-resistant |
| Validation | Zod | Runtime schema validation |
| Styling | Tailwind CSS | Fast UI iteration |
| Testing | Vitest | Fast, ESM-native |
| Deployment | Vercel | Zero-config Next.js hosting |

---

## What I Would Improve Before Production

1. **Idempotency keys** — Client-generated key with each payment to prevent duplicate processing from network retries
2. **Audit log** — Event-sourced record of all mutations (payment recorded, order created) with actor and timestamp
3. **Rate limiting** — Protect payment endpoints from abuse
4. **Pagination** — Cursor-based pagination for orders list
5. **Decimal128** — MongoDB's native decimal type for currencies requiring sub-cent precision
6. **Webhook events** — Emit on status transitions for downstream integrations
7. **E2E tests** — Playwright for full payment flow browser testing
8. **CSRF protection** — Double-submit cookie pattern (SameSite=Lax covers most vectors but not all)
9. **API versioning** — Path-based (`/api/v1/`) for backward compatibility
10. **Observability** — Structured logging, error tracking, latency metrics

---

## Project Structure

```
crossval-orders/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/auth/           # signup, login, logout, me
│   │   └── api/orders/         # CRUD + payments
│   ├── components/             # React UI
│   │   ├── AuthProvider.tsx    # Cookie-only auth context
│   │   ├── Dashboard.tsx       # Orders table + status filter
│   │   ├── CreateOrderModal.tsx
│   │   └── OrderDetailModal.tsx
│   └── lib/                    # Shared logic
│       ├── api-client.ts       # Typed frontend API (credentials: include)
│       ├── auth.ts             # JWT (cookie-only, no localStorage)
│       ├── db.ts               # MongoDB connection
│       ├── money.ts            # Cents ↔ dollars
│       ├── order-logic.ts      # Pure business rules (testable)
│       ├── orders.service.ts   # Atomic DB operations
│       ├── types.ts            # TypeScript interfaces
│       └── validation.ts       # Zod schemas
├── tests/
│   ├── orders.service.test.ts  # Unit tests (16)
│   └── payment-concurrency.test.ts  # Integration tests (4)
├── scripts/seed.ts             # Index creation
└── package.json
```

---

## Sample Scenario Verification

As specified in the assignment:

1. **Create order:** 2 × $500 = $1,000 total, due in 7 days → Status: `pending`
2. **Record $400 payment** → Status: `partially_paid`, amount due: $600
3. **Record $600 payment** → Status: `paid`, amount due: $0
4. **Attempt $1 payment** → Rejected: `"Payment of $1.00 exceeds the remaining amount due of $0.00."`

The backend calculation and payment rules are covered by automated tests. The full UI flow was also verified manually against the deployed application.
