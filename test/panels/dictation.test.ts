/**
 * SPEAKING A PROMPT INSTEAD OF TYPING IT.
 *
 * Operator: "add a record feature so a prompt can be spoken, with the icon
 * next to Send." The device this matters most on is the phone -- a soft
 * keyboard is the whole reason a paired phone is slower than the desktop it is
 * paired to -- and the phone is also where the platform's own recogniser is
 * best.
 *
 * ── WHAT THIS WRAPS, AND WHAT IT REFUSES TO PRETEND ───────────────────────
 * The Web Speech API, which is a browser capability and not a vam one. It is
 * absent in some builds, present-but-refused in others (Electron has no key
 * for the cloud service Chromium reaches for), and gated behind a microphone
 * permission everywhere. So this module answers two questions separately:
 *
 *  1. IS IT THERE AT ALL (`dictationAvailable`) -- which decides whether a
 *     button is DRAWN. A control that cannot act is not drawn dimmed; it is
 *     not drawn. That rule is this file's, not this module's, and the panel
 *     follows it elsewhere for `chooseDirectory` and the attach button.
 *  2. WHAT WENT WRONG WHEN IT RAN -- because the interesting failures happen
 *     AFTER the first successful feature detection, and "nothing happened" is
 *     the worst possible report for a microphone.
 *
 * Every message below is a sentence for the operator, not a code. `network`
 * in particular has to say what it means, because in a packaged Electron it is
 * the ordinary outcome rather than a fault the operator can fix by retrying.
 */

import { describe, expect, it, vi } from 'vitest';
import { dictationAvailable, startDictation } from '../../src/renderer/panels/dictation.js';

/** A recogniser with the surface the real one has, and nothing else. */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = '';
  continuous = false;
  interimResults = false;
  started = 0;
  stopped = 0;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started += 1;
  }
  stop() {
    this.stopped += 1;
  }
  /** What the browser hands back: a list of lists, each with `isFinal`. */
  say(text: string, isFinal = true) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text }], { isFinal })],
    });
  }
}

const scopeWith = (ctor: unknown, language = 'vi-VN') =>
  ({ SpeechRecognition: ctor, navigator: { language } }) as never;

/** The same scope, plus the preload bridge — which is what "this is the
 *  packaged Electron app" looks like from the renderer. */
const electronScope = (ctor: unknown) =>
  ({ SpeechRecognition: ctor, navigator: { language: 'en-US' }, api: {} }) as never;

describe('whether dictation can run at all', () => {
  it('is false where the browser has no recogniser', () => {
    expect(dictationAvailable({} as never)).toBe(false);
  });

  it('is true on the standard name and on the webkit one', () => {
    expect(dictationAvailable(scopeWith(FakeRecognition))).toBe(true);
    expect(dictationAvailable({ webkitSpeechRecognition: FakeRecognition } as never)).toBe(true);
  });

  it('is false in the Electron build, where vam refuses its own microphone', () => {
    // NOT A CAPABILITY QUESTION, A POLICY ONE, and it is vam's own policy.
    // `src/main/index.ts` registers a deny-all permission handler --
    // `callback(false)` for every request, `setPermissionCheckHandler(() =>
    // false)` for every check -- so the microphone is refused before
    // Chromium's absent speech-service key is ever reached. A recogniser
    // constructor still EXISTS there, which is exactly why feature detection
    // alone drew a button that could only ever fail.
    //
    // THE DISCRIMINATOR IS THE BRIDGE, the one `App.tsx` already uses to send
    // a browser to `DemoCanvas`: `window.api` is a preload export, so it is
    // present in the packaged app and absent in a browser tab and on the
    // paired phone -- the two places dictation genuinely works.
    expect(dictationAvailable(electronScope(FakeRecognition))).toBe(false);
    // And the same scope without the bridge is a browser, where it does.
    expect(dictationAvailable(scopeWith(FakeRecognition))).toBe(true);
  });

  it('starts nothing where there is nothing to start', () => {
    expect(
      startDictation({ onText: () => {}, onError: () => {}, onEnd: () => {} }, {} as never),
    ).toBeNull();
  });
});

