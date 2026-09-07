/**
 * The main process: one window, locked down, created once.
 *
 * The renderer is the least trusted process in an Electron app — this one will
 * later render session text a remote agent influenced — so every clause of the
 * posture below is a criterion rather than a preference, and each is asserted
 * separately by `test/electron/launch.test.ts`.
 */

import { execFile, spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell } from 'electron';
import { registerClipboardIpc } from './clipboard/ipc.js';
import { contentSecurityPolicy } from './csp.js';
import { registerAttachImageIpc } from './dialog/attach-image.js';
import { registerDialogIpc } from './dialog/ipc.js';
import { applyLoginShellPath, probeLoginShellPath } from './env/resolve-path.js';
import { registerMainErrorIpc } from './errors/ipc.js';
import { recordMainFailure } from './errors/log.js';
import { registerSourceIpc } from './ipc/handlers.js';
import { releaseCloseAccelerator } from './menu.js';
import { isSameOrigin } from './origin.js';
import { openDeviceRegistry, registryPath } from './remote/devices.js';
import { bindFailureEvent, setupFailureEvent } from './remote/failure-messages.js';
import { readServeAddress } from './remote/hostname.js';
import { registerRemoteIpc } from './remote/ipc.js';
import { remoteConfigFromEnv } from './remote/launch.js';
import { createPairing } from './remote/pairing.js';
import { disableServe, enableServe } from './remote/serve.js';
import { createStreamRegistry, startRemoteServer } from './remote/server.js';
import { openWritesPreference, writesPreferencePath } from './remote/writes-preference.js';
import { listLiveAgents } from './sources/claude-code/agents.js';
import { CLAUDE_CODE_SOURCE } from './sources/claude-code/source.js';
import type { MainSource } from './sources/source.js';
import { createTmuxRunner } from './sources/tmux/spawn.js';
import { createNodeEventSource } from './stream/event-source.js';
import { registerStreamIpc } from './stream/register.js';
import { registerTerminalIpc } from './terminal/ipc.js';
import { checkForUpdate } from './update/check.js';
import { registerUpdateIpc } from './update/ipc.js';
import { registerUsageIpc } from './usage/ipc.js';
import { readUsage } from './usage/reader.js';

/**
 * Serves `test/electron/launch.test.ts` only, selected by `VAM_FIXTURE_SOURCE`
 * on the spawned process. A clean CI runner has no Claude Code sessions on
 * disk, so `CLAUDE_CODE_SOURCE.load()` there legitimately answers `[]` --
 * and AC-13's proof that the launched shell actually reaches a real model
 * needs at least one project to reach. One project, one session, with every
 * field `test/electron/launch.test.ts`'s shape assertion reads off
 * `DEMO_MODEL`'s first session (`waitingFor`, `vamControlled` included).
 */
const LAUNCH_FIXTURE_SOURCE: MainSource = {
  descriptor: CLAUDE_CODE_SOURCE.descriptor,
  load: () =>
    Promise.resolve([
      {
        id: 'launch-fixture',
        name: 'launch fixture',
        source: 'claude-code',
        sessions: [
          {
            id: 'launch-fixture-1',
            title: 'launch fixture session',
            icon: null,
            epic: null,
            branch: null,
            status: 'waiting',
            runningAgents: 0,
            activity: null,
            age: null,
            decisions: [],
            agents: [],
            waitingFor: null,
            vamControlled: false,
          },
        ],
      },
    ]),
};

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
const DESKTOP_SOURCE =
  process.env.VAM_FIXTURE_SOURCE === '1' ? LAUNCH_FIXTURE_SOURCE : CLAUDE_CODE_SOURCE;

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
  // SAME REASON AS ABOVE -- it needs this window's `webContents` to push to.
  // Nothing recorded before this call is lost: `recordMainFailure`
  // (`./errors/log.js`) buffers unconditionally, and the renderer's own
  // bootstrap (`bridgeMainErrors`, `src/renderer/errors/main-errors-bridge.ts`)
  // pulls the WHOLE backlog on its first ask rather than waiting for a tick.
  // `startRemoteTransport()` below runs BEFORE this window exists at all, so
  // a remote-endpoint failure recorded there is exactly the case this
  // ordering has to survive.
  registerMainErrorIpc(ipcMain, window.webContents);

  if (devServerUrl === undefined) {
    void window.loadFile(rendererHtml);
  } else {
    void window.loadURL(devServerUrl);
  }
}

/**
 * The browser transport, ON BY DEFAULT -- see `remote/launch.ts`'s module
 * comment for why a packaged app cannot rely on `VAM_REMOTE_PORT` at all.
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
 * misconfiguration (`VAM_REMOTE_PORT` set to something that is not a port) is
 * fatal ON PURPOSE; a port simply being taken is not -- see the `catch` below.
 */
