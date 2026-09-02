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
import { app, BrowserWindow, ipcMain, session } from 'electron';
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

/**
 * Applied to every `webContents` this app ever creates, not just the first
 * window's -- registered on `app` rather than on one `window.webContents`, so
 * a second window (or any future contents) inherits the same policy instead
 * of opening with none.
 */
app.on('web-contents-created', (_event, contents) => {
  // Deny by default. A handler returning `{ action: 'allow' }` is the exact bug
  // a static presence scan cannot see, so the harness opens a window instead.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Nothing navigates this window away from its own origin. A renderer that is
  // talked into setting `location.href` must not take the app with it.
  contents.on('will-navigate', (event, url) => {
    if (!isInternal(url)) {
      event.preventDefault();
    }
  });

  // A server-side redirect never fires `will-navigate` -- only the ORIGINAL
  // target does -- so a same-origin URL that then 302s off-origin would
  // otherwise sail through unchecked. Same origin check, same verdict.
  contents.on('will-redirect', (event, url) => {
    if (!isInternal(url)) {
      event.preventDefault();
    }
  });
});

/**
 * Deny by default: with no permission handler registered at all, Electron's
 * own default is to APPROVE every request (microphone, camera,
 * notifications, ...), silently, regardless of `sandbox: true`. Nothing this
 * app renders needs any of these, so nothing is allowlisted back in.
 */
function registerPermissionPolicy(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
}

/**
 * A minimal CSP for the bundled renderer: same-origin scripts and styles
 * only. `'unsafe-inline'` on `style-src` covers Vue's runtime-injected
 * `<style>` tags for scoped component CSS -- without it the renderer mounts
 * unstyled, which the launch harness's title/root assertions would not catch
 * but a human looking at the window would. No `default-src`/`frame-src`: this
 * app never frames anything, and `webSecurity` (already on) is what actually
 * governs cross-origin framing, not this policy -- restricting `frame-src`
 * here as well would only mask that boundary in the launch harness.
 */
const CONTENT_SECURITY_POLICY =
  "script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'";

function registerContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
      },
    });
  });
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

  if (devServerUrl === undefined) {
    void window.loadFile(rendererHtml);
  } else {
    void window.loadURL(devServerUrl);
  }
}

void app.whenReady().then(() => {
  registerPermissionPolicy();
  registerContentSecurityPolicy();
  // Registered before the window is created, so the renderer's first call can
  // never race an unregistered channel.
  registerSourceIpc(ipcMain, PUSHABLE_SOURCE);
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
