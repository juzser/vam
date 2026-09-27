/**
 * WHAT A NEW SESSION'S START SCREEN HIGHLIGHTS FIRST: `Auto` (today's
 * behaviour, unchanged -- whatever `prefs.defaultProvider` already names),
 * a specific provider forced regardless of `defaultProvider`, or `No agent`.
 *
 * `Auto` / `Claude` / `Codex` all resolve to a real `ProviderId` that seeds
 * `StartSession`/`TerminalOnlyStart`/`GettingStarted`'s own picker
 * (`resolveDefaultAgentSelection`, `prefs.ts`) -- the same prop those three
 * already took as `defaultProvider`, now fed by this preference instead.
 *
 * `No agent` IS NOT A FOURTH `ProviderId`: the picker those three screens
 * share (`ProviderStartControls`) always highlights one of the two known
 * providers, by construction -- there is no third, unselected state to put it
 * in without changing what every existing Start button means. `No agent`
 * therefore resolves to the SAME provider `Auto` would (so the picker still
 * has something to highlight) and is read a second way, at the same call
 * sites: `preferNoAgent` -- see `resolveDefaultAgentSelection`'s own
 * `preferNoAgent` field -- swaps which of the screen's two affordances reads
 * as the primary one, "open a shell" over "start an agent", rather than
 * removing the choice outright. A deeper change -- a picker that starts with
 * NEITHER provider highlighted -- is a real follow-up, not a claim this file
 * makes today.
 */

import type { ProviderId } from '../../shared/providers.js';

export type DefaultAgent = 'auto' | 'none' | ProviderId;

export const DEFAULT_AGENT_DEFAULT: DefaultAgent = 'auto';

const CHOICES: readonly DefaultAgent[] = ['auto', 'none', 'claude-code', 'codex'];

export function readDefaultAgent(raw: unknown): DefaultAgent {
  return CHOICES.includes(raw as DefaultAgent) ? (raw as DefaultAgent) : DEFAULT_AGENT_DEFAULT;
}
