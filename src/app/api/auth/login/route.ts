import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyPassword, signToken } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";
import { handleError, errorResponse } from "@/lib/api-utils";
import { User } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = loginSchema.parse(body);

    const db = await getDb();
    const user = await db
      .collection<User>("users")
      .findOne({ email: email.toLowerCase() });

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return errorResponse(
        "INVALID_CREDENTIALS",
        "Invalid email or password",
        401
      );
    }

    const token = signToken({
      userId: user._id!.toString(),
      email: user.email,
    });

    // JWT is stored ONLY in the httpOnly cookie — never exposed to JavaScript
    const response = NextResponse.json({
      user: { id: user._id!.toString(), email: user.email },
    });
    response.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });
    return response;
  } catch (err) {
    return handleError(err);
  }
}
