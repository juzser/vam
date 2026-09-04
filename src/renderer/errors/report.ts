/**
 * One recorded event, turned into a GitHub issue the OPERATOR submits.
 *
 * vam never posts. Not with a token, not with `fetch`, not on a confirmation
 * -- there is no network call anywhere on this path, and the test asserts
 * that as an absence rather than trusting the reading. What this module
 * produces is text and a prefilled `issues/new` URL; pressing the button on
 * github.com is a decision that belongs to the person whose machine the
 * failure happened on, and it is also the last moment they can read the body
 * before it becomes public. Automating that away would remove the only human
 * review the report ever gets.
 *
 * The URL is handed over rather than opened: the app denies `window.open`
 * and every off-origin navigation by policy (`src/main/csp.ts`), so the
 * report panel copies it to the clipboard and shows it. That is not a
 * workaround for the policy, it is the policy working -- a renderer that
 * could navigate to github.com is a renderer that could exfiltrate to it.
 *
 * `scrub` runs over the ASSEMBLED body, not field by field, which is what
 * makes it impossible to add a field later that skips it. It also means the
 * body may not use markdown backticks: the scrubber redacts backticked runs
 * (a shell remedy carries session names), and it would swallow the failure
 * code along with them. Measured, not predicted -- it did.
 */

import type { LoggedEvent } from './log.js';
import { scrub } from './scrub.js';

/** The public repository this app belongs to. */
export const NEW_ISSUE_URL = 'https://github.com/juzser/vam/issues/new';

export type Report = {
  readonly title: string;
  readonly body: string;
  /** Prefilled. Nothing in this module opens it. */
  readonly url: string;
};

/**
 * The note at the foot of every report. It tells a maintainer why the body
 * has holes in it -- an issue full of `<redacted>` with no explanation reads
 * like a broken template rather than a deliberate one -- and it tells the
 * operator, at the moment they are about to submit, exactly what was taken
 * out and what was not.
 */
const FOOTER = [
  '---',
  "Composed by vam's error log and scrubbed before leaving the machine:",
  'home paths, project and branch names, quoted session names, session ids,',
  'pids and email addresses were replaced. No prompt or transcript content is',
  'ever included. Please add anything else you are able to share.',
].join('\n');

/**
 * `homeDir` is optional and usually absent -- the renderer has no `os`. The
 * scrubber's rules are shape-based for that reason; passing it only helps
 * when the home directory's name appears outside a path.
 */
export function composeReport(event: LoggedEvent, homeDir?: string): Report {
  const title = scrub(`${event.code} while attempting: ${event.action}`, homeDir);
  const body = scrub(
    [
      '### What vam was attempting',
      event.action,
      '',
      '### What happened',
      `${event.code} (${event.kind})`,
      '',
      event.message,
      '',
      '### When',
      event.at,
      '',
      FOOTER,
    ].join('\n'),
    homeDir,
  );
  const url = `${NEW_ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  return { title, body, url };
}
