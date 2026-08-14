import { NextRequest, NextResponse } from "next/server";
import { requireAuth, handleError } from "@/lib/api-utils";
import { createOrderSchema } from "@/lib/validation";
import { createOrder, listOrders } from "@/lib/orders.service";
import { OrderStatus } from "@/lib/types";

// GET /api/orders?status=pending|partially_paid|paid|overdue
export async function GET(req: NextRequest) {
  try {
    const authResult = requireAuth(req);
    if (authResult instanceof NextResponse) return authResult;

    const statusParam = req.nextUrl.searchParams.get("status");
    const validStatuses: OrderStatus[] = [
      "pending",
      "partially_paid",
      "paid",
      "overdue",
    ];
    const statusFilter =
      statusParam && validStatuses.includes(statusParam as OrderStatus)
        ? (statusParam as OrderStatus)
        : undefined;

    const orders = await listOrders(authResult.userId, statusFilter);
    return NextResponse.json({ orders });
  } catch (err) {
    return handleError(err);
  }
}

// POST /api/orders
export async function POST(req: NextRequest) {
  try {
    const authResult = requireAuth(req);
    if (authResult instanceof NextResponse) return authResult;

    const body = await req.json();
    const data = createOrderSchema.parse(body);

    const order = await createOrder(
      authResult.userId,
      data.customer,
      data.dueDate,
      data.lineItems
    );

    return NextResponse.json(
      { order: { ...order, _id: order._id!.toString() } },
      { status: 201 }
    );
  } catch (err) {
    return handleError(err);
  }
}
