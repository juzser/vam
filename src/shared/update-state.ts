/**
 * The updater's legal transitions, as a pure function. The controller in main
 * feeds it events and broadcasts whatever state comes back; an event that does
 * not apply from the current state returns that same state object unchanged,
 * so `next === prev` means "nothing happened".
 *
 * Renderer-safe: no `electron`, no `node:` import.
 */

import type { UpdateErrorCode, UpdateStatus } from './update.js';

export type UpdateEvent =
  | { readonly type: 'check-start'; readonly manual: boolean }
  /** Only `available`, `not-available` and `error` are results of a check. */
  | { readonly type: 'check-result'; readonly status: UpdateStatus }
  | { readonly type: 'download-start' }
  | { readonly type: 'progress'; readonly percent: number }
  | { readonly type: 'install-start' }
  | { readonly type: 'fail'; readonly message: string; readonly code: UpdateErrorCode }
  | { readonly type: 'dismiss' }
  | { readonly type: 'reset' };

export function reduce(state: UpdateStatus, event: UpdateEvent): UpdateStatus {
  switch (event.type) {
    case 'check-start':
      // A running download or install is never interrupted by a check.
      if (state.kind === 'downloading' || state.kind === 'installing') return state;
      return { kind: 'checking', manual: event.manual };

    case 'check-result': {
      if (state.kind !== 'checking') return state;
      const k = event.status.kind;
      if (k !== 'available' && k !== 'not-available' && k !== 'error') return state;
      return event.status;
    }

    case 'download-start':
      if (state.kind !== 'available') return state;
      return { kind: 'downloading', version: state.version, percent: 0 };

    case 'progress': {
      if (state.kind !== 'downloading') return state;
      if (!Number.isFinite(event.percent)) return state;
      const next = Math.min(100, Math.max(0, event.percent));
      if (next <= state.percent) return state;
      return { kind: 'downloading', version: state.version, percent: next };
    }

    case 'install-start':
      if (state.kind !== 'downloading') return state;
      return { kind: 'installing', version: state.version };

    case 'fail':
      if (
        state.kind !== 'checking' &&
        state.kind !== 'downloading' &&
        state.kind !== 'installing'
      ) {
        return state;
      }
      return { kind: 'error', message: event.message, code: event.code };

    case 'dismiss':
      return state.kind === 'available' ? { kind: 'idle' } : state;

    case 'reset':
      return state.kind === 'error' || state.kind === 'not-available' ? { kind: 'idle' } : state;
  }
}
