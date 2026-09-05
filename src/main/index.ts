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
import { app, BrowserWindow, clipboard, dialog, ipcMain, session } from 'electron';
import { registerClipboardIpc } from './clipboard/ipc.js';
import { contentSecurityPolicy } from './csp.js';
import { registerDialogIpc } from './dialog/ipc.js';
import { registerSourceIpc } from './ipc/handlers.js';
import { releaseCloseAccelerator } from './menu.js';
import { isSameOrigin } from './origin.js';
import { remoteConfigFromEnv } from './remote/launch.js';
import { startRemoteServer } from './remote/server.js';
import { CLAUDE_CODE_SOURCE } from './sources/claude-code/source.js';
import { createTmuxRunner } from './sources/tmux/spawn.js';
import { createNodeEventSource } from './stream/event-source.js';
import { registerStreamIpc } from './stream/register.js';
import { registerTerminalIpc } from './terminal/ipc.js';
import { registerUsageIpc } from './usage/ipc.js';
import { readUsage } from './usage/reader.js';

/**
 * What the desktop shell serves: the operator's own Claude Code sessions,
 * read from `~/.claude/projects`. This replaces the bundled sample, which
 * showed another tool's bookkeeping and none of the operator's real work.
 *
 * Registered UNMODIFIED, unlike the sample it replaces, which had
 * `liveUpdates` flipped on here because main can push a tick over
 * `webContents.send`. That push comes from `VAM_STREAM_URL` -- a backend that
 * knows nothing about transcript files -- so it would never fire for this
 * source, and the badge would be a promise no event keeps. Watching the
 * transcript directory is its own task; until it exists the decline in
 * `claude-code/source.ts` is the true statement.
 *
 * ONLY THE ELECTRON BUILD GETS THIS. The source reads the filesystem, so the
 * browser build cannot use it and does not import it -- `src/renderer` never
 * names this module, and the web target is unaffected.
 */
const DESKTOP_SOURCE = CLAUDE_CODE_SOURCE;

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
 * The response CSP: strict in the built app, and widened by exactly one
 * clause when `electron-vite dev`'s Vite server is the one serving the page.
 * See `./csp.ts` for what each clause is for and why the two policies differ
 * -- No `default-src`/`frame-src` in either: this app never frames anything,
 * and `webSecurity` (already on) is what actually governs cross-origin
 * framing, not this policy -- restricting `frame-src` here as well would only
 * mask that boundary in the launch harness.
 */
function registerContentSecurityPolicy(): void {
  const policy = contentSecurityPolicy(devServerUrl);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
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

/**
 * The browser transport, off unless the environment asks for it.
 *
 * It listens on LOOPBACK ONLY and is meant to be reached through `tailscale
 * serve`, which proxies tailnet requests to `http://127.0.0.1:<port>` on this
 * machine and terminates TLS with a publicly trusted certificate, so the phone
 * gets a secure context and can hold a credential at all
 * (https://tailscale.com/kb/1312/serve). Never `tailscale funnel`: that is the
 * public-internet variant, and this surface drives agents.
 *
 * Being on the tailnet is not authorisation. Every device on it -- and every
 * local process that can reach loopback -- can open a socket here, so each
 * device must be paired from the desktop before any route answers it. A
 * misconfiguration is fatal ON PURPOSE.
 */
function startRemoteTransport(): void {
  let config: ReturnType<typeof remoteConfigFromEnv>;
  try {
    config = remoteConfigFromEnv(process.env);
  } catch (error) {
    console.error(`[vam] remote transport refused to start: ${String(error)}`);
    app.exit(1);
    return;
  }
  if (config === null) {
    return;
  }
  // Payload-free, exactly like the `stream` IPC channel: a tick means "ask
  // again". With no backend configured there is nothing to open, and the SSE
  // route simply never ticks -- it does not pretend to.
  //
  // The fan-out set is not decoration: `MinimalEventSource` has an
  // `addEventListener` and no way to take one off again, so subscribing each
  // browser connection directly would leak a listener per reload.
  const browsers = new Set<() => void>();
  if (streamUrl !== '') {
    createNodeEventSource(streamUrl).addEventListener('change', () => {
      for (const listener of browsers) {
        listener();
      }
    });
  }
  const subscribe = (onChange: () => void): (() => void) => {
    browsers.add(onChange);
    return () => browsers.delete(onChange);
  };
  // The page the browser loads. `VAM_REMOTE_WEB_ROOT` wins; otherwise it is
  // the `dist-web` build beside the app, and a missing one answers 404 rather
  // than half a page -- `serveAsset` opens files, it does not invent them.
  const webRoot = config.webRoot ?? join(app.getAppPath(), 'dist-web');
  // The paired devices. Empty until the pairing screen grants one, and held
  // in memory only for now -- the durable registry is its own module.
  const devices = { find: () => null };
  void startRemoteServer({ ...config, devices, webRoot, source: DESKTOP_SOURCE, subscribe }).catch(
    (error) => {
      console.error(`[vam] remote transport refused to start: ${String(error)}`);
      app.exit(1);
    },
  );
}

void app.whenReady().then(() => {
  registerPermissionPolicy();
  registerContentSecurityPolicy();
  // Cmd+W belongs to the canvas here: it closes the focused SESSION, not the
  // window. Electron's default macOS menu claims that key for `role: 'close'`
  // and a native menu is matched before the page sees the keydown, so the
  // renderer's binding is only real once this runs. See `./menu.js`.
  releaseCloseAccelerator();
  // Registered before the window is created, so the renderer's first call can
  // never race an unregistered channel.
  registerSourceIpc(ipcMain, DESKTOP_SOURCE);
  // Reads the Keychain and calls the real usage endpoint only when the
  // renderer asks; both side effects are `reader.ts`'s own, never this
  // module's -- main-process-only because a Keychain read is not a thing the
  // renderer, the least trusted process here, may ever perform.
  registerUsageIpc(ipcMain, () => readUsage());
  // Electron's clipboard, not the page's: the permission policy above denies
  // `clipboard-sanitized-write`, so a renderer-side write is refused in the
  // packaged app. See `./clipboard/ipc.ts`.
  registerClipboardIpc(ipcMain, clipboard);
  // The Terminal tab's only route to tmux. Registered unconditionally, but it
  // spawns nothing until the renderer asks -- and the renderer asks only while
  // the tab is open, so a closed tab costs a process nothing.
  registerTerminalIpc(ipcMain, createTmuxRunner());
  // The directory picker behind "new project". Only main can open one, and
  // only the operator's click gets a path out of it. See `./dialog/ipc.ts`.
  // Wrapped rather than passed: electron's `showOpenDialog` is an overload
  // set whose first signature takes a parent window, and only the one-argument
  // call is what this channel means -- a modeless picker, not one owned by a
  // window that may already be closing.
  registerDialogIpc(ipcMain, { showOpenDialog: (options) => dialog.showOpenDialog(options) });
  startRemoteTransport();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
