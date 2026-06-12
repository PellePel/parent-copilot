/**
 * web CLI — the long-running local week-view server.
 *
 * Run with `npm run web`. Binds 127.0.0.1 only; the link the Sunday Telegram
 * nudge points at. Provisional-until-PMF: no auth, local hosting is the gate.
 */

import { createWebServer, DEFAULT_WEB_PORT } from "../lib/web/server.js";

const port = Number(process.env.COPILOT_WEB_PORT) || DEFAULT_WEB_PORT;
const server = createWebServer();

server.listen(port, "127.0.0.1", () => {
  console.log(`Copilot week view on http://127.0.0.1:${port}/ (Ctrl-C to stop)`);
});

server.on("error", (err) => {
  console.error("Failed to start web server:", err);
  process.exit(1);
});
