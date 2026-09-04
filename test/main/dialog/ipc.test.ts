/**
 * The directory picker's main-process half.
 *
 * Electron's `dialog` is a parameter, exactly as `clipboard` is for the
 * clipboard channel: nothing here opens a window, and the whole point of the
 * seam is that the three answers -- a directory, a cancel, and a dialog that
 * threw -- can each be asserted without one.
 */

import { describe, expect, it } from 'vitest';
import { registerDialogIpc } from '../../../src/main/dialog/ipc.js';
import { CHANNELS } from '../../../src/main/ipc/channels.js';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function harness(dialog: { showOpenDialog(options: unknown): Promise<unknown> }) {
  const handlers = new Map<string, Handler>();
  registerDialogIpc({ handle: (channel, listener) => void handlers.set(channel, listener) }, dialog);
  const handler = handlers.get(CHANNELS.chooseDirectory);
  if (handler === undefined) throw new Error('chooseDirectory was never registered');
  return handler;
}

describe('registerDialogIpc', () => {
  it('asks for a directory, and answers with the one chosen', async () => {
    const seen: unknown[] = [];
    const handler = harness({
      showOpenDialog: async (options) => {
        seen.push(options);
        return { canceled: false, filePaths: ['/srv/work/orchard'] };
      },
    });
    expect(await handler(null)).toBe('/srv/work/orchard');
    // A file picker that accepted files would start a session in a directory
    // the operator did not choose -- the parent of whatever they clicked.
    expect(seen).toEqual([{ properties: ['openDirectory'] }]);
  });

  it('answers null when the dialog is cancelled', async () => {
    const handler = harness({
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });
    expect(await handler(null)).toBeNull();
  });

  it('answers null when the dialog reports no path despite not cancelling', async () => {
    const handler = harness({
      showOpenDialog: async () => ({ canceled: false, filePaths: [] }),
    });
    expect(await handler(null)).toBeNull();
  });

  it('answers null rather than letting a thrown dialog escape into main', async () => {
    const handler = harness({
      showOpenDialog: async () => {
        throw new Error('no window to attach to');
      },
    });
    expect(await handler(null)).toBeNull();
  });
});
