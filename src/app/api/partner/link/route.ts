import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { partnerEmail } = await request.json();

    if (!partnerEmail?.trim()) {
      return NextResponse.json(
        { error: "Partner email is required" },
        { status: 400 }
      );
    }

    // Find the partner
    const partner = await db
      .select()
      .from(users)
      .where(eq(users.email, partnerEmail.trim().toLowerCase()))
      .get();

    if (!partner) {
      return NextResponse.json(
        { error: "No user found with that email" },
        { status: 404 }
      );
    }

    if (partner.id === session.user.id) {
      return NextResponse.json(
        { error: "You cannot link to yourself" },
        { status: 400 }
      );
    }

    // Link both users to each other
    await db
      .update(users)
      .set({ partnerId: partner.id })
      .where(eq(users.id, session.user.id));

    await db
      .update(users)
      .set({ partnerId: session.user.id })
      .where(eq(users.id, partner.id));

    return NextResponse.json({ success: true, partnerName: partner.name });
  } catch (error) {
    console.error("Partner link error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
