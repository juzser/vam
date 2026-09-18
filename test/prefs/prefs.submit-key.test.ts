// @vitest-environment happy-dom

/**
 * WHICH KEY SENDS THE PROMPT: one stored word, the rule it decides, and
 * everything that must survive a payload written before it existed.
 *
 * Operator request: "in the prompt input right now, Enter submits and
 * Shift+Enter makes a newline. Add a settings toggle to swap between these two
 * behaviours." The stored half is here; what the composer does with it is
 * `test/panels/DetailPanel.submit-key.test.tsx`, and the control that writes it
 * is `test/settings/submit-key.test.tsx`.
 *
 * THE RULE IS TESTED AS A FUNCTION AND AS A KEYSTROKE, in that order and in
 * two files, for the reason `prefs.turn-progress.test.ts` gives: a predicate
 * that says "this keystroke sends" is worth nothing if the box sends off a
 * second conditional of its own. This file pins what the function promises.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setFocusView,
  setPromptSubmitKey,
  setTheme,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';
import {
  activePromptSubmitKey,
  DEFAULT_PROMPT_SUBMIT_KEY,
  type PromptSubmitKey,
  readPromptSubmitKey,
  SUBMIT_KEY_LABELS,
  setActivePromptSubmitKey,
  submitsPrompt,
  subscribePromptSubmitKey,
} from '../../src/renderer/prefs/submit-key.js';

const KEY = 'vam.prefs.v1';

function fake(initial: string | null = null): StorageLike & { value: string | null } {
  return {
    value: initial,
    getItem(key) {
      return key === KEY ? this.value : null;
    },
    setItem(key, value) {
      if (key === KEY) this.value = value;
    },
  };
}

const stored = (payload: object) => readPrefs(fake(JSON.stringify(payload)));

/** A keydown, reduced to the two facts the rule reads. */
const press = (key: string, shiftKey = false) => ({ key, shiftKey });

describe('the submit-key choice round-trips', () => {
  it('defaults to Enter, so merely shipping the setting moves nobody’s key', () => {
    // The same argument `turnProgress`'s `shown` was chosen on. This setting
    // can take the SEND key away from an operator who never opens the picker,
    // and the muscle memory it would break is the one they use most.
    expect(DEFAULT_PROMPT_SUBMIT_KEY).toBe('enter');
    expect(EMPTY_PREFS.promptSubmitKey).toBe(DEFAULT_PROMPT_SUBMIT_KEY);
  });

  it('writes and reads back a chosen key, disturbing no neighbour', () => {
    const storage = fake();
    writePrefs(storage, setPromptSubmitKey(setTheme(EMPTY_PREFS, 'system'), 'shift-enter'));
    const back = readPrefs(storage);
    expect(back.promptSubmitKey).toBe('shift-enter');
    expect(back.theme).toBe('system');
  });

  it('defaults when the payload predates the field — which every payload does', () => {
    const back = stored({ theme: 'light', outFontSize: 15 });
    expect(back.promptSubmitKey).toBe(DEFAULT_PROMPT_SUBMIT_KEY);
    expect(back.theme).toBe('light');
    expect(back.outFontSize).toBe(15);
  });

  it('falls back to Enter for anything that is not one of the two words', () => {
    // A hand edit, a devtools write, a spelling a later vam withdrew. Falling
    // back to `enter` is the only safe direction: the other one silently moves
    // the send key of an operator who never asked for it, and the key they
    // press instead types a newline into a draft that never goes anywhere.
    for (const raw of ['shift', 'Enter', '', 0, null, {}, ['enter'], true]) {
      const back = stored({ promptSubmitKey: raw, theme: 'light' });
      expect(back.promptSubmitKey, JSON.stringify(raw)).toBe(DEFAULT_PROMPT_SUBMIT_KEY);
      expect(back.theme, 'one bad field costs only itself').toBe('light');
    }
    // And on the way in as well, so nothing downstream has to wonder.
    expect(setPromptSubmitKey(EMPTY_PREFS, 'nonsense' as PromptSubmitKey).promptSubmitKey).toBe(
      DEFAULT_PROMPT_SUBMIT_KEY,
    );
  });

  it('leaves the neighbouring preferences alone', () => {
    const both = setFocusView(setPromptSubmitKey(EMPTY_PREFS, 'shift-enter'), true);
    expect(both.promptSubmitKey).toBe('shift-enter');
    expect(both.focusView).toBe(true);
  });
});

