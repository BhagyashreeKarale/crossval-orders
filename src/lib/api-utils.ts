import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { authenticate, JwtPayload } from "./auth";
import { PaymentError, OrderLockedError } from "./orders.service";

export function errorResponse(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>
) {
  return NextResponse.json({ code, message, ...details }, { status });
}

export function handleError(err: unknown) {
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({
      field: i.path.join("."),
      message: i.message,
    }));
    return errorResponse(
      "VALIDATION_ERROR",
      "Request validation failed",
      400,
      { errors: issues }
    );
  }
  if (err instanceof PaymentError) {
    return errorResponse(err.code, err.message, 422, err.details);
  }
  if (err instanceof OrderLockedError) {
    return errorResponse(err.code, err.message, 409);
  }
  console.error("Unhandled error:", err);
  return errorResponse(
    "INTERNAL_ERROR",
    "An unexpected error occurred",
    500
  );
}

export function requireAuth(
  req: NextRequest
): JwtPayload | NextResponse {
  const user = authenticate(req);
  if (!user) {
    return errorResponse("UNAUTHORIZED", "Authentication required", 401);
  }
  return user;
}
