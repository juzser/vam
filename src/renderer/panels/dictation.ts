/**
 * Speaking a prompt instead of typing it.
 *
 * Operator: "add a record feature so a prompt can be spoken, with the icon
 * next to Send." The device it matters most on is the phone, where a soft
 * keyboard is the whole reason a paired phone is slower than the desktop it is
 * paired to -- and the phone is also where the platform's recogniser is best.
 *
 * ── WHAT THIS IS ──────────────────────────────────────────────────────────
 * A thin wrapper over the Web Speech API, which is a BROWSER capability and
 * not a vam one. vam neither records audio nor sends any: the recogniser is
 * the platform's, the audio never reaches this process, and what comes back is
 * text. Nothing here uploads anything, and nothing on screen says it does.
 *
 * ── THE THREE STATES IT HAS TO KEEP APART ─────────────────────────────────
 *  1. NOT THERE. `dictationAvailable` is false and the button is not drawn --
 *    absent, not dimmed, the same rule the directory picker and the attach
 *    button follow in `DetailPanel`.
 *  2. THERE AND REFUSED. Permission denied by the browser, no microphone, or a
 *    recogniser whose service cannot be reached. Every one gets its own
 *    sentence. The packaged app is no longer among these cases: vam denies its
 *    own microphone there, so the button is not drawn at all -- see
 *    `dictationAvailable`.
 *  3. RUNNING. Final transcripts arrive as text; interim ones are dropped,
 *    because an interim result is a guess that will be REPLACED, and appending
 *    guesses to a draft writes every phrase twice.
 *
 * `test/panels/dictation.test.ts` drives all three against a fake recogniser.
 */

/** The narrow slice of the recogniser this uses. */
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechResultLike) => void) | null;
  onerror: ((event: { readonly error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechResultLike = {
  readonly resultIndex?: number;
  readonly results: ArrayLike<ArrayLike<{ readonly transcript?: string }> & { isFinal?: boolean }>;
};

type RecognitionCtor = new () => Recognition;

/** Whatever `globalThis` happens to carry -- injected whole, for the tests. */
export type SpeechScope = {
  readonly SpeechRecognition?: RecognitionCtor;
  readonly webkitSpeechRecognition?: RecognitionCtor;
  readonly navigator?: { readonly language?: string };
  /**
   * The preload bridge, and here it is read as ONE FACT ONLY: that this page
   * is the packaged Electron app, whose main process denies every Chromium
   * permission. Nothing on it is called.
   */
  readonly api?: unknown;
};

export type DictationEvents = {
  /** One FINAL transcript chunk, ready to append to the draft. */
  onText(text: string): void;
  /** A sentence for the operator. Never a code. */
  onError(message: string): void;
  /** The run is over, for any reason, and exactly once. */
  onEnd(): void;
};

export type DictationHandle = { stop(): void };

const ctorFrom = (scope: SpeechScope): RecognitionCtor | null =>
  scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;

/**
 * Can dictation actually run here?
 *
 * TWO QUESTIONS, AND THE SECOND ONE WAS MISSING. Feature detection answers
 * "is there a recogniser", and the answer in the packaged app is YES -- it is
 * Chromium, `webkitSpeechRecognition` is defined, and a button was drawn on
 * the strength of it. What that button could never do is LISTEN:
 * `src/main/index.ts` registers a deny-all permission policy (`callback(false)`
 * on every request, `setPermissionCheckHandler(() => false)` on every check),
 * so vam refuses its own microphone before Chromium's missing speech-service
 * key is even reached.
 *
 * THE POLICY IS NOT THE BUG, THE BUTTON WAS. Deny-by-default is a deliberate
 * security decision and widening it for one convenience would be the wrong
 * trade; the repo's own rule is that a control which cannot act is not drawn.
 * So dictation is absent in this build and present where it works: a browser
 * tab, and the paired phone -- which is the surface it was asked for, where a
 * soft keyboard is the reason a phone is slower than the desktop beside it.
 *
 * `api` IS THE DISCRIMINATOR, the same one `App.tsx` uses to send a browser to
 * `DemoCanvas`: it is a preload export, so it exists in Electron and nowhere
 * else. Reading the permission itself (`navigator.permissions.query`) would be
 * more direct and is not better here -- it is asynchronous, so the button
 * would paint and then vanish, and Safari, which is what the paired phone
 * runs, does not implement the `microphone` name at all.
 *
 * THE DAY THE POLICY CHANGES, THIS LINE CHANGES WITH IT. Both files say so.
 */
export function dictationAvailable(scope: SpeechScope = globalThis as SpeechScope): boolean {
  if (scope.api !== undefined && scope.api !== null) return false;
  return ctorFrom(scope) !== null;
}

/**
 * Every failure the API reports, as something a person can act on.
 *
 * The codes are the spec's. The sentences are vam's, and they differ from each
 * other on purpose: each names a DIFFERENT act -- grant a permission, plug
 * something in, speak, or stop expecting this build to do it at all. A
 * microphone that does nothing and says nothing is the worst report there is.
 */
function sentenceFor(code: string): string {
  switch (code) {
    case 'not-allowed':
      return 'vam was not allowed to use the microphone — grant it in your browser or system settings, then try again.';
    case 'service-not-allowed':
      return 'the system refused the speech recogniser — it is turned off for this app or this device.';
    case 'no-speech':
      return 'nothing was heard, so nothing was written.';
    case 'audio-capture':
      return 'no microphone answered — check that one is connected and selected.';
    case 'network':
      return 'the speech recogniser is a network service and could not be reached — check the connection and try again.';
    case 'aborted':
      return 'dictation stopped before anything was transcribed.';
    default:
      return `the speech recogniser stopped: ${code}`;
  }
}

/**
 * Start listening. Returns `null` where there is no recogniser at all -- the
 * caller should not have drawn a button in that case, and this is the second
 * line rather than the first.
 *
 * `onEnd` fires exactly once per run, whoever ended it: a recogniser that
 * errors also ends, and a caller flipping a "listening" flag twice would leave
 * the button lit over a recogniser that stopped.
 */
export function startDictation(
  events: DictationEvents,
  scope: SpeechScope = globalThis as SpeechScope,
): DictationHandle | null {
  const Ctor = ctorFrom(scope);
  if (Ctor === null) return null;
  const recognition = new Ctor();
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    events.onEnd();
  };

  // THE OPERATOR'S LANGUAGE, NOT THE DOCUMENT'S. `<html lang>` is `en` and
  // describes vam's chrome; the person dictating speaks whatever their system
  // is set to, and `navigator.language` is the only thing on the page that
  // knows. Left empty the recogniser falls back to the document's, which is
  // how dictation ends up transcribing Vietnamese as English nonsense.
  recognition.lang = scope.navigator?.language ?? '';
  // A prompt is more than one sentence; the default stops at the first pause.
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    const from = event.resultIndex ?? 0;
    for (let i = from; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result === undefined || result.isFinal !== true) continue;
      const text = (result[0]?.transcript ?? '').trim();
      if (text !== '') events.onText(text);
    }
  };
  recognition.onerror = (event) => {
    events.onError(sentenceFor(event.error ?? 'unknown'));
  };
  recognition.onend = end;

  try {
    recognition.start();
  } catch (error) {
    // A recogniser already running throws rather than reporting. It is the
    // caller's bug, and it must not take the pane down with it.
    events.onError(
      `dictation could not start: ${error instanceof Error ? error.message : String(error)}`,
    );
    end();
    return null;
  }
  return {
    stop() {
      try {
        recognition.stop();
      } catch {
        // Already stopped; `onend` has fired or is about to.
      }
    },
  };
}
