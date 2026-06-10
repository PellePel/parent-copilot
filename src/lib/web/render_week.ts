/**
 * Server-rendered HTML for the week view (U4).
 *
 * One self-contained document with inline CSS — no client framework, no build
 * step, consistent with the repo's zero-frontend-tooling posture. The page
 * leads with the hero forecast, then the rest of the non-calendar items, then
 * the calendar strip, then note-derived actions. Engagement controls
 * (reactions, notes, done) are layered on in later units.
 */

import { randomUUID } from "node:crypto";
import type { WeekView, WeekViewItem, NoteActionView } from "../engine/week_view.js";

/** The four reaction controls (R6) — clear labels replacing the confusing buttons. */
function controls(briefItemId: number): string {
  return `
    <div class="controls" data-brief-item="${briefItemId}" data-nonce="${randomUUID()}">
      <button data-react="handled">Handled</button>
      <button data-react="already_knew">Already knew</button>
      <button data-react="tell_more">Why this?</button>
      <button data-react="wrong">Wrong</button>
      <div class="correction" hidden>
        <textarea rows="2" placeholder="What is actually true?"></textarea>
        <button data-correct>Send correction</button>
      </div>
      <span class="ack" role="status"></span>
    </div>`;
}

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
    ${controls(hero.briefItemId)}
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
      ${controls(it.briefItemId)}
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
      ${controls(it.briefItemId)}
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
  .controls { margin-top:12px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .controls button { font:inherit; font-size:13px; padding:5px 12px; border:1px solid var(--line);
    background:#fff; color:var(--ink); border-radius:999px; cursor:pointer; }
  .controls button:hover { border-color:var(--accent); color:var(--accent); }
  .controls button:disabled { opacity:.45; cursor:default; }
  .correction { flex-basis:100%; display:flex; gap:8px; margin-top:6px; }
  .correction textarea { flex:1; font:inherit; font-size:14px; padding:8px; border:1px solid var(--line); border-radius:8px; resize:vertical; }
  .ack { flex-basis:100%; color:var(--accent); font-size:13px; min-height:1em; }
`;

// Vanilla client: posts reactions/corrections, disables controls after use,
// and reveals the correction box for "wrong". No framework, no build step.
// Kept apostrophe-free so it embeds cleanly in the template literal.
const SCRIPT = `
<script>
document.querySelectorAll('.controls').forEach(function(box){
  var id = Number(box.dataset.briefItem), nonce = box.dataset.nonce;
  var ack = box.querySelector('.ack'), reactionId = null;
  function post(url, payload){
    return fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) })
      .then(function(r){ return r.json(); });
  }
  function lock(){ box.querySelectorAll('button[data-react]').forEach(function(b){ b.disabled = true; }); }
  function unlock(){ box.querySelectorAll('button[data-react]').forEach(function(b){ b.disabled = false; }); }
  box.querySelectorAll('button[data-react]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var reaction = btn.dataset.react;
      lock();
      post('/react', { briefItemId:id, reaction:reaction, nonce:nonce }).then(function(res){
        if(!res || !res.ok){ ack.textContent = 'That did not take.'; unlock(); return; }
        reactionId = res.reactionId;
        if(reaction === 'tell_more'){ ack.textContent = res.reasoning || 'No extra detail.'; unlock(); return; }
        if(reaction === 'wrong'){ box.querySelector('.correction').hidden = false; ack.textContent = 'What should it say?'; return; }
        ack.textContent = reaction === 'handled' ? 'Got it.' : 'Noted.';
      }).catch(function(){ ack.textContent = 'Network hiccup.'; unlock(); });
    });
  });
  var cbtn = box.querySelector('button[data-correct]');
  if(cbtn){ cbtn.addEventListener('click', function(){
    var ta = box.querySelector('textarea'), text = (ta.value || '').trim();
    if(!text || reactionId == null) return;
    cbtn.disabled = true;
    post('/correct', { reactionId:reactionId, text:text }).then(function(res){
      ack.textContent = (res && res.ok) ? 'Thanks, I will fix that.' : 'Could not save that.';
      box.querySelector('.correction').hidden = true;
    }).catch(function(){ ack.textContent = 'Network hiccup.'; cbtn.disabled = false; });
  }); }
});
</script>`;

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
</main>${SCRIPT}</body></html>`;
}
