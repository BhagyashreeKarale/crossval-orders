import { ObjectId } from "mongodb";

// ---------- Money ----------
// All monetary values stored as integer cents to avoid floating-point drift.
// $100.50 → 10050

export type Cents = number;

// ---------- Line Items ----------
export interface LineItem {
  description: string;
  quantity: number; // >= 1
  unitPriceCents: Cents; // >= 0
}

// ---------- Orders ----------
export type OrderStatus = "pending" | "partially_paid" | "paid" | "overdue";

export interface Order {
  _id?: ObjectId;
  userId: ObjectId;
  customer: string;
  dueDate: string; // ISO date string YYYY-MM-DD
  lineItems: LineItem[];
  totalCents: Cents; // auto-computed: sum of (qty × unitPrice)
  paidCents: Cents; // maintained atomically via findOneAndUpdate
  createdAt: Date;
  updatedAt: Date;
}

// ---------- Payments ----------
export interface Payment {
  _id?: ObjectId;
  orderId: ObjectId;
  userId: ObjectId;
  amountCents: Cents; // >= 1 (min $0.01)
  date: string; // ISO date string YYYY-MM-DD
  note?: string;
  createdAt: Date;
}

// ---------- Users ----------
export interface User {
  _id?: ObjectId;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

// ---------- API Responses ----------
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface OrderWithStatus extends Omit<Order, "_id"> {
  _id: string;
  status: OrderStatus;
  paidCents: Cents;
  dueCents: Cents;
}
