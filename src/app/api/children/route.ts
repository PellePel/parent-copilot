import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { children } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// GET - List all children for the current user
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userChildren = await db
      .select()
      .from(children)
      .where(eq(children.userId, session.user.id));

    return NextResponse.json({ children: userChildren });
  } catch (error) {
    console.error("Get children error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST - Add a new child
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name, birthDate, sex } = await request.json();

    if (!name?.trim() || !birthDate) {
      return NextResponse.json(
        { error: "Name and birth date are required" },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();
    await db.insert(children).values({
      id,
      userId: session.user.id,
      name: name.trim(),
      birthDate,
      sex: sex || null,
    });

    const newChild = await db
      .select()
      .from(children)
      .where(eq(children.id, id))
      .get();

    return NextResponse.json({ success: true, child: newChild });
  } catch (error) {
    console.error("Add child error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT - Update a child
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, name, birthDate, sex } = await request.json();

    if (!id) {
      return NextResponse.json(
        { error: "Child ID is required" },
        { status: 400 }
      );
    }

    // Verify the child belongs to this user
    const existingChild = await db
      .select()
      .from(children)
      .where(and(eq(children.id, id), eq(children.userId, session.user.id)))
      .get();

    if (!existingChild) {
      return NextResponse.json({ error: "Child not found" }, { status: 404 });
    }

    await db
      .update(children)
      .set({
        name: name?.trim() || existingChild.name,
        birthDate: birthDate || existingChild.birthDate,
        sex: sex !== undefined ? sex : existingChild.sex,
      })
      .where(eq(children.id, id));

    const updatedChild = await db
      .select()
      .from(children)
      .where(eq(children.id, id))
      .get();

    return NextResponse.json({ success: true, child: updatedChild });
  } catch (error) {
    console.error("Update child error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE - Remove a child
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await request.json();

    if (!id) {
      return NextResponse.json(
        { error: "Child ID is required" },
        { status: 400 }
      );
    }

    // Verify the child belongs to this user
    const existingChild = await db
      .select()
      .from(children)
      .where(and(eq(children.id, id), eq(children.userId, session.user.id)))
      .get();

    if (!existingChild) {
      return NextResponse.json({ error: "Child not found" }, { status: 404 });
    }

    await db.delete(children).where(eq(children.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete child error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
