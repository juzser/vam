/**
 * What this connection cannot do, in the source's own words.
 *
 * Generated from `declines`, never written here: a sentence hard-coded in a
 * component would go stale the first time a source gains a capability.
 *
 * WHY IT IS IN SETTINGS AND NOT ON THE SESSION SCREEN. It was a band above the
 * transcript in `PhoneShell`, and it cost 45px of every session screen on every
 * real phone -- measured against a remote-shaped source, where the server turns
 * four capabilities off for every client. It reads 0px under `?demo=1`, which
 * declines nothing, which is exactly why the repo's own phone suite never saw
 * what it was spending. The content is a standing fact about the CONNECTION and
 * not about the session being read, and it does not change while the operator
 * works; Remote is the one settings section whose subject is the desktop rather
 * than the device holding it (`sections.ts`, `PHONE_SECTIONS`), so that is
 * where a fact about the connection belongs.
 *
 * `vam-tap` ON THE SUMMARY, not the enumeration in `styles.css`. The rule that
 * gave this its 44px floor was `[data-phone-shell] [data-remote-limits]
 * summary`, and the settings dialog is NOT inside `[data-phone-shell]` -- it is
 * a sibling under the common `.vam-phone` root. Moving the component without
 * moving its floor would have handed the phone a 21px disclosure triangle, and
 * `e2e/phone-shell.pw.ts`'s settings census is what would have caught it.
 */

import type { SourceDeclines } from '../sources/port.js';

export function RemoteLimits({ declines }: { readonly declines: SourceDeclines }) {
  const entries = Object.entries(declines).filter(([, why]) => why !== undefined && why !== '');
  if (entries.length === 0) return null;
  return (
    <details
      data-remote-limits
      className="rounded-[var(--radius-sm)] border border-line bg-card px-2.5"
    >
      <summary className="vam-tap flex min-h-[44px] cursor-pointer items-center text-control text-ink-dim">
        What this connection cannot do
      </summary>
      <ul className="pb-2">
        {entries.map(([name, why]) => (
          <li key={name} data-remote-limit={name} className="py-1 text-control text-ink-dim">
            {why}
          </li>
        ))}
      </ul>
    </details>
  );
}