function startRemoteTransport(): void {
  // Validated eagerly, before anything async: a `VAM_REMOTE_PORT` that is not
  // a port is a misconfiguration and stays fatal on purpose. The persisted
  // writes preference below cannot change whether THIS call throws --
  // `allowWrites` never affects port parsing -- so `false` here is only a
  // placeholder; the real value is read once `userData` is available.
  try {
    remoteConfigFromEnv(process.env);
  } catch (error) {
    console.error(`[vam] remote transport refused to start: ${String(error)}`);
    app.exit(1);
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
  // The paired devices, their live streams, and the screen that grants a
  // pairing. Revoking a device closes ITS OWN open connections at once: a
  // stream opened while it was paired otherwise outlives the pairing.
  const streams = createStreamRegistry();
  void (async () => {
    const userData = app.getPath('userData');
    const devices = await openDeviceRegistry({
      path: registryPath(userData),
      onRevoked: (deviceId) => streams.closeFor(deviceId),
    });
    const writesPreference = await openWritesPreference(writesPreferencePath(userData));
    // Re-read now that the persisted preference is available. `process.env`
    // has not changed since the eager check above, so this cannot throw here
    // when it did not throw there.
    const config = remoteConfigFromEnv(process.env, writesPreference.get());
    // The page the browser loads. `VAM_REMOTE_WEB_ROOT` wins; otherwise it is
    // the `dist-web` build beside the app, and a missing one answers 404
    // rather than half a page -- `serveAsset` opens files, it does not invent
    // them.
    const webRoot = config.webRoot ?? join(app.getAppPath(), 'dist-web');
    const pairing = createPairing({ grant: (name) => devices.grant(name) });
    // The desktop half: the screen that mints a code, the prompt that allows a
    // device, and the list that revokes one. Registered UNCONDITIONALLY now --
    // the endpoint is on by default, so there is always something to pair
    // with, even before `startRemoteServer` below has settled.
    const remote = registerRemoteIpc(ipcMain, {
      pairing,
      devices,
      allowWrites: config.allowWrites,
      readAddress: () => readServeAddress(runTailscale),
      // Bound to THIS config's port here, so `ipc.ts` never has to know it.
      // `spawnTailscaleServe`, NOT `runTailscale`: `serve --bg` can print the
      // one actionable thing on screen to stdout and then never exit, so this
      // needs a runner that hands stdout back while the process is still
      // running -- see `remote/serve.ts`'s module comment.
      enableServe: () => enableServe(spawnTailscaleServe, config.port),
      disableServe: () => disableServe(spawnTailscaleServe),
      writesPreference,
    });
    try {
      await startRemoteServer({
        ...config,
        devices,
        pairing,
        streams,
        webRoot,
        source: DESKTOP_SOURCE,
        subscribe,
      });
    } catch (error) {
      // THE APP OUTLIVES ITS OPTIONAL SURFACE. A port that is already taken
      // does not mean the operator loses every tmux session vam is driving.
      // Nothing was bound, but the IPC channels above ARE registered, so this
      // is not a dead screen: `reportServerError` puts the refusal on the next
      // `RemoteState` snapshot, and `RemotePanel` renders it in the operator's
      // terms instead of a pairing screen that silently never connects.
      console.error(`[vam] the remote endpoint did not start: ${String(error)}`);
      remote.reportServerError(String(error));
      // AND ON THE ERROR LOG, so the operator does not have to already be on
      // the Remote settings page to learn this -- the status bar's `N
      // failures` cell and the `E` key both reach it from wherever they are.
      // `bindFailureEvent` (`./remote/failure-messages.js`) is what tells "the
      // port is taken, and here is what to try" apart from every other bind
      // refusal, under two different codes.
      const { code, message } = bindFailureEvent(error, config.port);
      recordMainFailure('start the remote endpoint', code, message);
    }
  })().catch((error: unknown) => {
    // Anything before the `try` above -- opening the device registry or the
    // writes preference file, most often -- still cannot take the app down.
    console.error(`[vam] the remote transport did not start: ${String(error)}`);
    // THIS is the case that, today, `RemotePanel` cannot tell apart from a
    // plain "switched off": nothing above ever reached `registerRemoteIpc`,
    // so `vam:remote:state` has no handler and the panel reads that as
    // "not running" -- not "tried and failed". The error log is the one
    // place this failure's true story survives at all.
    const { code, message } = setupFailureEvent(error);
    recordMainFailure('set up remote access', code, message);
  });
}

/**
 * `tailscale status --json`, if there is a `tailscale` to run.
 *
 * BEST-EFFORT AND BOUNDED. A missing CLI is the ordinary case, not an error --
 * it rejects, and `readServeAddress` reports "could not ask" rather than
 * guessing a hostname. `execFile` with an argument array, a short timeout and
 * a small buffer: this runs on main's event loop, and a CLI that hangs must
 * not take the pairing screen with it.
 */
function runTailscale(args: readonly string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const options = { timeout: 3_000, maxBuffer: 1_000_000 };
    execFile('tailscale', [...args], options, (error, stdout) => {
      // A non-zero exit still carries a status body worth reading -- a stopped
      // tailnet answers that way -- so only a failure to RUN the command at
      // all is a rejection.
      if (error !== null && stdout === '') reject(error);
      else resolve({ code: error === null ? 0 : 1, stdout });
    });
  });
}

