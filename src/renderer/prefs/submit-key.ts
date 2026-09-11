/**
 * WHICH KEY SENDS THE PROMPT: `Enter`, or `Shift-Enter`.
 *
 * Operator request: "in the prompt input right now, Enter submits and
 * Shift+Enter makes a newline. Add a settings toggle to swap between these two
 * behaviours." Both halves swap together — the key that does not send is the
 * key that takes a newline — because a mode that moved only one of them would
 * leave the box with two sends and no newline, or two newlines and no send.
 *
 * A NAMED PAIR, NOT A BOOLEAN, and the name is the behaviour rather than the
 * history. A `swapEnter: boolean` would be spelled against today's default, so
 * every reader would have to know what the default USED to be to know what
 * `true` means, and the day the default moves the flag reads backwards. Two
 * words that each say what happens cannot go stale that way.
 *
 * WHAT THIS MODE DOES NOT REACH, stated here because it is the decision most
 * likely to be "corrected" later: the two typeahead lists in the composer (the
 * `!` commands and the `/` slash commands) keep Enter-accepts-the-suggestion in
 * BOTH modes. See the `onKeyDown` handler in `DetailPanel.tsx` for the whole
 * argument; the short version is that accepting a completion is not sending,
 * and in `shift-enter` mode a suggestion that followed this pref would have no
 * accept key at all.
 */

/** The two words the store may hold. */
export type PromptSubmitKey = 'enter' | 'shift-enter';

/**
 * Enter, and the default is load-bearing rather than a taste.
 *
 * It is what the box has always done, so shipping the setting moves nobody's
 * hands. The other direction would take the send key away from every operator
 * who never opens Settings — and the key they would press out of habit types a
 * newline into a draft that then goes nowhere, which is a change that looks
 * like a broken app rather than like a preference.
 */
export const DEFAULT_PROMPT_SUBMIT_KEY: PromptSubmitKey = 'enter';

/**
 * What each mode is CALLED on screen, in one table because two surfaces read
 * it: the caption inside the composer and the buttons in Settings. Two
 * spellings of one key is how a setting comes to disagree with the screen it
 * changes.
 *
 * Hyphenated, like every chord the key sheet paints (`Mod-Shift-[`,
 * `Shift-Tab`) — not `Shift+Enter`. vam already has one spelling for a
 * modified key and this is it.
 */
export const SUBMIT_KEY_LABELS: Readonly<Record<PromptSubmitKey, string>> = {
  enter: 'Enter',
  'shift-enter': 'Shift-Enter',
};

/**
 * A stored word, or the key the box has always sent on.
 *
 * Total, like `readTurnProgress`: a value an older vam wrote, a spelling a
 * later vam withdrew, a devtools edit — none of them may reach the composer,
 * and the direction of the fallback matters. Falling back to `shift-enter`
 * would move an operator's send key on the strength of a value nobody chose.
 */
export function readPromptSubmitKey(raw: unknown): PromptSubmitKey {
  return raw === 'enter' || raw === 'shift-enter' ? raw : DEFAULT_PROMPT_SUBMIT_KEY;
}

/**
 * What the rule needs of a keydown, and deliberately no more.
 *
 * A structural type rather than `KeyboardEvent`, so the rule can be stated
 * against a plain object in a test and against React's synthetic event in the
 * box without either one having to be converted.
 */
export type SubmitKeystroke = { readonly key: string; readonly shiftKey: boolean };

/**
 * Does this keystroke send the draft?
 *
 * ONE RULE, ONE PLACE. The composer reads this function and the tests read this
 * function; a second `event.key === 'Enter'` conditional in the JSX is how a
 * mode comes to send on a key the rule says it does not.
 *
 * NOTE WHAT `false` MEANS FOR A BARE ENTER IN `shift-enter` MODE: not "swallow
 * it", but "this is not ours". The caller must leave the event alone so the
 * textarea inserts the newline itself — a `preventDefault()` on that path would
 * give the operator a mode with no newline and no send.
 */
export function submitsPrompt(mode: PromptSubmitKey, event: SubmitKeystroke): boolean {
  if (event.key !== 'Enter') return false;
  return mode === 'shift-enter' ? event.shiftKey : !event.shiftKey;
}

/**
 * THE KEY IN FORCE, module state rather than a prop, for the reason
 * `progress.ts` gives at length: `Canvas.tsx` owns the prefs and mounts one
 * `DetailPanel` per split leaf, `PhoneShell` mounts another, and this is not a
 * paint that CSS could carry — it decides what a keystroke does, so it has to
 * reach React. Hence a store with a snapshot and a subscription, the shape
 * `useSyncExternalStore` asks for.
 */
let active: PromptSubmitKey = DEFAULT_PROMPT_SUBMIT_KEY;
const listeners = new Set<() => void>();

/** The snapshot `useSyncExternalStore` compares by identity — a string, so it
 *  is stable by construction and no cache is needed. */
export function activePromptSubmitKey(): PromptSubmitKey {
  return active;
}

/**
 * Put a key in force. Called by `activatePrefs`, which every read and every
 * write goes through.
 *
 * A CHANGE, NOT EVERY WRITE. `activatePrefs` runs on every prefs write, so a
 * theme flip or a renamed project would otherwise tell every mounted composer
 * to re-render for a key that did not move.
 */
export function setActivePromptSubmitKey(next: PromptSubmitKey): void {
  const key = readPromptSubmitKey(next);
  if (key === active) return;
  active = key;
  for (const listener of listeners) listener();
}

/** Subscribe; the returned function unsubscribes. `useSyncExternalStore`'s
 *  contract, and the shape `subscribeTurnProgress` already has in this repo. */
export function subscribePromptSubmitKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
