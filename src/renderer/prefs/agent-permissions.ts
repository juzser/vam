/**
 * SECURITY-SENSITIVE: whether a session vam starts is handed a flag that
 * skips its provider's own permission prompts entirely.
 *
 * `Manual` (the shipped default, and the ONLY safe one to ship silently) asks
 * for nothing extra -- the provider runs exactly as it always has, prompting
 * for every tool call the way `claude`/`codex` do out of the box. `Yolo`
 * appends ONE extra argv element the moment a session is started
 * (`shared/providers.ts`'s `yoloFlagFor`, verified against each provider's own
 * `--help` rather than guessed): Claude Code's
 * `--dangerously-skip-permissions`, Codex's
 * `--dangerously-bypass-approvals-and-sandbox`.
 *
 * DEFAULT IS MANUAL, NOT A TASTE -- a stored value this reader cannot place
 * (a hand-edited payload, a future word neither branch below names) must
 * also fall back to `Manual`: the failure mode for an unreadable security
 * setting is "ask for permission", never "skip it".
 *
 * WHERE THIS DOES AND DOES NOT REACH, both load-bearing:
 *  - APPLIED ONLY AT SESSION CREATION. `startSessionIn` (`canvas/Canvas.tsx`)
 *    is the one call site that types a provider's command into a fresh pane,
 *    and it is the only reader of this preference; nothing re-types a running
 *    session's command, so flipping this switch never touches a session
 *    already talking to its provider.
 *  - NEVER REACHABLE FROM THE PHONE OR THE REMOTE API. `settings/sections.ts`'s
 *    `PHONE_SECTIONS` already excludes the whole Agents card from the phone
 *    build, and `main/remote/server.ts`'s write routes take no `permissions`
 *    field at all -- `test/remote/server.no-permissions-field.test.ts` pins
 *    that an extra one in a request body is silently dropped, never forwarded.
 *    Prefs themselves are `localStorage`, per device; there is no channel that
 *    could carry this from one device to another even if a route existed.
 */

export type AgentPermissions = 'manual' | 'yolo';

export const DEFAULT_AGENT_PERMISSIONS: AgentPermissions = 'manual';

export function readAgentPermissions(raw: unknown): AgentPermissions {
  return raw === 'manual' || raw === 'yolo' ? raw : DEFAULT_AGENT_PERMISSIONS;
}
