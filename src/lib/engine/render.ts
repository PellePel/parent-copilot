/**
 * Brief renderers — markdown (for the briefs/ output file) and plain text
 * (for console output). Both consume an AssembledBrief.
 */

import { listKids } from "../kids.js";
import type { BriefItem } from "../db/schema.js";
import type { AssembledBrief } from "./assembler.js";

function kidNameMap(): Map<number, string> {
  return new Map(listKids().map((k) => [k.id, k.name]));
}

function confidenceTag(c: BriefItem["confidence"]): string {
  return `[conf: ${c}]`;
}

export function renderMarkdown(b: AssembledBrief): string {
  const names = kidNameMap();
  const date = b.brief.weekOf;
  const lines: string[] = [];
  lines.push(`# Weekly brief — week of ${date}`);
  lines.push("");
  lines.push(
    `_Recipients: ${b.brief.recipients.join(", ")}. ${b.items.length} item${
      b.items.length === 1 ? "" : "s"
    }._`,
  );
  lines.push("");

  if (b.items.length === 0) {
    lines.push("_No items this week._");
    return lines.join("\n");
  }

  for (const item of b.items) {
    const who = item.kidId ? `**${names.get(item.kidId) ?? `kid ${item.kidId}`}.** ` : "";
    lines.push(`## ${item.priority}. ${item.headline}`);
    lines.push("");
    lines.push(`${who}${item.body}`);
    lines.push("");
    if (item.suggestedAction) {
      lines.push(`> ${item.suggestedAction}`);
      lines.push("");
    }
    lines.push(
      `<sub>${item.triggerSource} · ${item.triggerDetail} · ${confidenceTag(
        item.confidence,
      )}</sub>`,
    );
    lines.push("");
    lines.push(`<details><summary>Why this fired</summary>\n\n${item.reasoning}\n\n</details>`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderConsole(b: AssembledBrief): string {
  const names = kidNameMap();
  const lines: string[] = [];
  lines.push(`Weekly brief — week of ${b.brief.weekOf}`);
  lines.push(`Recipients: ${b.brief.recipients.join(", ")}`);
  lines.push("=".repeat(60));
  if (b.items.length === 0) {
    lines.push("No items this week.");
    return lines.join("\n");
  }
  for (const item of b.items) {
    const who = item.kidId ? `${names.get(item.kidId) ?? `kid ${item.kidId}`} — ` : "";
    lines.push("");
    lines.push(`${item.priority}. ${who}${item.headline}`);
    lines.push(`   ${item.body}`);
    if (item.suggestedAction) lines.push(`   → ${item.suggestedAction}`);
    lines.push(
      `   [${item.triggerSource} · ${item.triggerDetail} · conf: ${item.confidence}]`,
    );
  }
  if (b.dropped.length > 0) {
    lines.push("");
    lines.push(`(${b.dropped.length} candidate(s) dropped during dedup/ranking)`);
  }
  return lines.join("\n");
}
