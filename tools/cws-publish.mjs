#!/usr/bin/env node
// Uploads a zip to the Chrome Web Store (API v2) and submits it for review.
// No dependencies: Node 20+ (global fetch, node:crypto).
//
// Usage:  node tools/cws-publish.mjs dist/glow-para-promiedos-<version>.zip
// Env:    CWS_SERVICE_ACCOUNT_JSON  service account key (JSON text)
//         CWS_PUBLISHER_ID          publisher ID (Developer Dashboard > Publisher > Settings)
//         CWS_EXTENSION_ID          extension ID
//
// Secrets (key, JWT, access token) are never printed.
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

const SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const API = "https://chromewebstore.googleapis.com";
const POLL_EVERY_MS = 10_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

const fail = (msg) => {
  console.error(`error: ${msg}`);
  process.exit(1);
};

const b64url = (input) => Buffer.from(input).toString("base64url");

function need(name) {
  const value = process.env[name];
  if (!value || !value.trim()) fail(`missing environment variable ${name}`);
  return value;
}

// Truncated body for error messages (API errors carry no credentials).
async function describe(res) {
  const text = await res.text().catch(() => "");
  return `HTTP ${res.status} ${res.statusText} ${text.slice(0, 800)}`.trim();
}

async function getAccessToken(key) {
  for (const field of ["client_email", "private_key", "token_uri"]) {
    if (typeof key[field] !== "string" || !key[field]) fail(`service account JSON has no "${field}"`);
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: key.token_uri, iat: now, exp: now + 3600 }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(key.private_key).toString("base64url");

  const res = await fetch(key.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) fail(`token exchange failed: ${await describe(res)}`);
  const data = await res.json();
  if (!data.access_token) fail("token exchange returned no access_token");
  return data.access_token;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// The guide says UPLOAD_IN_PROGRESS, the enum reference says IN_PROGRESS: accept both.
const inProgress = (state) => state === "IN_PROGRESS" || state === "UPLOAD_IN_PROGRESS";

async function main() {
  const checkOnly = process.argv[2] === "--check";
  const zipPath = process.argv[2];
  if (!zipPath) fail("usage: node tools/cws-publish.mjs <path-to-zip> | --check");

  let key;
  try {
    key = JSON.parse(need("CWS_SERVICE_ACCOUNT_JSON"));
  } catch {
    fail("CWS_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  const publisher = need("CWS_PUBLISHER_ID").trim();
  const extension = need("CWS_EXTENSION_ID").trim();
  const zip = checkOnly ? null : await readFile(zipPath).catch(() => fail(`cannot read ${zipPath}`));

  const item = `publishers/${encodeURIComponent(publisher)}/items/${encodeURIComponent(extension)}`;
  const token = await getAccessToken(key);
  const auth = { Authorization: `Bearer ${token}` };

  if (checkOnly) {
    // Read-only: proves the service account, publisher ID and extension ID work.
    const st = await fetch(`${API}/v2/${item}:fetchStatus`, { headers: auth });
    if (!st.ok) fail(`fetchStatus failed: ${await describe(st)}`);
    const s = await st.json();
    const rev = (r) => (r ? `${r.state ?? "?"} (${(r.distributionChannels ?? []).map((c) => c.crxVersion).join(", ") || "no version"})` : "none");
    console.log("Credentials OK (read-only check, nothing uploaded or published).");
    console.log(`Published revision: ${rev(s.publishedItemRevisionStatus)}`);
    console.log(`Submitted revision: ${rev(s.submittedItemRevisionStatus)}`);
    console.log(`Last async upload: ${s.lastAsyncUploadState ?? "none in the last 24h"}; takenDown=${Boolean(s.takenDown)}; warned=${Boolean(s.warned)}`);
    return;
  }

  console.log(`Uploading ${zipPath} (${zip.length} bytes)...`);
  const up = await fetch(`${API}/upload/v2/${item}:upload`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/zip" },
    body: zip,
  });
  if (!up.ok) fail(`upload failed: ${await describe(up)}`);
  const upload = await up.json();
  console.log(`Upload state: ${upload.uploadState ?? "unknown"}${upload.crxVersion ? ` (version ${upload.crxVersion})` : ""}`);

  let state = upload.uploadState;
  if (inProgress(state)) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (inProgress(state)) {
      if (Date.now() > deadline) fail("timed out waiting for the upload to finish");
      await sleep(POLL_EVERY_MS);
      const st = await fetch(`${API}/v2/${item}:fetchStatus`, { headers: auth });
      if (!st.ok) fail(`fetchStatus failed: ${await describe(st)}`);
      state = (await st.json()).lastAsyncUploadState;
      console.log(`Upload state: ${state ?? "unknown"}`);
    }
  }
  if (state !== "SUCCEEDED") fail(`upload did not succeed (state: ${state ?? "unknown"})`);

  console.log("Submitting for review...");
  const pub = await fetch(`${API}/v2/${item}:publish`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!pub.ok) fail(`publish failed: ${await describe(pub)}`);
  const result = await pub.json();
  console.log(`Publish state: ${result.state ?? "unknown"}`);
  if (Array.isArray(result.warningInfo?.warnings) && result.warningInfo.warnings.length) {
    console.log(`Warnings: ${JSON.stringify(result.warningInfo.warnings)}`);
  }
}

main().catch((err) => fail(err?.message ?? String(err)));
