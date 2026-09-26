/**
 * ONE FLAG: does this device raise a desktop notification when a session
 * crosses into `waiting`.
 *
 * ── PER DEVICE, FOR FREE ──────────────────────────────────────────────────
 * Prefs are `localStorage` (`prefs.ts`'s header), so this switch describes
 * the machine that is looking, which is exactly what a notification switch
 * should describe: the desktop decides for the desktop. It is NOT drawn on
 * the phone today -- `settings/sections.ts`'s `PHONE_SECTIONS` rule says a
 * row reaching the phone is a deliberate decision, and this one has not been
 * made. When it is, it is this same key in that browser's storage, and no
 * cross-device plumbing is needed or wanted.
 *
 * ── ONE SWITCH, AND THE LIST OF WHAT IT IS NOT ────────────────────────────
 * No per-session mute, no per-status pick, no sound, no quiet hours, no
 * snooze. The OS owns sound and Do Not Disturb and does them better than a
 * second copy inside vam could; `waiting` is the one status whose whole
 * meaning is "a person is needed", so a pick among statuses would be a menu
 * with one honest entry. The operator has form on this: an entire tab
 * indicator settings block went with "there is no need for a session tab
 * indicator setting" (`./tab-indicators.ts`).
 *
 * A file of its own for the reason `concise-output.ts` is: the DEFAULT is a
 * decision worth finding by name.
 */

/**
 * ON. Not a taste, and the opposite call from `concise-output.ts`, for a
 * reason worth stating beside it.
 *
 * That one ships off because "on" types a paragraph into somebody else's
 * agent. This one types nothing, sends nothing anywhere, and interrupts only
 * when the operator is demonstrably NOT looking at the session in question
 * (`notify/waiting.ts`). And it answers the sentence this application's own
 * polling loop was written under: "an app whose stated purpose is making the
 * `waiting` state impossible to miss" (`sources/useSourceModel.ts`). A
 * default of `false` would ship that purpose switched off.
 *
 * THE COST, NAMED: on a machine where macOS will not deliver to this bundle,
 * "on" produces a line in the error log instead of a banner -- once per
 * distinct reason, since consecutive repeats collapse. That line is the
 * instrument (`main/notify/notify.ts`), and an operator who would rather not
 * see it has one switch.
 */
export const DEFAULT_NOTIFY_WAITING = true;

/**
 * A boolean is a choice; anything else is the default. Symmetric on purpose,
 * unlike `readConciseOutput`: neither direction here types into an agent, so
 * an unreadable value costs the operator nothing worse than the default.
 */
export function readNotifyWaiting(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : DEFAULT_NOTIFY_WAITING;
}
