import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brainDumps } from "@/lib/db/schema";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { content } = await request.json();

    if (!content?.trim()) {
      return NextResponse.json(
        { error: "Content is required" },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();
    await db.insert(brainDumps).values({
      id,
      userId: session.user.id,
      content: content.trim(),
      type: "text",
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("Brain dump error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
