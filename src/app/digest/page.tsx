import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/SignOutButton";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { DigestContent } from "./DigestContent";

export default async function DigestPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "copilot") {
    redirect("/brain-dump");
  }

  // Get the copilot user to check if they have a partner
  const copilotUser = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .get();

  const hasPartner = !!copilotUser?.partnerId;

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Today&apos;s Digest</h1>
            <p className="text-sm text-gray-500">{today}</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-700">
              Settings
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6">
        <DigestContent hasPartner={hasPartner} />
      </main>
    </div>
  );
}
