/**
 * The one sentence per failure, shared by the card and the settings panel so
 * the two surfaces never word the same fact differently.
 *
 * NEVER A CODE. `rate-limited` and `checksum` are developer words; the
 * operator gets what happened and, where there is one, what to do.
 */

import type { UpdateErrorCode } from '../../shared/update.js';
import { type StringKey, t } from '../i18n/strings.js';

export function errorSentence(code: UpdateErrorCode): string {
  return t(`update.error.${code}` as StringKey);
}

/**
 * A retry is offered only where trying the same thing again can work. A
 * check-side failure re-asks (`check`); a download-side one re-downloads. The
 * install-location errors need the operator to act first, so no button.
 */
export type RetryAction = 'check' | 'download' | null;

export function retryFor(code: UpdateErrorCode): RetryAction {
  switch (code) {
    case 'network':
    case 'rate-limited':
    case 'malformed':
      return 'check';
    case 'checksum':
    case 'too-large':
    case 'quit-cancelled':
    case 'install-failed':
      return 'download';
    default:
      return null;
  }
}
