import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function Home() {
  const session = await auth();

  // If logged in, redirect based on role
  if (session?.user) {
    if (session.user.role === "primary_planner") {
      redirect("/brain-dump");
    } else {
      redirect("/digest");
    }
  }

  // Landing page for logged out users
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full text-center space-y-8">
        <div>
          <h1 className="text-4xl font-bold text-gray-900">Copilot</h1>
          <p className="mt-4 text-lg text-gray-600">
            A mental model builder for co-parents
          </p>
        </div>

        <div className="space-y-4">
          <p className="text-gray-500">
            Help your partner stay in the loop and become a more proactive co-planner.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Link
            href="/signup"
            className="w-full py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
          >
            Get Started
          </Link>
          <Link
            href="/login"
            className="w-full py-3 px-4 border border-gray-300 rounded-lg shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
          >
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
