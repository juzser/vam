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
 *  - GATED ON THE DESKTOP SHELL, NOT ON VIEWPORT WIDTH. There is no separate
 *    phone build: `main/remote/server.ts` serves the SAME renderer a paired
 *    browser opens over Tailscale, and `usePhoneViewport()` is only a
 *    `matchMedia('(max-width: 519px)')` check -- a paired browser sitting at
 *    DESKTOP width sees the same Agents card a real desktop user does. An
 *    earlier version of this comment claimed `PHONE_SECTIONS` (`settings/
 *    sections.ts`) excluded this from "the phone build"; that conflated
 *    narrow layout with a different device, and was wrong. The real gate is
 *    `isDesktopShell()` below -- `window.api` exists only inside the actual
 *    Electron shell, never in ANY browser tab regardless of width -- and both
 *    `SettingsOverlay.tsx` (hides the row and its confirmation) and
 *    `startSessionIn` (treats the preference as `'manual'` regardless of what
 *    a remote tab's own `localStorage` holds) read it. This is DEFENCE IN
 *    DEPTH, not the security boundary: `recordPrompt` already lets a paired
 *    device type arbitrary text into a pane, Yolo's flag included, so a
 *    paired device that wanted to run permission-skipped commands could
 *    already do so before this preference existed. What this gate prevents is
 *    a Yolo *setting* silently carried in a remote tab's own `localStorage`
 *    (set there by mistake, or by an operator who forgot which tab they were
 *    in) from being honoured the moment that tab's `startSessionIn` runs.
 *  - Prefs themselves are `localStorage`, per device; there is no channel that
 *    could carry a `'yolo'` value from one device's storage to another's.
 *  - A YOLO START LEAVES A SEPARATE, PERMANENT MARK. `startSessionIn` records
 *    the fact into `prefs/yolo-starts.ts`'s own bucket at the moment it
 *    applies this flag, and the tab strip (`canvas/Canvas.tsx`'s `TabStrip`)
 *    paints it as a quiet, ALWAYS-ON `ShieldOff` mark with a tooltip. That
 *    mark is driven by the recorded fact, never by this preference's CURRENT
 *    value -- changing `agentPermissions` back to `manual` afterward does not
 *    un-mark a session already started with the flag.
 */

export type AgentPermissions = 'manual' | 'yolo';

export const DEFAULT_AGENT_PERMISSIONS: AgentPermissions = 'manual';

export function readAgentPermissions(raw: unknown): AgentPermissions {
  return raw === 'manual' || raw === 'yolo' ? raw : DEFAULT_AGENT_PERMISSIONS;
}

/**
 * Whether this renderer is running inside the real Electron desktop shell --
 * the same check `App.tsx` makes at the very top of the tree ("The bridge
 * exists only in the Electron shell. In a browser there is no `window.api`
 * and nothing below it is reachable, which is why the check is for the
 * object rather than for a build flag") -- read again here because Yolo's
 * gate needs to survive independently of however the tree above it is
 * composed. A paired browser at any viewport width has no `window.api`; only
 * the packaged app does.
 */
export function isDesktopShell(): boolean {
  return globalThis.window?.api !== undefined;
}
