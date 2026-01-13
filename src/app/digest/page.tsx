import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/SignOutButton";
import { db } from "@/lib/db";
import { brainDumps, users } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import Link from "next/link";

export default async function DigestPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "copilot") {
    redirect("/brain-dump");
  }

  // Get the copilot user to find their partner
  const copilotUser = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .get();

  // Get partner's recent brain dumps (last 3 days)
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  let recentDumps: { id: string; content: string; createdAt: Date | null }[] = [];

  if (copilotUser?.partnerId) {
    recentDumps = await db
      .select()
      .from(brainDumps)
      .where(eq(brainDumps.userId, copilotUser.partnerId))
      .orderBy(desc(brainDumps.createdAt))
      .limit(10);
  }

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

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Recent Mentions */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
            Recent Mentions
          </h2>
          {recentDumps.length > 0 ? (
            <div className="space-y-2">
              {recentDumps.map((dump) => (
                <div
                  key={dump.id}
                  className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm"
                >
                  <p className="text-gray-900 whitespace-pre-wrap">{dump.content}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    {dump.createdAt?.toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white p-6 rounded-xl border border-gray-200 text-center">
              <p className="text-gray-500">
                {copilotUser?.partnerId
                  ? "No recent thoughts from your partner yet."
                  : "Connect with your partner to see their thoughts here."}
              </p>
            </div>
          )}
        </section>

        {/* Consider This Week - AI generated (placeholder for now) */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
            Consider This Week
          </h2>
          <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
            <p className="text-blue-800 text-sm">
              AI-generated suggestions based on your family&apos;s patterns will appear here once we have more data.
            </p>
          </div>
        </section>

        {/* Coming Up Soon - placeholder */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
            Coming Up Soon
          </h2>
          <div className="bg-amber-50 p-4 rounded-xl border border-amber-100">
            <p className="text-amber-800 text-sm">
              Time-sensitive items will be highlighted here as your partner adds them.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
