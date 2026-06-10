/**
 * Hand-rolled local web server (U4).
 *
 * node:http only — no framework, bound to 127.0.0.1 (local-only is the auth
 * gate for v1). Routes are added by later units (reactions/notes/done);
 * `handleRequest` is the single extensible entry point so it can be unit-tested
 * on an ephemeral port without binding the real one.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { buildWeekView } from "../engine/week_view.js";
import { renderWeekHtml } from "./render_week.js";
import { handleReact, handleCorrect } from "./handlers.js";
import { todayIso } from "../age.js";

export const DEFAULT_WEB_PORT = 4317;

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = req.method ?? "GET";

    if (method === "GET" && url.pathname === "/") {
      // ?asOf= overrides the week for debugging/testing; defaults to today.
      const asOf = url.searchParams.get("asOf") ?? todayIso();
      const wv = buildWeekView(asOf);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(renderWeekHtml(wv));
      return;
    }

    if (method === "POST" && url.pathname === "/react") return await handleReact(req, res);
    if (method === "POST" && url.pathname === "/correct") return await handleCorrect(req, res);

    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  } catch (err) {
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" }).end("Internal error");
    console.error("web request error:", err);
  }
}

export function createWebServer(): Server {
  return createServer((req, res) => {
    void handleRequest(req, res);
  });
}