describe('the chosen key reaches the composer', () => {
  it('is in force after a read, not only after a write', () => {
    // `Canvas.tsx` owns the prefs state and mounts one `DetailPanel` per split
    // leaf; the box reads the key off this module rather than down a prop, the
    // way the transcript reads its progress mode. So the READ path has to arm
    // it or a reload comes up sending on the wrong key.
    readPrefs(fake(JSON.stringify({ promptSubmitKey: 'shift-enter' })));
    expect(activePromptSubmitKey()).toBe('shift-enter');
    readPrefs(fake(JSON.stringify({ promptSubmitKey: 'enter' })));
    expect(activePromptSubmitKey()).toBe('enter');
  });

  it('is in force after a write, and tells its readers', () => {
    setActivePromptSubmitKey('enter');
    let told = 0;
    const stop = subscribePromptSubmitKey(() => {
      told += 1;
    });
    writePrefs(fake(), setPromptSubmitKey(EMPTY_PREFS, 'shift-enter'));
    expect(activePromptSubmitKey()).toBe('shift-enter');
    expect(told).toBe(1);
    // A write that changes nothing is not news: `useSyncExternalStore` calls
    // every listener it is told to, and a store that fired on every prefs
    // write would re-render every composer on an unrelated theme flip.
    writePrefs(fake(), setPromptSubmitKey(EMPTY_PREFS, 'shift-enter'));
    expect(told).toBe(1);
    stop();
    setActivePromptSubmitKey('enter');
    expect(told).toBe(1);
  });
});

describe('what each mode makes of a keystroke', () => {
  it('sends on a bare Enter, and not on Shift+Enter, in the shipped mode', () => {
    expect(submitsPrompt('enter', press('Enter'))).toBe(true);
    expect(submitsPrompt('enter', press('Enter', true))).toBe(false);
  });

  it('swaps both halves together, never only one', () => {
    // THE WHOLE ASK. A mode that made Shift+Enter send while a bare Enter went
    // on sending too would leave the operator with no newline at all, which is
    // the state the multiline box exists to avoid.
    expect(submitsPrompt('shift-enter', press('Enter', true))).toBe(true);
    expect(submitsPrompt('shift-enter', press('Enter'))).toBe(false);
  });

  it('answers no for every key that is not Enter, in either mode', () => {
    for (const mode of ['enter', 'shift-enter'] as const) {
      for (const key of ['Tab', 'Escape', 'a', ' ', 'ArrowDown', 'Return']) {
        expect(submitsPrompt(mode, press(key)), `${mode} ${key}`).toBe(false);
        expect(submitsPrompt(mode, press(key, true)), `${mode} Shift-${key}`).toBe(false);
      }
    }
  });

  it('names each key once, where both the composer and the picker read it', () => {
    // The caption in the box and the buttons in Settings say the same words
    // because they read the same table. Two spellings of one key is how a
    // setting comes to disagree with the screen it changes.
    expect(SUBMIT_KEY_LABELS.enter).toBe('Enter');
    expect(SUBMIT_KEY_LABELS['shift-enter']).toBe('Shift-Enter');
  });

  it('normalises a stored word before anything reads it as a mode', () => {
    expect(readPromptSubmitKey('shift-enter')).toBe('shift-enter');
    expect(readPromptSubmitKey('enter')).toBe('enter');
    expect(readPromptSubmitKey(undefined)).toBe(DEFAULT_PROMPT_SUBMIT_KEY);
  });
});
