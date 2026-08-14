// ---------- Request/Response types ----------

interface CreateOrderPayload {
  customer: string;
  dueDate: string;
  lineItems: { description: string; quantity: number; unitPriceCents: number }[];
}

interface UpdateOrderPayload {
  customer?: string;
  dueDate?: string;
  lineItems?: { description: string; quantity: number; unitPriceCents: number }[];
}

interface RecordPaymentPayload {
  amountCents: number;
  date: string;
  note?: string;
}

export class ApiRequestError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    status: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    this.name = "ApiRequestError";
  }
}

// ---------- Request helper ----------

async function request(url: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: "include", // Browser sends httpOnly cookie automatically
  });

  const data = await res.json();

  if (!res.ok) {
    throw new ApiRequestError(
      data.message || "Request failed",
      data.code || "UNKNOWN_ERROR",
      res.status,
      data.details
    );
  }
  return data;
}

// ---------- API methods ----------

export const api = {
  // Orders
  getOrders: (status?: string) =>
    request(`/api/orders${status ? `?status=${status}` : ""}`),

  getOrder: (id: string) =>
    request(`/api/orders/${id}`),

  createOrder: (data: CreateOrderPayload) =>
    request("/api/orders", { method: "POST", body: JSON.stringify(data) }),

  updateOrder: (id: string, data: UpdateOrderPayload) =>
    request(`/api/orders/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  deleteOrder: (id: string) =>
    request(`/api/orders/${id}`, { method: "DELETE" }),

  // Payments
  getPayments: (orderId: string) =>
    request(`/api/orders/${orderId}/payments`),

  recordPayment: (orderId: string, data: RecordPaymentPayload) =>
    request(`/api/orders/${orderId}/payments`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
