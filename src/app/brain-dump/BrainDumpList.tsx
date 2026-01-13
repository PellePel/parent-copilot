import { db } from "@/lib/db";
import { brainDumps } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function BrainDumpList({ userId }: { userId: string }) {
  const dumps = await db
    .select()
    .from(brainDumps)
    .where(eq(brainDumps.userId, userId))
    .orderBy(desc(brainDumps.createdAt))
    .limit(20);

  if (dumps.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>No thoughts yet. Start dumping!</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
        Recent thoughts
      </h2>
      <div className="space-y-2">
        {dumps.map((dump) => (
          <div
            key={dump.id}
            className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm"
          >
            <p className="text-gray-900 whitespace-pre-wrap">{dump.content}</p>
            <p className="text-xs text-gray-400 mt-2">
              {formatRelativeTime(dump.createdAt)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatRelativeTime(date: Date | null): string {
  if (!date) return "";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}
