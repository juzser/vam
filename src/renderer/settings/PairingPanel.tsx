/**
 * Remote access, as the operator sees it: one code, and the devices it made.
 *
 * TAILSCALE AUTHENTICATES A DEVICE ONTO A NETWORK; IT DOES NOT AUTHORISE THAT
 * DEVICE TO DRIVE YOUR AGENTS. The panel says so in as many words, because the
 * whole screen is otherwise easy to read as "the address is secret" -- and it
 * is not: every laptop, phone, tablet, server, CI runner and shared-in
 * external user on the tailnet can reach it, and the FQDN is public in
 * Certificate Transparency logs. What the operator grants here is the ability
 * to close sessions and type into a running agent, which is why a correct code
 * is not enough on its own and the ALLOW prompt exists.
 *
 * Presentational only: every piece of state arrives as a prop and every act
 * leaves as a callback. The code, its clock and the device list all live in
 * main, where the registry is.
 *
 * STYLED WITH TAILWIND UTILITIES AND THE APP'S OWN TOKENS, like every other
 * component in this directory -- no new semantic classes, no rule added to
 * `styles.css`. This panel shipped with three (`pairing`, `pairing-code`,
 * `pairing-device-name`) that had no CSS rule anywhere in the repo, which
 * `test/settings/pairing-panel.test.tsx`'s styling suite now asserts against
 * directly on the rendered element, never against the stylesheet's text.
 */

import { Copy, Trash2 } from 'lucide-react';
import type { RemoteLinkKey } from '../../preload/api.js';
import { usePhoneViewport } from '../phone/viewport.js';
import { QrAddress } from './QrAddress.js';
import { Switch } from './Switch.js';

/** Mirrors main's `PairedDevice`, minus the token, which never leaves main. */
export type PairedDeviceView = {
  readonly deviceId: string;
  readonly name: string;
  readonly pairedAt: number;
  readonly lastSeenAt: number;
};

export type PairingView = {
  /** The eight raw symbols, or null while no screen-opened code is live. */
  readonly code: string | null;
  readonly expiresAtMs: number;
  readonly burned: boolean;
  /** Non-zero while pairing is disabled after a run of failures. */
  readonly throttledUntilMs: number;
  readonly awaiting: { readonly name: string; readonly source: string } | null;
  readonly pairedName: string | null;
};

/**
 * What the phone-access control needs to know, in the operator's own terms
 * rather than main's `ServeState` -- `cliMissing` folds in `ServeAddress`'s
 * `no-cli` reason, which `RemotePanel.tsx` already reads for the address, so
 * this panel does not need a second way to ask "is Tailscale here at all".
 *
 * `enabled` DOUBLES AS "WHICH ACTION `lastError`/`timedOut` CAME FROM" -- see
 * `src/main/remote/state.ts`'s `ServeState` comment for the invariant this
 * relies on: the only button ever drawn is Enable while `enabled` is false or
 * Disable while it is true, so a failure recorded while `enabled` is true can
 * only be a failed DISABLE. That is what gates the manual `tailscale serve
 * reset` suggestion below to exactly the case where it makes sense.
 */
export type ServeAccessView = {
  readonly cliMissing: boolean;
  readonly enabled: boolean;
  /** The most recent enable/disable refusal's own words, or null. */
  readonly lastError: string | null;
  /** The most recent attempt gave up waiting rather than getting an answer. */
  readonly timedOut: boolean;
  /**
   * Serve is administratively off for the WHOLE TAILNET -- measured against a
   * real Tailscale (1.102.2): `tailscale serve --bg` prints exactly this
   * enable link to stdout and then hangs, on a tailnet where Serve has never
   * been turned on (the first-run state for essentially every new user). The
   * one case where this panel points at something the operator can actually
   * go and do, so it is drawn as its own actionable state, never folded into
   * `lastError`'s alert box. Mutually exclusive with a non-null `lastError`
   * and a true `timedOut`.
   */
  readonly tailnetServeDisabledUrl: string | null;
  /** An enable/disable round trip is in flight -- see `RemotePanel.tsx`. */
  readonly pending: boolean;
};

