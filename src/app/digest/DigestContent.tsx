"use client";

import { useEffect, useState } from "react";

interface RecentMention {
  content: string;
  date: string | null;
}

interface ConsiderItem {
  topic: string;
  summary: string;
  conversationStarter: string;
}

interface ComingUpItem {
  topic: string;
  urgency: "this_week" | "soon";
  context: string;
}

interface DigestData {
  recentMentions: RecentMention[];
  considerThisWeek: ConsiderItem[];
  comingUpSoon: ComingUpItem[];
}

export function DigestContent({ hasPartner }: { hasPartner: boolean }) {
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDigest() {
      try {
        const response = await fetch("/api/digest/generate");
        if (!response.ok) {
          throw new Error("Failed to fetch digest");
        }
        const data = await response.json();
        setDigest(data.digest);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }

    if (hasPartner) {
      fetchDigest();
    } else {
      setLoading(false);
    }
  }, [hasPartner]);

  if (!hasPartner) {
    return (
      <div className="space-y-6">
        <section className="bg-white p-6 rounded-xl border border-gray-200 text-center">
          <p className="text-gray-500">
            Connect with your partner in Settings to see their thoughts here.
          </p>
        </section>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <section className="space-y-3">
          <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
          <div className="bg-white p-4 rounded-xl border border-gray-200">
            <div className="space-y-2">
              <div className="h-4 bg-gray-100 rounded animate-pulse" />
              <div className="h-4 bg-gray-100 rounded animate-pulse w-3/4" />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="h-4 w-40 bg-gray-200 rounded animate-pulse" />
          <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
            <div className="flex items-center gap-2 text-blue-700">
              <svg
                className="w-5 h-5 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span className="text-sm">Analyzing your partner&apos;s thoughts...</span>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 p-4 rounded-xl border border-red-200">
        <p className="text-red-700">{error}</p>
      </div>
    );
  }

  if (!digest) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Recent Mentions */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
          Recent Mentions
        </h2>
        {digest.recentMentions.length > 0 ? (
          <div className="space-y-2">
            {digest.recentMentions.map((mention, index) => (
              <div
                key={index}
                className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm"
              >
                <p className="text-gray-900 whitespace-pre-wrap">
                  {mention.content}
                </p>
                {mention.date && (
                  <p className="text-xs text-gray-400 mt-2">{mention.date}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white p-6 rounded-xl border border-gray-200 text-center">
            <p className="text-gray-500">
              No recent thoughts from your partner yet.
            </p>
          </div>
        )}
      </section>

      {/* Consider This Week */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
          Consider This Week
        </h2>
        {digest.considerThisWeek.length > 0 ? (
          <div className="space-y-2">
            {digest.considerThisWeek.map((item, index) => (
              <div
                key={index}
                className="bg-blue-50 p-4 rounded-xl border border-blue-100"
              >
                <h3 className="font-medium text-blue-900">{item.topic}</h3>
                <p className="text-blue-800 text-sm mt-1">{item.summary}</p>
                <div className="mt-3 pt-3 border-t border-blue-200">
                  <p className="text-xs text-blue-600 uppercase tracking-wide mb-1">
                    Try saying
                  </p>
                  <p className="text-blue-800 text-sm italic">
                    &ldquo;{item.conversationStarter}&rdquo;
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
            <p className="text-blue-800 text-sm">
              No specific topics to discuss this week. Check back after your
              partner adds more thoughts!
            </p>
          </div>
        )}
      </section>

      {/* Coming Up Soon */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
          Coming Up Soon
        </h2>
        {digest.comingUpSoon.length > 0 ? (
          <div className="space-y-2">
            {digest.comingUpSoon.map((item, index) => (
              <div
                key={index}
                className="bg-amber-50 p-4 rounded-xl border border-amber-100"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium text-amber-900">{item.topic}</h3>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      item.urgency === "this_week"
                        ? "bg-amber-200 text-amber-800"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {item.urgency === "this_week" ? "This week" : "Soon"}
                  </span>
                </div>
                <p className="text-amber-800 text-sm mt-1">{item.context}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-amber-50 p-4 rounded-xl border border-amber-100">
            <p className="text-amber-800 text-sm">
              Nothing time-sensitive right now.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
