import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { SignOutButton } from "@/components/SignOutButton";
import { PartnerLinkForm } from "./PartnerLinkForm";
import { ChildrenManager } from "./ChildrenManager";
import Link from "next/link";

export default async function SettingsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .get();

  let partner = null;
  if (user?.partnerId) {
    partner = await db
      .select()
      .from(users)
      .where(eq(users.id, user.partnerId))
      .get();
  }

  const homeLink = session.user.role === "primary_planner" ? "/brain-dump" : "/digest";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
            <p className="text-sm text-gray-500">Manage your account</p>
          </div>
          <SignOutButton />
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Account Info */}
        <section className="bg-white p-4 rounded-xl border border-gray-200">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Your Account
          </h2>
          <div className="space-y-2">
            <p className="text-gray-900">{user?.name || "No name set"}</p>
            <p className="text-gray-500 text-sm">{user?.email}</p>
            <p className="text-sm">
              <span className="inline-block px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                {user?.role === "primary_planner" ? "Primary Planner" : "Copilot"}
              </span>
            </p>
          </div>
        </section>

        {/* Partner Section */}
        <section className="bg-white p-4 rounded-xl border border-gray-200">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Your Partner
          </h2>
          {partner ? (
            <div className="space-y-2">
              <p className="text-gray-900">{partner.name || "No name set"}</p>
              <p className="text-gray-500 text-sm">{partner.email}</p>
              <p className="text-sm text-green-600">Connected</p>
            </div>
          ) : (
            <PartnerLinkForm />
          )}
        </section>

        {/* Children Section - Only show for primary planners */}
        {session.user.role === "primary_planner" && (
          <section className="bg-white p-4 rounded-xl border border-gray-200">
            <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
              Your Children
            </h2>
            <ChildrenManager />
          </section>
        )}

        {/* Navigation */}
        <Link
          href={homeLink}
          className="block w-full text-center py-3 px-4 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Back to {session.user.role === "primary_planner" ? "Brain Dump" : "Digest"}
        </Link>
      </main>
    </div>
  );
}
