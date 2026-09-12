/**
 * ONE BOOLEAN, DRAWN AS A SWITCH.
 *
 * Operator: "turn some of the settings buttons into a toggle UI." Two controls
 * in Settings were already switches to a screen reader -- `role="switch"` and
 * an `aria-checked` -- and a bordered word reading `on` or `off` to everybody
 * else. That is the half that was missing: a state is read off a track and a
 * knob AT A GLANCE, where a word has to be read, and a word in a box is the
 * same picture as the buttons beside it that are not states at all.
 *
 * ── WHAT IS A SWITCH HERE AND WHAT IS NOT ─────────────────────────────────
 * A SWITCH IS A SETTING: a stored boolean, applied by vam, reversible by the
 * same gesture, with nothing outside this process to fail. Focus view is one,
 * and so is the remote server's writes preference.
 *
 * PHONE ACCESS IS NOT, and it keeps its button on purpose. Turning it on runs
 * `tailscale serve`: a standing configuration change on this machine that
 * outlives vam, takes time, and can fail. A switch says "this is a setting,
 * flick it"; a button that reads `Turn on phone access` says an act is about
 * to happen, which is what the panel's own prose says too.
 *
 * ── THE PARTS, AND WHY EACH ONE IS THERE ──────────────────────────────────
 *  - THE TRACK AND THE KNOB are `aria-hidden`: they are the picture of the
 *    state, and the state itself is `aria-checked`. A screen reader that read
 *    both would say it twice.
 *  - THE WORD STAYS. It is not redundancy for its own sake -- the position of
 *    a knob is a convention, and `on`/`off` is the same fact for a reader who
 *    does not share it. It also keeps `textContent` a thing tests can read.
 *  - THE NAME IS WHAT THE SWITCH CONTROLS, never the state it is in. A name
 *    that flipped with the value ("turn writes on" / "turn writes off") makes
 *    it a different control on every press, and a screen reader then announces
 *    the state twice and the purpose never.
 *  - `vam-tap` grows the whole control to the phone's 44px floor
 *    (`styles.css`); the drawn track stays 34x20 inside it.
 */

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

export function Switch({
  checked,
  onChange,
  label,
  name,
  on = 'on',
  off = 'off',
}: {
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  /** The accessible name: what this controls. Never its state. */
  readonly label: string;
  /** The hook tests and guards find it by — `data-switch="focus-view"`. */
  readonly name: string;
  readonly on?: string;
  readonly off?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      data-switch={name}
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`vam-tap flex h-[28px] w-fit cursor-pointer items-center gap-2 rounded text-control capitalize ${
        checked ? 'text-ink' : 'text-ink-dim'
      } ${FOCUS_RING}`}
    >
      {/* THE TRACK, AND WHY IT IS INK AND NOT A LINE COLOUR.
          WCAG 1.4.11 asks the parts that identify a control and its state to
          clear 3:1 against what is next to them. Measured in the browser, the
          loudest LINE token vam has reads 2.22:1 on this panel and `line`
          itself reads 1.18 -- which is the palette working as designed, since
          every surface vam owns deliberately sits within 1.33:1 of `panel`
          (`styles.css`). A hairline drawn from that ladder cannot make a
          boundary here, so the track borrows a TEXT ink, `ink-faint`, at
          5.25:1. The first version of this control used `border-line` and
          `e2e/settings-chrome-shots.mjs` failed it at 1.18:1.

          THE FILL FLIPS, WHICH IS THE OTHER HALF. A dark groove becomes a
          light pill: that is a state change legible across a room, where two
          near-identical greys and a moved dot are a state change legible only
          to somebody already looking. Both fills are measured against the
          knob that sits on them. */}
      <span
        data-switch-track
        aria-hidden="true"
        className={`relative block h-[20px] w-[34px] shrink-0 rounded-full border border-ink-faint transition-colors ${
          checked ? 'bg-ink-faint' : 'bg-sunken'
        }`}
      >
        {/* THE KNOB, and its travel is the state. 14px in a 34px track with a
            2px inset leaves exactly 14px of movement, which is a full knob's
            width -- a shift small enough to miss is the defect this whole
            change is about. It inverts with the track so that whichever way
            the switch is thrown, the dot is the thing you can see. */}
        <span
          data-switch-knob
          aria-hidden="true"
          className={`absolute top-[2px] block h-[14px] w-[14px] rounded-full transition-all ${
            checked ? 'left-[17px] bg-ground' : 'left-[3px] bg-ink-faint'
          }`}
        />
      </span>
      {checked ? on : off}
    </button>
  );
}
