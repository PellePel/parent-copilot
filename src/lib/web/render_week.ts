/**
 * Server-rendered HTML for the week view (U4).
 *
 * One self-contained document with inline CSS — no client framework, no build
 * step, consistent with the repo's zero-frontend-tooling posture. The page
 * leads with the hero forecast, then the rest of the non-calendar items, then
 * the calendar strip, then note-derived actions. Engagement controls
 * (reactions, notes, done) are layered on in later units.
 */

import type { WeekView, WeekViewItem, NoteActionView } from "../engine/week_view.js";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function kidTag(it: WeekViewItem): string {
  return it.kidName ? `<span class="kid">${escapeHtml(it.kidName)}</span>` : `<span class="kid family">Family</span>`;
}

function actionLine(it: WeekViewItem): string {
  return it.suggestedAction ? `<p class="action">→ ${escapeHtml(it.suggestedAction)}</p>` : "";
}

function heroCard(hero: WeekViewItem | null): string {
  if (!hero) {
    return `<section class="hero empty"><p>Nothing new to flag this week. Enjoy the calm.</p></section>`;
  }
  return `
  <section class="hero" data-brief-item="${hero.briefItemId}">
    <div class="eyebrow">This week's one thing ${kidTag(hero)}</div>
    <h1>${escapeHtml(hero.headline)}</h1>
    <p class="body">${escapeHtml(hero.body)}</p>
    ${actionLine(hero)}
  </section>`;
}

function moreList(items: WeekViewItem[]): string {
  if (items.length === 0) return "";
  const rows = items
    .map(
      (it) => `
    <li data-brief-item="${it.briefItemId}">
      <div class="row-head">${kidTag(it)} <strong>${escapeHtml(it.headline)}</strong></div>
      <p class="body">${escapeHtml(it.body)}</p>
      ${actionLine(it)}
    </li>`,
    )
    .join("");
  return `<section class="more"><h2>Also worth knowing</h2><ul>${rows}</ul></section>`;
}

function stripList(items: WeekViewItem[]): string {
  if (items.length === 0) return "";
  const rows = items
    .map(
      (it) => `
    <li data-brief-item="${it.briefItemId}">
      ${kidTag(it)} <strong>${escapeHtml(it.headline)}</strong>
      <p class="body">${escapeHtml(it.body)}</p>
    </li>`,
    )
    .join("");
  return `<section class="strip"><h2>On the calendar</h2><ul>${rows}</ul></section>`;
}

function actionsList(actions: NoteActionView[]): string {
  if (actions.length === 0) return "";
  const rows = actions
    .map(
      (a) => `
    <li data-note-action="${a.id}" data-kind="${a.actionKind}">
      <p class="forecast">${escapeHtml(a.forecastText)}</p>
      <p class="action">→ ${escapeHtml(a.actionText)}</p>
    </li>`,
    )
    .join("");
  return `<section class="actions"><h2>From your notes</h2><ul>${rows}</ul></section>`;
}

const STYLE = `
  :root { --bg:#faf8f5; --ink:#1f1d1a; --muted:#6b655c; --accent:#b4541e; --card:#fff; --line:#e8e2d8; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  main { max-width:680px; margin:0 auto; padding:32px 20px 80px; }
  .topline { color:var(--muted); font-size:14px; letter-spacing:.02em; margin-bottom:20px; }
  .hero { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:28px 26px;
    box-shadow:0 1px 2px rgba(0,0,0,.03); }
  .hero.empty { color:var(--muted); text-align:center; padding:40px 26px; }
  .eyebrow { font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--accent); margin-bottom:10px; }
  .hero h1 { font-size:26px; line-height:1.25; margin:.1em 0 .4em; }
  .body { color:var(--ink); margin:.3em 0; }
  .action { color:var(--accent); font-weight:600; margin:.5em 0 0; }
  h2 { font-size:14px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:32px 0 10px; }
  ul { list-style:none; margin:0; padding:0; }
  .more li, .strip li, .actions li { background:var(--card); border:1px solid var(--line);
    border-radius:12px; padding:16px 18px; margin-bottom:10px; }
  .row-head { margin-bottom:4px; }
  .kid { display:inline-block; font-size:12px; font-weight:600; color:var(--accent);
    background:#f6e9df; border-radius:999px; padding:1px 9px; margin-right:6px; vertical-align:1px; }
  .kid.family { color:var(--muted); background:#eee9e1; }
  .strip .body, .more .body { color:var(--muted); font-size:15px; }
`;

export function renderWeekHtml(wv: WeekView): string {
  const heading = wv.weekOf ? `Week of ${escapeHtml(wv.weekOf)}` : "This week";
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Copilot — ${heading}</title>
  <style>${STYLE}</style>
</head><body><main>
  <div class="topline">${heading}</div>
  ${heroCard(wv.hero)}
  ${actionsList(wv.actions)}
  ${moreList(wv.more)}
  ${stripList(wv.strip)}
</main></body></html>`;
}
