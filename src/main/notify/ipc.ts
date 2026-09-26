/**
 * The notification channels: two pulls from the renderer, one push back.
 *
 * Validation is the whole of what this file adds over `notify.ts`. The
 * arguments arrive from the least trusted process in the app, so the shape is
 * checked field by field and bounded -- a title is a session name and a body
 * is one line, and `MAX_TEXT_LENGTH` is far above either while keeping a
 * compromised renderer from parking a large string on main's event loop
 * (`clipboard/ipc.ts` makes the same bargain).
 *
 * Registered inside `createWindow()`, like `registerMainErrorIpc`: the click
 * handler needs THIS window's `webContents` to push `notifyActivated` to.
 */

import type { NotifyVerdict } from '../../shared/notify.js';
import type { IpcMainLike, WebContentsLike } from '../errors/ipc.js';
import { CHANNELS } from '../ipc/channels.js';
import type { Notifier, NotifyRequest, NotifyTarget } from './notify.js';

export const MAX_TEXT_LENGTH = 2_000;

function isTarget(raw: unknown): raw is NotifyTarget {
  if (typeof raw !== 'object' || raw === null) return false;
  const { sourceId, sessionId } = raw as Record<string, unknown>;
  return (
    typeof sourceId === 'string' &&
    sourceId.length > 0 &&
    sourceId.length <= MAX_TEXT_LENGTH &&
    typeof sessionId === 'string' &&
    sessionId.length > 0 &&
    sessionId.length <= MAX_TEXT_LENGTH
  );
}

function isRequest(raw: unknown): raw is NotifyRequest {
  if (!isTarget(raw)) return false;
  const { title, body } = raw as unknown as Record<string, unknown>;
  return (
    typeof title === 'string' &&
    title.length > 0 &&
    title.length <= MAX_TEXT_LENGTH &&
    typeof body === 'string' &&
    body.length <= MAX_TEXT_LENGTH
  );
}

/**
 * The click route, built BEFORE the notifier so it can be handed in as
 * `onActivate`: `focusWindow` brings vam forward, then the renderer is told
 * which session the banner was about and moves the cursor there.
 */
export function notifyActivationRoute(
  webContents: WebContentsLike,
  focusWindow: () => void,
): (target: NotifyTarget) => void {
  return (target) => {
    focusWindow();
    webContents.send(CHANNELS.notifyActivated, {
      sourceId: target.sourceId,
      sessionId: target.sessionId,
    });
  };
}

export function registerNotifyIpc(ipcMain: IpcMainLike, notifier: Notifier): void {
  ipcMain.handle(CHANNELS.notifyShow, (_event, ...args: unknown[]): boolean => {
    const [request] = args;
    if (args.length !== 1 || !isRequest(request)) return false;
    return notifier.show({
      sourceId: request.sourceId,
      sessionId: request.sessionId,
      title: request.title,
      body: request.body,
    });
  });
  ipcMain.handle(CHANNELS.notifyClose, (_event, ...args: unknown[]): void => {
    const [target] = args;
    if (args.length !== 1 || !isTarget(target)) return;
    notifier.close({ sourceId: target.sourceId, sessionId: target.sessionId });
  });
  // The settings button. Nothing is read from the renderer -- title and body
  // are main's -- and an argument anyway is refused with the verdict a banner
  // that was never raised deserves, rather than reaching the OS.
  ipcMain.handle(CHANNELS.notifyTest, (_event, ...args: unknown[]): Promise<NotifyVerdict> => {
    if (args.length !== 0) return Promise.resolve({ kind: 'unconfirmed' });
    return notifier.test();
  });
}
