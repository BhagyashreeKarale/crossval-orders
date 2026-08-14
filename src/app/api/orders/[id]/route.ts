import { NextRequest, NextResponse } from "next/server";
import { requireAuth, handleError, errorResponse } from "@/lib/api-utils";
import { updateOrderSchema } from "@/lib/validation";
import { getOrderById, updateOrder, deleteOrder } from "@/lib/orders.service";

// GET /api/orders/:id
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = requireAuth(req);
    if (authResult instanceof NextResponse) return authResult;

    const order = await getOrderById(params.id, authResult.userId);
    if (!order) {
      return errorResponse("ORDER_NOT_FOUND", "Order not found", 404);
    }

    return NextResponse.json({ order });
  } catch (err) {
    return handleError(err);
  }
}

// PATCH /api/orders/:id
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = requireAuth(req);
    if (authResult instanceof NextResponse) return authResult;

    const body = await req.json();
    const data = updateOrderSchema.parse(body);

    const order = await updateOrder(params.id, authResult.userId, data);
    if (!order) {
      return errorResponse("ORDER_NOT_FOUND", "Order not found", 404);
    }

    return NextResponse.json({ order });
  } catch (err) {
    return handleError(err);
  }
}

// DELETE /api/orders/:id
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = requireAuth(req);
    if (authResult instanceof NextResponse) return authResult;

    const deleted = await deleteOrder(params.id, authResult.userId);
    if (!deleted) {
      return errorResponse("ORDER_NOT_FOUND", "Order not found", 404);
    }

    return NextResponse.json({ message: "Order deleted" });
  } catch (err) {
    return handleError(err);
  }
}
