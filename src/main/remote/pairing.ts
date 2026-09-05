/**
 * The pairing code: minted on the desktop, typed on the phone.
 *
 * Tailscale puts a device on the network. This module is what turns "on the
 * network" into "allowed to drive an agent", and it is deliberately hostile
 * to the code it hands out.
 *
 * THE BURN RULE IS THE REAL DEFENCE, NOT THE ENTROPY. Eight symbols from a
 * thirty-glyph alphabet is ~39 bits -- around 8.6e11 codes, so five guesses
 * succeed with probability ~6e-12 -- but that arithmetic is not what a
 * reviewer should be trusting. What makes the window unusable is the code's
 * short life:
 *
 *  - it is minted ONLY while the operator has the pairing screen open;
 *  - it lives 120 seconds;
 *  - it is single-use, and consumed the moment it is answered correctly;
 *  - minting a new one KILLS the old, because a never-entered code otherwise
 *    lives forever;
 *  - five wrong answers destroy it outright.
 *
 * A correct code is still not a grant. The operator must confirm the device on
 * the desktop, because pairing hands out the ability to close sessions and
 * type into a running agent, and a code entered while nobody is looking must
 * not be enough.
 */

import { randomBytes } from 'node:crypto';
import { constantTimeEquals, type Identity } from './auth.js';
import type { Grant } from './devices.js';

/**
 * Crockford base32 minus the glyphs a human confuses: no I, L, O or U, and no
 * 0 or 1. Thirty symbols.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export const CODE_LENGTH = 8;
/** Long enough to walk to the phone, short enough to be worth nothing later. */
export const CODE_TTL_MS = 120_000;
export const MAX_ATTEMPTS_PER_CODE = 5;
/** Across every source, not per source: the point is to notice a sweep. */
export const GLOBAL_FAILURE_LIMIT = 10;
export const GLOBAL_WINDOW_MS = 60_000;
export const LOCKOUT_MS = 900_000;
/** A request the operator walked away from must not hold a socket forever. */
export const APPROVAL_TIMEOUT_MS = 60_000;
/** A device proposes its own name; it is attacker-supplied text. */
const MAX_NAME_LENGTH = 64;

/**
 * Uniform over the alphabet by REJECTION, not by `%`. Thirty does not divide
 * 256, so the modulo of a random byte would favour the first sixteen glyphs
 * and cost the code most of a bit.
 */
export function mintCode(): string {
  let out = '';
  const limit = 256 - (256 % CODE_ALPHABET.length);
  while (out.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      if (byte < limit) {
        out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
        if (out.length === CODE_LENGTH) {
          break;
        }
      }
    }
  }
  return out;
}

/** `XXXX-XXXX`: a group of four is what a person can hold while looking away. */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * What a human types, turned into what was minted: uppercased, with spaces,
 * dashes and anything else dropped, and cut to length before it is compared so
 * a megabyte body is never hashed.
 *
 * NO GLYPH FOLDING. Crockford maps O to 0 and I/L to 1, but this alphabet
 * contains NEITHER member of either pair, so folding would map one impossible
 * glyph onto another. Excluding the confusable glyphs at mint time is the
 * whole of the defence against mistyping them.
 */
export function normalizeCode(input: string): string {
  return input
    .slice(0, CODE_LENGTH * 8)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);
}

/**
 * The name a device proposes is ATTACKER-CHOSEN TEXT, and it is the operator's
 * only discriminator in the Allow prompt: `source` behind `tailscale serve` is
 * always 127.0.0.1 and says nothing. So quotation marks and brackets come out
 * as well as control characters -- not because they inject anything (React
 * escapes markup) but because a name that can close a quotation can prepend
 * "Read-only." to the sentence and argue against the warning it sits inside.
 * The panel renders the name in its own element for the same reason.
 */
