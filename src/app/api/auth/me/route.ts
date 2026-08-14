import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { errorResponse } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  const user = authenticate(req);
  if (!user) {
    return errorResponse("UNAUTHORIZED", "Authentication required", 401);
  }

  return NextResponse.json({
    user: { id: user.userId, email: user.email },
  });
}