/**
 * `tailscale serve`/`tailscale serve ... off`, watched live.
 *
 * `execFile` (above) buffers everything and answers once at the end, which is
 * exactly what `remote/serve.ts` measured `tailscale serve --bg` refusing to
 * do: on a tailnet with Serve turned off it prints the one actionable line to
 * stdout and then never exits, so `execFile`'s callback would simply never
 * fire. `spawn` hands back the child directly, so its stdout can be read
 * WHILE the process is still running and it can be killed once `attempt()`
 * has enough to answer with -- see `TailscaleServeRun`.
 */
function spawnTailscaleServe(
  args: readonly string[],
  onStdout: (chunk: string) => void,
): { exit: Promise<{ code: number; stdout: string }>; kill: () => void } {
  const child = spawn('tailscale', [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout?.on('data', (data: Buffer) => {
    const chunk = data.toString('utf8');
    stdout += chunk;
    onStdout(chunk);
  });
  const exit = new Promise<{ code: number; stdout: string }>((resolve, reject) => {
    // `error` (e.g. ENOENT: no `tailscale` on PATH) fires INSTEAD OF `close`,
    // never alongside it -- Node's own contract for a child that never spawned.
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? 1, stdout }));
  });
  return { exit, kill: () => child.kill() };
}

void app.whenReady().then(async () => {
  // FIRST, BEFORE ANYTHING ELSE SPAWNS A CHILD PROCESS. A GUI launch (Finder,
  // Dock, Spotlight) does not inherit the operator's shell PATH -- only
  // `/usr/local/bin:/bin:/usr/bin:/usr/sbin:/sbin` or similar -- so `claude`,
  // `gh` and `tmux` are routinely unreachable even though `pnpm run dev:app`
  // (which inherits the terminal's PATH) never shows it. See
  // `./env/resolve-path.ts` for the probe, its bound and its fallback.
  await applyLoginShellPath(process.env, {
    platform: process.platform,
    home: homedir(),
    probe: probeLoginShellPath,
  });
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
  // Contacts github.com ONCE, here, as vam starts: one unauthenticated GET
  // carrying no token, no query and nothing about this machine's sessions,
  // projects or paths. Nothing is awaited -- the window is created below
  // while the check is still in flight -- and there is no timer, so this is
  // the only request of the session. It downloads and installs nothing; the
  // second channel opens the release page in the operator's own browser.
  // See `./update/check.ts`.
  registerUpdateIpc(
    ipcMain,
    () => checkForUpdate(app.getVersion()),
    async (url) => {
      await shell.openExternal(url);
    },
  );
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
  // The image-attach picker. The cwd it scopes to is asked fresh, same as
  // `recordPrompt` re-asks it: a canvas drawn minutes ago is not evidence
  // about which directory a session is in now, or whether it still exists.
  registerAttachImageIpc(
    ipcMain,
    { showOpenDialog: (options) => dialog.showOpenDialog(options) },
    async (sessionId) => {
      const agentsResult = await listLiveAgents();
      // `unavailable` becomes `null`, same as an unmatched row: vam could not
      // ask, so it has no cwd to attach an image relative to -- not "no
      // sessions are running".
      if (agentsResult.kind === 'unavailable') return null;
      const row =
        agentsResult.agents.find((agent) => agent.key === sessionId) ??
        agentsResult.agents.find((agent) => agent.sessionId === sessionId);
      return row?.cwd ?? null;
    },
    async (path) => {
      const { open } = await import('node:fs/promises');
      const handle = await open(path, 'r');
      try {
        const buffer = new Uint8Array(16);
        await handle.read(buffer, 0, 16, 0);
        return buffer;
      } finally {
        await handle.close();
      }
    },
    // The real `fs.realpath`: resolves symlinks against the actual disk, so
    // a link inside the session's directory that points outside it is caught
    // before its bytes are ever attached. See `attach-image.ts`'s own header
    // for the finding this closes and the TOCTOU window it does not.
    (path) => realpath(path),
  );
  startRemoteTransport();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
