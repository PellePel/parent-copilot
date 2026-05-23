/**
 * Google OAuth2 client + token storage.
 *
 * V1 uses the "Installed/Desktop application" OAuth flow with a loopback
 * redirect. One-time setup is done via `npm run auth:google`; this module
 * provides the building blocks.
 *
 * File layout:
 *   ./credentials.json         — OAuth client credentials downloaded from
 *                                 Google Cloud Console. NEVER committed.
 *   ./data/google-token.json   — Refresh token persisted after first auth.
 *                                 Also never committed.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { OAuth2Client } from "google-auth-library";

const CREDENTIALS_PATH = "./credentials.json";
const TOKEN_PATH = "./data/google-token.json";

/** Read-only scope on the user's own Google Calendar. */
export const CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];

type InstalledCredentials = {
  installed?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
  web?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
};

export class GoogleNotConfiguredError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "GoogleNotConfiguredError";
  }
}

/** Load credentials.json. Throws GoogleNotConfiguredError if missing. */
export function loadCredentials(): { clientId: string; clientSecret: string } {
  if (!existsSync(CREDENTIALS_PATH)) {
    throw new GoogleNotConfiguredError(
      `${CREDENTIALS_PATH} not found. See README ("Google Calendar setup") for how to create OAuth credentials and download this file.`,
    );
  }
  const raw = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8")) as InstalledCredentials;
  const block = raw.installed ?? raw.web;
  if (!block?.client_id || !block.client_secret) {
    throw new GoogleNotConfiguredError(
      `${CREDENTIALS_PATH} doesn't look like a valid OAuth client credentials file (missing client_id/client_secret). Re-download from Google Cloud Console.`,
    );
  }
  return { clientId: block.client_id, clientSecret: block.client_secret };
}

/**
 * Build an OAuth2 client. `redirectUri` is required during the initial auth
 * flow (the loopback server in auth-google.ts); for subsequent API calls it
 * can be omitted because the refresh-token flow doesn't use it.
 */
export function buildOAuth2Client(redirectUri?: string): OAuth2Client {
  const { clientId, clientSecret } = loadCredentials();
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

/**
 * Returns an authorized OAuth2Client ready for API calls, or throws
 * GoogleNotConfiguredError if no token has been saved yet.
 */
export function getAuthorizedClient(): OAuth2Client {
  if (!existsSync(TOKEN_PATH)) {
    throw new GoogleNotConfiguredError(
      `${TOKEN_PATH} not found. Run \`npm run auth:google\` to grant calendar access.`,
    );
  }
  const client = buildOAuth2Client();
  client.setCredentials(JSON.parse(readFileSync(TOKEN_PATH, "utf8")));
  return client;
}

/** Persist a refresh token after a successful auth flow. */
export function saveToken(token: object): void {
  writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2), "utf8");
}

export { CREDENTIALS_PATH, TOKEN_PATH };
