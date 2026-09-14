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
 * WHAT THAT SENTENCE DID NOT FOLLOW FROM, and was read as implying for one
 * release too long: that the OPERATOR may not be taken there. Copying a
 * four-kilobyte URL was the only route, out of a panel whose text could not be
 * selected, so in practice there was no route -- reported from use as "the
 * error log cannot create an issue". `CHANNELS.issueOpen` is the answer, and
 * it keeps the policy exactly: the renderer sends this module's `title` and
 * `body`, main owns the address, and the operator still presses submit on
 * github.com themselves.
 *
 * `scrub` runs over the ASSEMBLED body, not field by field, which is what
 * makes it impossible to add a field later that skips it. It also means the
 * body may not use markdown backticks: the scrubber redacts backticked runs
 * (a shell remedy carries session names), and it would swallow the failure
 * code along with them. Measured, not predicted -- it did.
 */

import { issueUrl, NEW_ISSUE_URL } from '../../shared/issue.js';
import type { LoggedEvent } from './log.js';
import { scrub } from './scrub.js';

/**
 * Re-exported, not declared. The address moved to `src/shared/issue.ts` when
 * main gained a channel that opens it (`CHANNELS.issueOpen`): two processes
 * have to agree about the destination, and two copies of a string in two
 * processes is a pair that drifts silently -- the panel showing one address
 * while the browser opens another.
 */
export { NEW_ISSUE_URL };

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
  'home paths, quoted names, vam tmux session names, session ids, pids and',
  'email addresses were replaced, and no prompt or transcript text is ever',
  'included. The scrubber works by shape, so an unquoted name or a path',
  'outside your home directory can survive it -- please read the body before',
  'you submit, and add anything else you are able to share.',
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
  return { title, body, url: issueUrl(title, body) };
}