function cleanName(name: string): string {
  const cleaned = name
    .slice(0, MAX_NAME_LENGTH * 4)
    .replace(/[\p{C}]/gu, ' ')
    .replace(/["'\u2018\u2019\u201c\u201d\u00ab\u00bb`()[\]{}<>]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_NAME_LENGTH);
  return cleaned.length === 0 ? 'an unnamed device' : cleaned;
}

export type LiveCode = { readonly code: string; readonly expiresAt: number };

/** The desktop's view. `awaiting` is what the confirmation prompt renders. */
export type PairingState = {
  readonly live: LiveCode | null;
  readonly burned: boolean;
  readonly throttledUntil: number;
  readonly attemptsLeft: number;
  readonly awaiting: { readonly name: string; readonly source: string } | null;
};

/**
 * The internal reason, for the desktop and for tests. IT IS NOT WHAT THE
 * CALLER IS TOLD: `server.ts` collapses every one of these into a single 401
 * that is byte-identical to the one an unauthenticated request gets. A caller
 * that could tell `no-code` from `wrong-code` would learn exactly when the
 * operator has the pairing screen open, which is the one moment worth
 * attacking -- and the desktop, which needs to know a code burned, reads
 * `state()` rather than a reply the phone relayed.
 */
export type PairReason = 'no-code' | 'wrong-code' | 'burned' | 'throttled' | 'denied';

export type PairOutcome =
  | { readonly ok: true; readonly identity: Identity; readonly token: string }
  | { readonly ok: false; readonly reason: PairReason };

export type PairingOptions = {
  /** Injected so a test owns the clock; the two-minute life is the point. */
  readonly now?: () => number;
  /** Mints and persists the device token. See `devices.ts`. */
  readonly grant: (name: string) => Promise<Grant>;
};

export type Pairing = {
  /** Opens the screen: mints a code, killing any previous one. */
  open(): LiveCode;
  /** Closes the screen: no code, and any waiting request is denied. */
  close(): void;
  live(): LiveCode | null;
  state(): PairingState;
  submit(code: string, name: string, source: string): Promise<PairOutcome>;
  approve(): void;
  deny(): void;
};

export function createPairing(options: PairingOptions): Pairing {
  const now = options.now ?? (() => Date.now());
  let live: LiveCode | null = null;
  let attempts = 0;
  let burned = false;
  let throttledUntil = 0;
  let failures: number[] = [];
  let awaiting: {
    name: string;
    source: string;
    settle: (approved: boolean) => void;
    /** Cleared on settle: a stale timer would deny the NEXT request. */
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  const current = (): LiveCode | null => {
    if (live !== null && live.expiresAt <= now()) {
      live = null;
    }
    return live;
  };

  const settleAwaiting = (approved: boolean): void => {
    const pending = awaiting;
    awaiting = null;
    if (pending !== null) {
      clearTimeout(pending.timer);
      pending.settle(approved);
    }
  };

  /**
   * Every refused guess, not just a wrong code.
   *
   * A `no-code` attempt used to return before this and was therefore free:
   * an attacker could poll once a second at no cost, watch for the moment the
   * operator opened the screen, and only then spend its five guesses. Probing
   * has to cost the same as guessing, or the throttle is guarding a door the
   * attacker never has to walk through.
   */
  const recordFailure = (): void => {
    const at = now();
    failures = failures.filter((when) => at - when < GLOBAL_WINDOW_MS);
    failures.push(at);
    if (failures.length >= GLOBAL_FAILURE_LIMIT) {
      // One visible signal rather than a log line per guess: a sweep is one
      // event the operator should see, not ten they should count.
      throttledUntil = at + LOCKOUT_MS;
      failures = [];
      live = null;
    }
  };

  return {
    open(): LiveCode {
      // Minting kills the old code AND any request waiting on it: the operator
      // pressing Regenerate is the operator saying "not that one".
      settleAwaiting(false);
      // AND IT CLEARS THE THROTTLE. This is not a hole -- it is the whole
      // point of the throttle. Opening the pairing screen is a human standing
      // at this machine, which is a stronger signal than any failure counter,
      // and an attacker cannot produce it: they are on the far side of the
      // network with no way to press this button. Without the reset, ten
      // cheap wrong guesses lock the operator's OWN phone out for fifteen
      // minutes, and repeating that denies pairing forever. The throttle
      // exists to stop guessing, never to stop the operator.
      throttledUntil = 0;
      failures = [];
      burned = false;
      attempts = 0;
      live = { code: mintCode(), expiresAt: now() + CODE_TTL_MS };
      return live;
    },

    close(): void {
      settleAwaiting(false);
      live = null;
      attempts = 0;
    },

    live: current,

    state(): PairingState {
      return {
        live: current(),
        burned,
        throttledUntil: throttledUntil > now() ? throttledUntil : 0,
        attemptsLeft: Math.max(0, MAX_ATTEMPTS_PER_CODE - attempts),
        awaiting: awaiting === null ? null : { name: awaiting.name, source: awaiting.source },
      };
    },

    async submit(code: string, name: string, source: string): Promise<PairOutcome> {
      const typed = normalizeCode(code);
      const open = current();
      // Live, unclaimed, unburned: there is a real code to compare against.
      const comparable = open !== null && awaiting === null && !burned;

      // THE CODE IS COMPARED BEFORE THE THROTTLE IS CONSULTED, and that order
      // is a fix, not an oversight. A correct code is not a guess: the
      // operator minted it at this machine within the last two minutes, and
      // there is no reason to rate limit something we ourselves just handed
      // out. Consulting the throttle first meant a flood -- with the pairing
      // screen never even opened -- refused the operator's own phone for
      // fifteen minutes, and a continuing flood re-armed the lockout faster
      // than they could clear it. The throttle stops guessing; it must never
      // stop the operator.
      //
      // Exactly one comparison happens either way. Where there is nothing to
      // compare against, a decoy stands in, so a dead screen and a live one
      // cost APPROXIMATELY the same -- approximately, not exactly: the decoy
      // pays for `mintCode`'s `randomBytes` on top of the two SHA-256s, so it
      // does strictly more work in principle. Measured over 40 requests per
      // state the spread was ~3%, three orders of magnitude below the round
      // trip.
      let correct = false;
      if (comparable && open !== null) {
        correct = constantTimeEquals(typed, open.code);
      } else {
        // The decoy's answer is thrown away; only the work matters.
        constantTimeEquals(typed, mintCode());
      }

      if (!correct) {
        // Every knock costs a counted failure, including the ones that never
        // had a code to be wrong about -- otherwise polling for the moment the
        // operator opens the screen is free, and free reconnaissance is what
        // turns five guesses into five guesses aimed at the right minute.
        recordFailure();
        if (throttledUntil > now()) {
          // While locked out, a wrong guess does not spend one of the live
          // code's five attempts. That is what the lockout is for now: capping
          // what a flood can buy. It never refuses a correct code -- that case
          // returned above.
          return { ok: false, reason: 'throttled' };
        }
        if (comparable) {
          attempts += 1;
          if (attempts >= MAX_ATTEMPTS_PER_CODE) {
            burned = true;
            live = null;
            return { ok: false, reason: 'burned' };
          }
          return { ok: false, reason: 'wrong-code' };
        }
        return { ok: false, reason: burned ? 'burned' : 'no-code' };
      }

      // Consumed here, not after approval: a correct code has been spent
      // whatever the operator decides, so a denial cannot be retried with it.
      live = null;
      attempts = 0;
      const proposed = cleanName(name);
      const approved = await new Promise<boolean>((settle) => {
        const timer = setTimeout(() => settleAwaiting(false), APPROVAL_TIMEOUT_MS);
        timer.unref?.();
        awaiting = { name: proposed, source, settle, timer };
      });
      if (!approved) {
        return { ok: false, reason: 'denied' };
      }
      // The token is minted and PERSISTED here, before the phone is told
      // anything: a credential is not valid until its durable write succeeds.
      const granted = await options.grant(proposed);
      return { ok: true, identity: granted.identity, token: granted.token };
    },

    approve(): void {
      settleAwaiting(true);
    },

    deny(): void {
      settleAwaiting(false);
    },
  };
}