export type PairingPanelProps = {
  readonly view: PairingView;
  readonly devices: readonly PairedDeviceView[];
  /**
   * The `https://<machine>.<tailnet>.ts.net` address `tailscale serve` prints.
   * NULL IS ORDINARY: reading it needs the Tailscale CLI, and vam does not
   * depend on one being installed. HTTPS only -- the certificate is what makes
   * the phone's origin a secure context, and a plain http MagicDNS URL is not.
   */
  readonly url: string | null;
  readonly allowWrites: boolean;
  /**
   * The persisted preference (`remote/writes-preference.ts`), which is what
   * `onSetWritesPreference` changes -- distinct from `allowWrites` above,
   * which is what THIS running server was actually started with and cannot
   * change without a restart. The two can disagree the moment the operator
   * flips the toggle.
   */
  readonly writesPreference: boolean;
  readonly nowMs: number;
  readonly serve: ServeAccessView;
  readonly onRegenerate: () => void;
  readonly onApprove: () => void;
  readonly onDeny: () => void;
  readonly onCopyUrl: () => void;
  readonly onRemove: (deviceId: string) => void;
  readonly onRevokeAll: () => void;
  /** Runs `tailscale serve --bg --yes <port>`. Never called merely by drawing this panel. */
  readonly onEnableServe: () => void;
  /** Runs the TARGETED off, reversing `onEnableServe` -- never `tailscale serve reset`. */
  readonly onDisableServe: () => void;
  /** Persists the preference above. Takes effect the next time vam starts. */
  readonly onSetWritesPreference: (next: boolean) => void;
  /**
   * Opens one of the panel's two external links, by key.
   *
   * OPTIONAL, and absent is the browser build: no preload bridge, no window
   * policy to be refused by, and an ordinary anchor that already works. See
   * `ExternalLink`.
   */
  readonly onOpenLink?: (key: RemoteLinkKey) => void;
};

/** `XXXX-XXXX`: a group of four is what a person holds while looking away. */
const grouped = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

