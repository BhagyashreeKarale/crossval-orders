import { NextRequest, NextResponse } from "next/server";
import { requireAuth, handleError } from "@/lib/api-utils";
import { recordPaymentSchema } from "@/lib/validation";
import { recordPayment, getPaymentsForOrder } from "@/lib/orders.service";

// GET /api/orders/:id/payments
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = requireAuth(req);
    if (authResult instanceof NextResponse) return authResult;

    const payments = await getPaymentsForOrder(params.id, authResult.userId);
    return NextResponse.json({
      payments: payments.map((p) => ({
        ...p,
        _id: p._id!.toString(),
        orderId: p.orderId.toString(),
        userId: p.userId.toString(),
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

// POST /api/orders/:id/payments
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = requireAuth(req);
    if (authResult instanceof NextResponse) return authResult;

    const body = await req.json();
    const data = recordPaymentSchema.parse(body);

    const payment = await recordPayment(
      params.id,
      authResult.userId,
      data.amountCents,
      data.date,
      data.note
    );

    return NextResponse.json(
      {
        payment: {
          ...payment,
          _id: payment._id!.toString(),
          orderId: payment.orderId.toString(),
          userId: payment.userId.toString(),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return handleError(err);
  }
}
