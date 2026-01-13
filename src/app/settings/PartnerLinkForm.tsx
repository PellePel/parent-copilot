"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PartnerLinkForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!email.trim()) return;

    setLoading(true);
    try {
      const res = await fetch("/api/partner/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerEmail: email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to link partner");
      } else {
        setSuccess(`Connected with ${data.partnerName || email}!`);
        setEmail("");
        router.refresh();
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-gray-500 text-sm">
        Enter your partner&apos;s email to connect your accounts.
      </p>

      {error && (
        <div className="bg-red-50 text-red-600 p-2 rounded-lg text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 text-green-600 p-2 rounded-lg text-sm">
          {success}
        </div>
      )}

      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="partner@example.com"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />

      <button
        type="submit"
        disabled={loading || !email.trim()}
        className="w-full py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
      >
        {loading ? "Linking..." : "Link Partner"}
      </button>
    </form>
  );
}
