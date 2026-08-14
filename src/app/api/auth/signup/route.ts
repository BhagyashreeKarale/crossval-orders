import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hashPassword, signToken } from "@/lib/auth";
import { signupSchema } from "@/lib/validation";
import { handleError, errorResponse } from "@/lib/api-utils";
import { User } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = signupSchema.parse(body);

    const db = await getDb();

    // Insert with unique index handling — race-safe
    const passwordHash = await hashPassword(password);
    const user: User = {
      email: email.toLowerCase(),
      passwordHash,
      createdAt: new Date(),
    };

    let insertedId;
    try {
      const result = await db.collection("users").insertOne(user);
      insertedId = result.insertedId;
    } catch (err: unknown) {
      // Duplicate key error (unique index on email)
      if (err instanceof Error && "code" in err && (err as { code: number }).code === 11000) {
        return errorResponse(
          "EMAIL_EXISTS",
          "An account with this email already exists",
          409
        );
      }
      throw err;
    }

    const token = signToken({
      userId: insertedId.toString(),
      email: user.email,
    });

    const response = NextResponse.json(
      { user: { id: insertedId.toString(), email: user.email } },
      { status: 201 }
    );
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
