import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { BrainDumpForm } from "./BrainDumpForm";
import { BrainDumpList } from "./BrainDumpList";
import { SignOutButton } from "@/components/SignOutButton";
import Link from "next/link";

export default async function BrainDumpPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "primary_planner") {
    redirect("/digest");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Brain Dump</h1>
            <p className="text-sm text-gray-500">What&apos;s on your mind?</p>
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
        <BrainDumpForm userId={session.user.id} />
        <BrainDumpList userId={session.user.id} />
      </main>
    </div>
  );
}
