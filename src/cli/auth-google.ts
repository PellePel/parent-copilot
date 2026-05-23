/**
 * One-time Google OAuth flow.
 *
 * Spins up a temporary loopback HTTP server, opens a Google consent screen
 * URL, catches the redirect, exchanges the code for tokens, persists them to
 * data/google-token.json, and exits.
 *
 * Prerequisites: ./credentials.json exists (see README "Google Calendar
 * setup" for how to create it in Google Cloud Console).
 */

import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import {
  CALENDAR_SCOPES,
  CREDENTIALS_PATH,
  GoogleNotConfiguredError,
  TOKEN_PATH,
  buildOAuth2Client,
  saveToken,
} from "../lib/google.js";

async function main(): Promise<void> {
  let client;
  try {
    // Start the server first so we know the port before building the redirect URI.
    const { server, port, codePromise } = await startLoopbackServer();
    const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
    client = buildOAuth2Client(redirectUri);

    const authUrl = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent", // force refresh_token issuance
      scope: CALENDAR_SCOPES,
    });

    console.log("Open this URL in your browser to grant calendar access:");
    console.log("");
    console.log(authUrl);
    console.log("");
    console.log(`(Listening on ${redirectUri} — you'll be redirected here after granting access.)`);

    const code = await codePromise;
    server.close();

    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      console.error(
        "No refresh_token returned. This usually means you've already authorized this client before.",
        "Revoke access at https://myaccount.google.com/permissions and re-run.",
      );
      process.exit(1);
    }
    saveToken(tokens);
    console.log(`✓ Saved tokens to ${TOKEN_PATH}.`);
    console.log("You can now run `npm run generate-brief` and it'll include calendar context.");
  } catch (err) {
    if (err instanceof GoogleNotConfiguredError) {
      console.error(`Setup error: ${err.message}`);
      console.error(`Looking for ${CREDENTIALS_PATH} relative to ${process.cwd()}.`);
      process.exit(1);
    }
    throw err;
  }
}

function startLoopbackServer(): Promise<{
  server: ReturnType<typeof createServer>;
  port: number;
  codePromise: Promise<string>;
}> {
  return new Promise((resolveOuter, rejectOuter) => {
    let codeResolve: (code: string) => void = () => {};
    let codeReject: (err: Error) => void = () => {};
    const codePromise = new Promise<string>((res, rej) => {
      codeResolve = res;
      codeReject = rej;
    });

    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (!url.pathname.endsWith("/oauth2callback")) {
          res.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        if (error) {
          res.writeHead(400, { "Content-Type": "text/plain" }).end(`OAuth error: ${error}`);
          codeReject(new Error(`OAuth flow returned error: ${error}`));
          return;
        }
        if (!code) {
          res.writeHead(400, { "Content-Type": "text/plain" }).end("Missing ?code");
          codeReject(new Error("OAuth callback missing ?code parameter"));
          return;
        }
        res
          .writeHead(200, { "Content-Type": "text/html" })
          .end(
            "<html><body><h2>You can close this tab.</h2><p>parent-copilot has your calendar token.</p></body></html>",
          );
        codeResolve(code);
      } catch (err) {
        res.writeHead(500).end();
        codeReject(err as Error);
      }
    });

    server.on("error", (err) => rejectOuter(err));
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolveOuter({ server, port, codePromise });
    });
  });
}

await main();
