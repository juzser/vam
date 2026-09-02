/**
 * The main process: one window, locked down, created once.
 *
 * The renderer is the least trusted process in an Electron app — this one will
 * later render session text a remote agent influenced — so every clause of the
 * posture below is a criterion rather than a preference, and each is asserted
 * separately by `test/electron/launch.test.ts`.
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';
import { registerSourceIpc } from './ipc/handlers.js';
import { isSameOrigin } from './origin.js';
import { FIXTURE_SOURCE } from './sources/fixture-source.js';
import { createNodeEventSource } from './stream/event-source.js';
import { registerStreamIpc } from './stream/register.js';

/**
 * The fixture source, with `liveUpdates` flipped on. Main can push a change
 * tick over `webContents.send` independently of which source answers
 * `load()` (`registerStreamIpc`, below, does not read `MainSource` at all),
 * so the decline that explained why the bundled sample never pushes no
 * longer applies once something does.
 */
const { liveUpdates: _liveUpdatesDecline, ...declinesWithoutLiveUpdates } =
  FIXTURE_SOURCE.descriptor.declines;
const PUSHABLE_SOURCE = {
  ...FIXTURE_SOURCE,
  descriptor: {
    ...FIXTURE_SOURCE.descriptor,
    capabilities: { ...FIXTURE_SOURCE.descriptor.capabilities, liveUpdates: true },
    declines: declinesWithoutLiveUpdates,
  },
};

/**
 * Where main's own change-stream connects, absolute (main is not served from
 * the backend's origin the way the browser build is, so a relative URL
 * cannot resolve). Unset in a build with no backend configured --
 * `registerStreamIpc` is registered regardless, so `subscribe()` never hits
 * a genuinely missing handler; with no URL it simply has nothing to open.
 */
const streamUrl = process.env.VAM_STREAM_URL ?? '';

/** The built renderer, relative to the built main bundle in `out/main`. */
const rendererHtml = join(__dirname, '..', 'renderer', 'index.html');

/**
 * In `electron-vite dev` the renderer is served by Vite and this is its URL;
 * in a build it is undefined and the window loads the file above.
 */
const devServerUrl = process.env.ELECTRON_RENDERER_URL;

/** The one origin this window is allowed to be on. */
const allowedOrigin = devServerUrl === undefined ? pathToFileURL(rendererHtml).href : devServerUrl;

function isInternal(target: string): boolean {
  return isSameOrigin(target, allowedOrigin, devServerUrl !== undefined);
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    // No `backgroundColor` here: main cannot read a CSS custom property, and a
    // hex literal outside styles.css is forbidden. `show: false` until
    // `ready-to-show` removes the white flash the colour would have hidden.
    show: false,
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  // Registered here, not at `app.whenReady`, because it needs THIS window's
  // `webContents` to push to. `subscribe()` never races it: the preload only
  // exists once this window's page has loaded it, which is after this call.
  registerStreamIpc(ipcMain, window.webContents, {
    url: streamUrl,
    createEventSource: (url) => createNodeEventSource(url) as unknown as EventSource,
  });

  // Deny by default. A handler returning `{ action: 'allow' }` is the exact bug
  // a static presence scan cannot see, so the harness opens a window instead.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Nothing navigates this window away from its own origin. A renderer that is
  // talked into setting `location.href` must not take the app with it.
  window.webContents.on('will-navigate', (event, url) => {
    if (!isInternal(url)) {
      event.preventDefault();
    }
  });

  if (devServerUrl === undefined) {
    void window.loadFile(rendererHtml);
  } else {
    void window.loadURL(devServerUrl);
  }
}

void app.whenReady().then(() => {
  // Registered before the window is created, so the renderer's first call can
  // never race an unregistered channel.
  registerSourceIpc(ipcMain, PUSHABLE_SOURCE);
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
