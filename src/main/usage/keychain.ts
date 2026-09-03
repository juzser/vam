/**
 * The one place vam reads the macOS Keychain. Shells `security`, never a
 * library — the credential passes through this process's stdout only, and
 * only `readTokenFromKeychain` ever sees it. Nothing here logs the value it
 * reads; the caller in `reader.ts` is equally careful, and the IPC layer
 * never sees a token at all (only the `UsageSnapshot` `reader.ts` produces
 * crosses the bridge).
 */

import { execFile } from 'node:child_process';

const SERVICE_NAME = 'Claude Code-credentials';

function runSecurity(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('security', ['find-generic-password', '-s', SERVICE_NAME, '-w'], (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Pulls the OAuth access token out of `security`'s JSON blob: nested under
 * `claudeAiOauth.accessToken`, falling back to a top-level `accessToken`.
 * Pure and exported so the shape can be tested without spawning a process —
 * `readTokenFromKeychain` below is the only caller that touches the network
 * of `security` itself.
 */
export function parseTokenFromSecurityOutput(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') {
    return null;
  }
  const record = parsed as { claudeAiOauth?: { accessToken?: unknown }; accessToken?: unknown };
  const nested = record.claudeAiOauth?.accessToken;
  if (typeof nested === 'string' && nested.length > 0) {
    return nested;
  }
  const top = record.accessToken;
  return typeof top === 'string' && top.length > 0 ? top : null;
}

/**
 * Returns the OAuth access token, or `null` when there is none to find — no
 * Keychain item, no `security` binary (non-macOS), or a blob this parser
 * cannot read. Every one of those maps to the same `null`; `reader.ts` turns
 * `null` into the `'no-token'` reason.
 */
export async function readTokenFromKeychain(): Promise<string | null> {
  if (process.platform !== 'darwin') {
    return null;
  }
  let stdout: string;
  try {
    stdout = await runSecurity();
  } catch {
    return null;
  }
  return parseTokenFromSecurityOutput(stdout);
}
