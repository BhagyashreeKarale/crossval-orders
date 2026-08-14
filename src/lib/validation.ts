import { z } from "zod";

export const lineItemSchema = z.object({
  description: z.string().min(1, "Description is required"),
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
  unitPriceCents: z.number().int().min(0, "Unit price must be non-negative"),
});

export const createOrderSchema = z.object({
  customer: z.string().min(1, "Customer name is required"),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Due date must be YYYY-MM-DD format"),
  lineItems: z
    .array(lineItemSchema)
    .min(1, "At least one line item is required"),
});

export const updateOrderSchema = z.object({
  customer: z.string().min(1).optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Due date must be YYYY-MM-DD format")
    .optional(),
  lineItems: z.array(lineItemSchema).min(1).optional(),
});

export const recordPaymentSchema = z.object({
  amountCents: z
    .number()
    .int()
    .min(1, "Payment amount must be at least $0.01 (1 cent)"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Payment date must be YYYY-MM-DD format"),
  note: z.string().optional(),
});

export const signupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});
