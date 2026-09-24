import { type FormEvent, useState } from 'react';
import { submitPairing } from '../sources/pair.js';

/**
 * WHERE THE OPERATOR TYPES THE PAIRING CODE.
 *
 * Operator, holding the phone after the app shell was opened: "I still don't
 * see anywhere to enter the pairing code." They were right. Serving the page
 * without a token was necessary and not sufficient: nothing in the repository
 * posted to `/api/pair`, no request carried an `authorization` header, and the
 * browser build asked `/api/describe`, was refused, and drew that refusal as a
 * banner over an empty canvas. Reproduced by rendering it against a 401
 * origin: zero inputs on the page.
 *
 * ── THE KEYBOARD IS PART OF THE CONTROL ───────────────────────────────────
 * The alphabet is Crockford base32 minus the glyphs a person confuses -- no I,
 * L, O or U, no 0 or 1 -- eight characters, upper case (`pairing.ts`). On a
 * phone that means `autocapitalize="characters"` and autocorrect and
 * spellcheck OFF: there is nothing for a dictionary to contribute and a great
 * deal for it to break. The input is upper-cased on the way out too, because
 * the keyboard hint is a hint and not a guarantee.
 *
 * ── IT INVENTS NO DIAGNOSIS ───────────────────────────────────────────────
 * A wrong code, a burned one, an expired one, a screen that was never opened
 * and a rate-limited caller are ONE 401 with ONE message, deliberately: naming
 * the state would make the endpoint an oracle for "is the operator at the
 * pairing screen right now" (`server.ts`). So this shows the server's sentence
 * verbatim and adds nothing. "Wrong code" would be a distinction vam is
 * deliberately not told.
 *
 * ── AND IT CLAIMS NOTHING IT DID NOT GET ──────────────────────────────────
 * `onPaired` fires only on a token. A screen that cleared itself and looked
 * successful on a refusal would be this project's oldest defect -- two
 * different outcomes looking the same -- on the one screen where the operator
 * has no other way to tell.
 */
export function PairingScreen({
  onPaired,
  pair = submitPairing,
}: {
  readonly onPaired: (token: string) => void;
  /** Injected for tests; the real one is the POST in `sources/pair.ts`. */
  readonly pair?: (code: string, name: string) => Promise<string>;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const typed = code.trim().toUpperCase();
    if (typed === '' || sending) return;
    setSending(true);
    setRefusal(null);
    void pair(typed, name.trim() === '' ? 'a phone' : name.trim())
      .then((token) => {
        onPaired(token);
      })
      .catch((reason: unknown) => {
        const said =
          typeof reason === 'object' && reason !== null && 'message' in reason
            ? String((reason as { message: unknown }).message)
            : 'the pairing request was refused';
        setRefusal(said);
      })
      .finally(() => setSending(false));
  };

  return (
    <main
      data-pairing-screen
      className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-ground px-6 py-10 text-ink"
    >
      <div className="flex w-full max-w-[320px] flex-col gap-1">
        <h1 className="font-medium text-body">Pair this device</h1>
        <p className="text-control text-ink-dim">
          On the desktop, open Settings → Remote and press “Regenerate” for a code. It lives two
          minutes.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex w-full max-w-[320px] flex-col gap-3">
        <label className="flex flex-col gap-1 text-control text-ink-dim">
          Pairing code
          <input
            value={code}
            // The desktop shows the code GROUPED, `XXXX-XXXX` (`PairingPanel.
            // tsx`'s own `grouped`) -- "a group of four is what a person
            // holds while looking away." Typed back exactly as shown, the
            // hyphen used to occupy one of the eight `maxLength` slots and
            // push a real character off the end, so `ABCD-2345` arrived as
            // `ABCD-234` -- never a valid code. Stripped here rather than at
            // submission: the field's own `maxLength` must count only the
            // characters the server will ever see.
            onChange={(event) => setCode(event.target.value.replace(/[^0-9A-Za-z]/g, ''))}
            // See the header: the alphabet is upper-case and has no words in
            // it, so every helpful keyboard feature is an unhelpful one here.
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            maxLength={8}
            aria-label="pairing code"
            className="vam-tap rounded-[8px] border border-line-strong bg-card px-3 py-2 text-center font-mono text-[24px] text-ink uppercase tracking-[0.2em] outline-none focus:border-ink-faint"
          />
        </label>

        <label className="flex flex-col gap-1 text-control text-ink-dim">
          Device name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={64}
            placeholder="a phone"
            aria-label="device name"
            // The desktop asks "allow this device?" by NAME, and approving
            // "an unnamed device" is a poor thing to be asked.
            //
            // 16px, not `text-body` (13px): iOS Safari zooms the
            // page on focus for any control under that size and does not undo it
            // cleanly (`styles.css`'s own `[data-phone-shell] input` rule,
            // word for word). This screen mounts before any shell exists --
            // there is nothing paired yet to host one -- so that selector
            // never reaches it, and the gap is unconditional: a desktop
            // browser can land here too, and 16px costs it nothing.
            className="vam-tap rounded-[8px] border border-line-strong bg-card px-3 py-2 text-[16px] text-ink outline-none focus:border-ink-faint"
          />
        </label>

        <button
          type="submit"
          disabled={sending || code.trim() === ''}
          className="vam-tap cursor-pointer rounded-[8px] bg-ink px-3 py-2 font-medium text-control text-ground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? 'Pairing…' : 'Pair'}
        </button>
      </form>

      {refusal !== null && (
        // `role="alert"`, because the operator's eyes are on the keyboard they
        // just typed into and the message appears below it.
        <p
          role="alert"
          data-pairing-refusal
          className="w-full max-w-[320px] text-control text-failed"
        >
          {refusal}
        </p>
      )}

      <p className="w-full max-w-[320px] text-ink-quiet text-meta">
        Then allow the device on the desktop. Until you do, this page can reach nothing else.
      </p>
    </main>
  );
}