function countdown(expiresAtMs: number, nowMs: number): string {
  const left = Math.max(0, Math.round((expiresAtMs - nowMs) / 1000));
  return `expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

const UNITS: readonly [number, string][] = [
  [86_400_000, 'day'],
  [3_600_000, 'hour'],
  [60_000, 'minute'],
];

/** Coarse on purpose: the operator is recognising a device, not auditing it. */
function ago(at: number, nowMs: number): string {
  const elapsed = Math.max(0, nowMs - at);
  for (const [size, unit] of UNITS) {
    const count = Math.floor(elapsed / size);
    if (count >= 1) {
      return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}

/** The words vam owns for a timeout -- main never invents this prose, see `ServeState`. */
const TIMED_OUT_MESSAGE = 'tailscale did not answer in time.';

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

/**
 * Every button in this panel. `min-h-[44px]` is a real hit floor (SC 2.5.5's
 * own AAA figure), called out for this file specifically -- and it is a
 * height alone, never a fixed width: there is a standing lesson that a 44px
 * floor does not check the PAINT, and a fixed box is exactly the shape that
 * clears a hit measurement while clipping a longer label. `px-4` lets the box
 * grow with its own content instead.
 *
 * IT HAS A RESTING FILL BECAUSE IT HAD NONE. The operator's report was "the
 * button in the Remote section of settings has the same colour as the
 * background, so it doesn't look like a button", and that was literally what
 * the paint said: `getComputedStyle` returned `rgba(0, 0, 0, 0)` for the fill,
 * so the box took whatever surface was behind it, and the only thing marking
 * it as a control was a `border-line` outline measuring 1.36:1 against the
 * `bg-panel` this dialog draws.
 *
 * WHICH LEAVES THE BOUNDARY TO CARRY THE IDENTIFICATION, and that is not a
 * preference. Every surface token vam owns sits within 1.49:1 of `panel` in
 * dark -- `raised` on `panel` measures 1.20:1, and `segment-on`, the top of
 * the whole ladder, only 1.49:1 -- so no fill in this palette can reach the
 * 3:1 WCAG 1.4.11 asks of the visual information that identifies a component.
 * `line-tip` is the one line token that exists to clear exactly that floor
 * (see its own note in `styles.css`, written when the tooltip hit this same
 * wall): measured here it is 4.24:1 in dark and 3.62:1 in light against the
 * panel behind it, where `line-loud` is 1.88:1 and `line-loudest` 3.08:1 --
 * the third pass's wider ladder happens to put `line-loudest` just over the
 * floor too, but `line-tip` is still the one derived to clear it with room.
 *
 * THE HOVER MOVES AWAY FROM THE SURFACE, never back into it. `raised` ->
 * `segment-on` is a step further from `panel` in both themes (lighter in dark,
 * darker in light), which is the direction the 0.2 pane-colour pass
 * established after a hover that closed the gap read as a hole punched in the
 * surface. `disabled:` lands
 * back on the resting fill rather than on `transparent`, or a hover over a
 * busy button would return it to the very state this comment exists about.
 * `e2e/settings-chrome-shots.mjs` measures all of it on the painted node.
 */
/*
 * `h-[28px]` PLUS `vam-tap`, NOT `min-h-[44px]`, and the difference is which
 * device is being sized for.
 *
 * These buttons carried an unconditional 44 -- the phone's touch floor -- so
 * they were 44px tall on the DESKTOP too, beside a dialog where every other
 * control is 28: the theme choices, the palette chips, the send-key pair, the
 * focus-view switch and the update button. Measured, not guessed: the button
 * census in `e2e/settings-chrome-shots.mjs` reports every rank on this
 * surface, and this was the only one on its own.
 *
 * `vam-tap` is how the rest of the app says "this is a touch target": the rule
 * is `.vam-phone .vam-tap { min-height: 44px }` (`styles.css`), so the floor
 * applies where a finger is and nowhere else. Same 44 on the phone, same 28 as
 * its neighbours here.
 */
const ACTION_BUTTON = `vam-tap flex h-[28px] w-fit cursor-pointer items-center gap-1.5 rounded border border-line-tip bg-raised px-4 text-control text-ink hover:bg-segment-on disabled:cursor-default disabled:opacity-60 disabled:hover:bg-raised ${FOCUS_RING}`;

/** The same shape, for an act that revokes access rather than merely toggling a setting. */
const DANGER_BUTTON = `vam-tap flex h-[28px] w-fit cursor-pointer items-center gap-1.5 rounded border border-danger px-4 text-control text-danger hover:bg-danger hover:text-ground ${FOCUS_RING}`;

/** The alert-box recipe `ErrorBoundary.tsx` already uses for a refusal in the operator's face. */
const ALERT_BOX = 'rounded-md border border-danger bg-panel p-3 text-control text-danger';

const HINT = 'max-w-[52ch] text-control text-ink-dim';
const SECTION = 'border-line-loud border-t pt-4';
const HEADING = 'font-medium text-body text-ink';

/**
 * A LINK OUT OF VAM, UNDER A WINDOW THAT REFUSES TO NAVIGATE.
 *
 * Operator: "in settings the tailscale link is not clickable." It was an
 * ordinary `target="_blank"` anchor, and `setWindowOpenHandler(() => ({ action:
 * 'deny' }))` in `src/main/index.ts` refuses every `window.open` in this app.
 * The link was not broken; it was refused, by policy, for the reason
 * `errors/report.ts` states: a renderer that can navigate off-origin is a
 * renderer that can exfiltrate.
 *
 * STILL AN ANCHOR. A `<button>` dressed as a link loses what a link announces
 * to a screen reader and what a pointer expects from one -- and the
 * destination really is reached, in the operating system's browser, which is
 * where an external page belongs. The `href` stays real, which is also what
 * makes the browser build need no branch: there is no bridge there, nothing
 * calls `preventDefault`, and the anchor works the way an anchor works.
 *
 * `onOpen` TAKES A KEY. Main owns both destinations; see `remoteOpenLink`.
 */
function ExternalLink({
  href,
  onOpen,
  linkKey,
  className,
  children,
}: {
  readonly href: string;
  readonly onOpen?: (key: RemoteLinkKey) => void;
  readonly linkKey: RemoteLinkKey;
  readonly className: string;
  readonly children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={className}
      onClick={(event) => {
        if (onOpen === undefined) return;
        // The window would deny this anyway. Stopping it here keeps one path
        // rather than two, and a second path is what later gets "fixed" by
        // widening the policy.
        event.preventDefault();
        onOpen(linkKey);
      }}
    >
      {children}
    </a>
  );
}

/**
 * One step of the connect-a-phone list.
 *
 * `done` is OPTIONAL and absent means "vam cannot tell", which is a different
 * thing from false -- the same distinction `Decision.errorCount` draws between
 * a source that cannot look and a source that looked and found none. An absent
 * mark draws the step's number; a false one draws an empty box, because "not
 * yet" is a state worth seeing on a list you are working down.
 */
function Step({
  id,
  done,
  children,
}: {
  readonly id: string;
  readonly done?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <li
      data-pairing-step={id}
      data-done={done === true ? 'true' : undefined}
      className={`flex gap-2 ${HINT}`}
    >
      {/* `text-ink`, NOT `text-running`. The four session-state tokens mean a
          session is running, waiting, done or failed, and a test in this
          file's own suite refuses them as decoration anywhere else -- it
          caught this line. The state is carried by the glyph and by the word
          beside it, so the colour was never the channel. */}
      <span aria-hidden="true" className={done === true ? 'text-ink' : 'text-ink-faint'}>
        {done === undefined ? '·' : done ? '✓' : '○'}
      </span>
      {/* Announced, because the glyph is decorative and "done" is the whole
          point of drawing one. */}
      {done !== undefined && <span className="sr-only">{done ? 'done' : 'not yet'}</span>}
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}

export function PairingPanel(props: PairingPanelProps) {
  const { view, nowMs, serve } = props;
  const throttled = view.throttledUntilMs > nowMs;
  // See `ServeAccessView`'s own comment: a lingering failure while `enabled`
  // is true can only be a failed DISABLE, so this is when the manual escape
  // hatch belongs -- never for a failed enable, where there is nothing yet to
  // reset.
  const failedToDisable = serve.enabled && (serve.lastError !== null || serve.timedOut);
  /** Phone width, read for ONE decision: whether to draw the QR (see below). */
  const phone = usePhoneViewport();

  return (
    <section data-testid="pairing-panel" className="flex flex-col gap-4 text-ink">
      <div>
        <h4 className={HEADING}>Remote access</h4>
        <p className={`mt-1 ${HINT}`}>
          Everyone on your tailnet reaches this address — every laptop, phone, server and shared-in
          guest. Being on the tailnet does not authorise a device to drive your agents; pairing it
          here is what does.
        </p>
      </div>

      {/* THE SEQUENCE, ON THE SCREEN WHERE IT HAPPENS. The README explains all
          of this; what it cannot do is be in front of somebody standing there
          with a phone in one hand. Five steps, in order, and the three vam can
          SEE the state of say so.
          
          THE TICKS ARE READINGS. Two of the five happen on the other device --
          a camera pointed at a QR, eight characters typed in -- and vam has no
          way to know either. They are drawn plainly rather than guessed at,
          and the note below says what a tick means, because a checklist that
          invents its own ticks is worse than one with none. */}
      <div className={SECTION}>
        <h4 className={HEADING}>Connecting a phone</h4>
        <ol data-testid="pairing-steps" className="mt-2 flex list-none flex-col gap-1.5">
          <Step id="tailscale" done={!serve.cliMissing}>
            Install Tailscale on this machine and on the phone, and sign both into the same tailnet.
          </Step>
          <Step id="serve" done={serve.enabled}>
            Turn on phone access below. It runs <code>tailscale serve</code>, which puts this
            machine's loopback server behind an <code>https://…ts.net</code> address.
          </Step>
          {/* WHAT THE PHONE SHOWS, named here, because the operator is holding
              that phone while they read this and "it worked" has to be
              recognisable. These two steps described a flow the server refused
              until the app shell was served without a token: scanning the code
              produced vam's own 401, whose body reads "check the pairing
              screen on the desktop" -- which the operator dutifully did, and
              found this walkthrough telling them to scan the code. */}
          <Step id="open">
            On the phone, scan the QR code beside that address with the camera — or open the address
            by hand. A pairing form loads, asking for a code; it can reach nothing else until it has
            one.
          </Step>
          <Step id="code">
            Press “Regenerate” here for a code, and type those eight characters into that form. The
            code lives two minutes, is single-use, and is deliberately not in the QR: the address is
            not a secret, and pairing is what authorises a device.
          </Step>
          <Step id="allow" done={props.devices.length > 0}>
            Allow the device when it appears here. You can revoke it later, one at a time or all at
            once.
          </Step>
        </ol>
        <p data-testid="pairing-steps-note" className={`mt-2 ${HINT}`}>
          A tick is what vam can see from here. The two steps on the phone have none, because this
          machine has no way to know a camera was pointed at anything.
        </p>
      </div>

      <div className={SECTION}>
        <h4 className={HEADING}>Phone access</h4>
        {serve.cliMissing ? (
          // OFFERS NOTHING (requirement 3): no button appears in this branch
          // at all, on either side of on/off -- there is no CLI to run one
          // with, and vam does not walk the operator through installing it.
          <p data-testid="serve-no-cli" className={`mt-1 ${HINT}`}>
            vam can turn this on for you, but there is no Tailscale on this machine.{' '}
            {/* An inline link inside a sentence is WCAG 2.5.5's own documented
                exception to the 44px target-size floor -- forcing this into a
                button-sized box would look absurd mid-paragraph. */}
            <ExternalLink
              href="https://tailscale.com/download"
              onOpen={props.onOpenLink}
              linkKey="download"
              className="text-ink underline underline-offset-2 hover:text-ink-dim"
            >
              Install Tailscale
            </ExternalLink>
            , then reopen this screen.
          </p>
        ) : serve.enabled ? (
          <>
            {props.url === null ? null : (
              <div className="mt-1 flex items-start gap-3">
                <p className="min-w-0 flex-1">
                  <span data-testid="pairing-url" className="font-mono text-body text-ink">
                    {props.url}
                  </span>{' '}
                  <button
                    type="button"
                    onClick={props.onCopyUrl}
                    className={`mt-2 ${ACTION_BUTTON}`}
                  >
                    <Copy aria-hidden="true" size={14} /> Copy address
                  </button>
                </p>
                {/* THE ADDRESS, DRAWN FOR A CAMERA (operator: "put a QR on the
                    desktop so the remote link opens straight from the phone").
                    A MagicDNS name is up to a hundred characters of hostname
                    that somebody would otherwise type into a phone keyboard,
                    and a mistyped one does not read as a typo -- it reads as
                    "vam's phone access does not work".

                    NOT ON A PHONE. This panel is reachable from the phone
                    shell too, and a phone showing itself a QR of its own
                    address is a picture of the thing already holding it. The
                    address, the copy button and everything else stay. */}
                {phone ? null : <QrAddress url={props.url} />}
              </div>
            )}
            <p data-testid="serve-on" className={`mt-1 ${HINT}`}>
              Phone access is on. Your whole tailnet — every laptop, phone, tablet, server, CI
              runner and shared-in guest on it — can reach this port until you turn it off.
            </p>
            <button
              type="button"
              onClick={props.onDisableServe}
              disabled={serve.pending}
              aria-busy={serve.pending}
              className={`mt-2 ${ACTION_BUTTON}`}
            >
              {serve.pending ? 'Turning off…' : 'Turn off phone access'}
            </button>
          </>
        ) : (
          <>
            <p data-testid="serve-off" className={`mt-1 ${HINT}`}>
              Enabling this runs <code>tailscale serve</code> on this machine: a standing
              configuration change that puts this port in front of your whole tailnet — every
              laptop, phone, tablet, server, CI runner and shared-in guest — until you turn it off
              again. It outlives vam, and it is https only: the certificate is what lets the phone
              keep a credential at all.
            </p>
            <button
              type="button"
              onClick={props.onEnableServe}
              disabled={serve.pending}
              aria-busy={serve.pending}
              className={`mt-2 ${ACTION_BUTTON}`}
            >
              {serve.pending ? 'Enabling…' : 'Enable phone access'}
            </button>
          </>
        )}
        {serve.tailnetServeDisabledUrl !== null ? (
          // THE ONE ACTIONABLE STATE: not an error box, because it is not an
          // error -- Serve being off tailnet-wide is the ordinary state of a
          // fresh tailnet, and the one thing on screen worth pointing at.
          <div
            data-testid="serve-tailnet-disabled"
            className="mt-2 rounded-md border border-line-loud bg-well p-3"
          >
            <p className={HINT}>
              Serve is turned off for your whole tailnet. A tailnet admin needs to turn it on here,
              then Enable phone access can be pressed again:
            </p>
            <ExternalLink
              href={serve.tailnetServeDisabledUrl}
              onOpen={props.onOpenLink}
              linkKey="serve-admin"
              className="mt-1 inline-block break-all font-mono text-control text-ink underline underline-offset-2 hover:text-ink-dim"
            >
              {serve.tailnetServeDisabledUrl}
            </ExternalLink>
          </div>
        ) : serve.lastError === null && !serve.timedOut ? null : (
          <p data-testid="serve-error" role="alert" className={`mt-2 ${ALERT_BOX}`}>
            {serve.timedOut ? TIMED_OUT_MESSAGE : serve.lastError}
            {failedToDisable ? (
              <>
                {' '}
                You can turn it off yourself by running <code>tailscale serve reset</code>.
              </>
            ) : null}
          </p>
        )}
      </div>

      <div className={SECTION}>
        <p data-testid="pairing-writes" className={HINT}>
          {props.allowWrites
            ? 'This server accepts writes: a paired device can close sessions and type into a running agent.'
            : 'This server is read-only: the write routes are not registered at all.'}
        </p>
        {/* A SWITCH, BECAUSE THIS ONE IS A SETTING. It stores a boolean and
            does nothing else -- it runs nothing, reaches nothing outside vam,
            and the sentence above already says what each state means, so the
            control does not have to be a verb as well. `Switch.tsx` argues
            the line: phone access, a few lines up, keeps its button because
            turning it on runs `tailscale serve` on this machine. */}
        <div className="mt-2">
          <Switch
            name="writes-preference"
            label="allow writes from a paired device"
            checked={props.writesPreference}
            onChange={(next) => props.onSetWritesPreference(next)}
          />
        </div>
        {props.writesPreference === props.allowWrites ? null : (
          <p data-testid="pairing-writes-preference" className={`mt-1 ${HINT}`}>
            {props.writesPreference
              ? 'Writes will be allowed the next time vam starts.'
              : 'Writes will be read-only the next time vam starts.'}
          </p>
        )}

        {view.code === null ? (
          <button type="button" onClick={props.onRegenerate} className={`mt-3 ${ACTION_BUTTON}`}>
            {view.burned ? 'Regenerate' : 'Show a pairing code'}
          </button>
        ) : (
          <div className="mt-3">
            <div className="rounded-md border border-line-loud bg-well px-6 py-4 text-center">
              {/* LARGE, MONOSPACE, GENEROUSLY TRACKED: the one element on this
                  whole screen whose entire job is being read across a room
                  and retyped into a phone, by a human looking away from this
                  screen while they do it.

                  OFF THE TYPE SCALE, and named as such in
                  `test/renderer/type-scale.test.ts`. The scale's four steps
                  run 11 to 15px and describe text you read at a desk; this is
                  display type for a transcription task, and folding it into
                  `heading` would take it from 40px to 15 and undo the whole
                  point of the element. */}
              <p
                data-testid="pairing-code"
                className="font-mono text-[40px] text-ink tracking-[0.3em]"
              >
                {grouped(view.code)}
              </p>
              <p data-testid="pairing-countdown" className="mt-1 text-control text-ink-dim">
                {countdown(view.expiresAtMs, nowMs)}
              </p>
            </div>
            <button type="button" onClick={props.onRegenerate} className={`mt-3 ${ACTION_BUTTON}`}>
              Regenerate
            </button>
          </div>
        )}
      </div>

      {view.awaiting === null ? null : (
        <section data-testid="pairing-approval" aria-label="allow this device" className={SECTION}>
          {/*
            THE NAME IS ATTACKER-CHOSEN TEXT and it is the operator's only
            discriminator here: `source` behind `tailscale serve` is always
            127.0.0.1 and says nothing. So it is rendered as its own quoted
            block, never inside the sentence -- a name that sat in the prose
            could close a quotation and prepend "Read-only." to argue against
            the warning it is standing in. Main strips the punctuation that
            would let it try; this is the half that means it has nothing to
            close even if some got through.
          */}
          <p className={HINT}>A device is asking to pair. It calls itself:</p>
          <p
            data-testid="pairing-device-name"
            className="mt-1 inline-block rounded border border-line-loud bg-well px-2 py-1 font-mono text-body text-ink"
          >
            {view.awaiting.name}
          </p>
          <p data-testid="pairing-grant" className={`mt-2 ${HINT}`}>
            Allow it?{' '}
            {props.allowWrites
              ? 'It will be able to read your sessions and to type into a running agent.'
              : 'It will be able to read your sessions; this server is read-only, so it cannot type into an agent.'}
          </p>
          <p data-testid="pairing-source" className={HINT}>
            Connecting from {view.awaiting.source}.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={props.onApprove} className={ACTION_BUTTON}>
              Allow this device
            </button>
            <button type="button" onClick={props.onDeny} className={ACTION_BUTTON}>
              Don't allow
            </button>
          </div>
        </section>
      )}

      {view.burned || throttled ? (
        <p data-testid="pairing-warning" role="alert" className={ALERT_BOX}>
          {throttled
            ? 'Too many failed attempts: an unpaired device is trying to connect. Pairing is off for 15 minutes.'
            : 'Code burned after five wrong answers — press Regenerate for a new one.'}
        </p>
      ) : null}

      <p data-testid="pairing-status" className={HINT}>
        {view.pairedName === null
          ? view.code === null
            ? 'No code is live. A device can only pair while one is.'
            : 'Waiting for a device…'
          : `Paired: ${view.pairedName}`}
      </p>

      <div className={SECTION}>
        <h4 className={HEADING}>Paired devices</h4>
        <div data-testid="paired-devices" className="mt-2">
          {props.devices.length === 0 ? (
            <p className={HINT}>No devices are paired.</p>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {props.devices.map((device) => (
                  <li
                    key={device.deviceId}
                    data-testid={`paired-device-${device.deviceId}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-line px-3 py-2"
                  >
                    <span className="text-body text-ink">{device.name}</span>
                    <span className="text-meta text-ink-dim">
                      paired {ago(device.pairedAt, nowMs)}, last seen{' '}
                      {ago(device.lastSeenAt, nowMs)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${device.name}`}
                      onClick={() => props.onRemove(device.deviceId)}
                      className={`ml-auto ${DANGER_BUTTON}`}
                    >
                      <Trash2 aria-hidden="true" size={14} /> Remove
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={props.onRevokeAll} className={`mt-3 ${DANGER_BUTTON}`}>
                Revoke all
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
