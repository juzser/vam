/**
 * What the OS said about a banner, as the settings panel needs to hear it.
 *
 * Renderer-safe: no `electron`, no `node:` import. Main's notifier
 * (`src/main/notify/notify.ts`) writes two of these three into the error log
 * for every real banner; for the Test notification button it also hands the
 * verdict back inline, because "open the error log" is not an answer to a
 * button whose whole purpose is to say what happened.
 *
 * `failed` carries the OS's text VERBATIM -- it is the diagnosis, and the
 * panel prints it rather than paraphrasing it (the notifier's header).
 */
export type NotifyVerdict =
  | { readonly kind: 'sent' }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'unconfirmed' };
