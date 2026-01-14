"use client";

import { useState, useEffect } from "react";

interface Child {
  id: string;
  name: string;
  birthDate: string;
  sex: "male" | "female" | "other" | null;
}

function calculateAge(birthDate: string): string {
  const birth = new Date(birthDate);
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();

  if (months < 0) {
    years--;
    months += 12;
  }

  if (years === 0) {
    return `${months} month${months !== 1 ? "s" : ""}`;
  }
  if (months === 0) {
    return `${years} year${years !== 1 ? "s" : ""}`;
  }
  return `${years}y ${months}m`;
}

export function ChildrenManager() {
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingChild, setEditingChild] = useState<Child | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [sex, setSex] = useState<"male" | "female" | "other" | "">("");

  useEffect(() => {
    fetchChildren();
  }, []);

  async function fetchChildren() {
    try {
      const response = await fetch("/api/children");
      if (response.ok) {
        const data = await response.json();
        setChildren(data.children);
      }
    } catch (error) {
      console.error("Failed to fetch children:", error);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setName("");
    setBirthDate("");
    setSex("");
    setEditingChild(null);
    setShowForm(false);
  }

  function startEdit(child: Child) {
    setEditingChild(child);
    setName(child.name);
    setBirthDate(child.birthDate);
    setSex(child.sex || "");
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !birthDate) return;

    setSaving(true);
    try {
      const method = editingChild ? "PUT" : "POST";
      const body = editingChild
        ? { id: editingChild.id, name, birthDate, sex: sex || null }
        : { name, birthDate, sex: sex || null };

      const response = await fetch("/api/children", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        await fetchChildren();
        resetForm();
      }
    } catch (error) {
      console.error("Failed to save child:", error);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to remove this child?")) return;

    try {
      const response = await fetch("/api/children", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (response.ok) {
        setChildren(children.filter((c) => c.id !== id));
      }
    } catch (error) {
      console.error("Failed to delete child:", error);
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-4 bg-gray-200 rounded w-1/3" />
        <div className="h-10 bg-gray-100 rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Children List */}
      {children.length > 0 && (
        <div className="space-y-2">
          {children.map((child) => (
            <div
              key={child.id}
              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
            >
              <div>
                <p className="font-medium text-gray-900">{child.name}</p>
                <p className="text-sm text-gray-500">
                  {calculateAge(child.birthDate)}
                  {child.sex && (
                    <span className="ml-2 text-gray-400">
                      · {child.sex === "male" ? "Boy" : child.sex === "female" ? "Girl" : "Other"}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => startEdit(child)}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(child.id)}
                  className="text-sm text-red-600 hover:text-red-800"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Form */}
      {showForm ? (
        <form onSubmit={handleSubmit} className="space-y-3 p-3 bg-blue-50 rounded-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Child's name"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Birth Date
            </label>
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sex
            </label>
            <select
              value={sex}
              onChange={(e) => setSex(e.target.value as typeof sex)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">Not specified</option>
              <option value="male">Boy</option>
              <option value="female">Girl</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || !name.trim() || !birthDate}
              className="flex-1 py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : editingChild ? "Update" : "Add Child"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="py-2 px-4 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-2 px-4 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
        >
          + Add a child
        </button>
      )}

      {children.length === 0 && !showForm && (
        <p className="text-sm text-gray-500 text-center">
          Add your children to get age-appropriate suggestions in the digest.
        </p>
      )}
    </div>
  );
}