describe('a dictation run', () => {
  const events = () => ({ onText: vi.fn(), onError: vi.fn(), onEnd: vi.fn() });

  it('starts the recogniser and keeps it listening', () => {
    const handle = startDictation(events(), scopeWith(FakeRecognition));
    expect(handle).not.toBeNull();
    const live = FakeRecognition.last;
    expect(live?.started).toBe(1);
    // CONTINUOUS, because a prompt is more than one sentence. The default
    // stops at the first pause, which would hand back a fragment and end.
    expect(live?.continuous).toBe(true);
  });

  it("speaks the operator's own language, not the document's", () => {
    // `<html lang>` is `en` and always will be -- it describes vam's chrome.
    // The person dictating is speaking whatever their system is set to, and
    // `navigator.language` is the only thing on the page that knows.
    startDictation(events(), scopeWith(FakeRecognition, 'vi-VN'));
    expect(FakeRecognition.last?.lang).toBe('vi-VN');
  });

  it('hands back only what the recogniser called final', () => {
    // An interim result is a guess that will be REPLACED. Appended to a draft
    // it would leave the guess behind when the correction arrives, which is
    // how dictation ends up writing every phrase twice.
    const on = events();
    startDictation(on, scopeWith(FakeRecognition));
    FakeRecognition.last?.say('ship the branch', false);
    expect(on.onText).not.toHaveBeenCalled();
    FakeRecognition.last?.say('ship the branch', true);
    expect(on.onText).toHaveBeenCalledWith('ship the branch');
  });

  it('stops when it is asked to, and says it ended', () => {
    const on = events();
    const handle = startDictation(on, scopeWith(FakeRecognition));
    handle?.stop();
    expect(FakeRecognition.last?.stopped).toBe(1);
    FakeRecognition.last?.onend?.();
    expect(on.onEnd).toHaveBeenCalled();
  });

  it('turns every failure into a sentence, never a code', () => {
    // A microphone that does nothing and says nothing is the worst report
    // there is. Each of these is a different act by the operator -- grant a
    // permission, plug something in, wait, or stop expecting this build to do
    // it at all -- so they may not collapse into one message.
    const seen: string[] = [];
    const on = { onText: vi.fn(), onError: (m: string) => seen.push(m), onEnd: vi.fn() };
    for (const error of [
      'not-allowed',
      'service-not-allowed',
      'no-speech',
      'audio-capture',
      'network',
      'something-new',
    ]) {
      startDictation(on, scopeWith(FakeRecognition));
      FakeRecognition.last?.onerror?.({ error });
    }
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size, `every reason says something different: ${seen.join(' | ')}`).toBe(
      6,
    );
    for (const message of seen) {
      expect(message).not.toMatch(/^[a-z-]+$/); // not the raw code
      expect(message.length).toBeGreaterThan(12);
    }
    // The two that are about permission say so, and the Electron case says
    // what it really is rather than asking for a retry.
    expect(seen[0]).toMatch(/permission|allow/i);
    expect(seen[4]).toMatch(/service|offline|network/i);
  });

  it('reports an ending once, whether it stopped itself or was stopped', () => {
    const on = events();
    const handle = startDictation(on, scopeWith(FakeRecognition));
    FakeRecognition.last?.onerror?.({ error: 'no-speech' });
    FakeRecognition.last?.onend?.();
    handle?.stop();
    FakeRecognition.last?.onend?.();
    expect(on.onEnd).toHaveBeenCalledTimes(1);
  });

  it('survives a recogniser that throws on start, rather than taking the pane down', () => {
    class Throwing extends FakeRecognition {
      override start() {
        throw new Error('already started');
      }
    }
    const on = events();
    expect(() => startDictation(on, scopeWith(Throwing))).not.toThrow();
    expect(on.onError).toHaveBeenCalled();
  });
});
