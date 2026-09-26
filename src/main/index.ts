/**
 * The main process: one window, locked down, created once.
 *
 * The renderer is the least trusted process in an Electron app — this one will
 * later render session text a remote agent influenced — so every clause of the
 * posture below is a criterion rather than a preference, and each is asserted
 * separately by `test/electron/launch.test.ts`.
 */

import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Notification,
  session,
  shell,
} from 'electron';
import { registerClipboardIpc } from './clipboard/ipc.js';
import { contentSecurityPolicy } from './csp.js';
import { registerAttachImageIpc } from './dialog/attach-image.js';
import { registerDialogIpc } from './dialog/ipc.js';
import { applyLoginShellPath, probeLoginShellPath } from './env/resolve-path.js';
import { resolveUserDataOverride } from './env/user-data-dir.js';
import { applyUtf8Ctype } from './env/utf8-ctype.js';
import { registerMainErrorIpc } from './errors/ipc.js';
import { recordMainFailure } from './errors/log.js';
import { registerFilesIpc } from './files/ipc.js';
import { registerFilesListIpc } from './files/list-ipc.js';
import { registerFilesResolveIpc } from './files/resolve-ipc.js';
import { readGithubAuthPane, startGithubAuthPane } from './integrations/github-pane.js';
import { readProjectRemotes } from './integrations/github-remotes.js';
import {
  createGithubReposRun,
  readGithubOrgs,
  readGithubRepos,
} from './integrations/github-repos.js';
import { createGhAuthRun, readGithubAuthStatus } from './integrations/github-status.js';
import { registerGithubIntegrationIpc } from './integrations/ipc.js';
import { registerSourceIpc } from './ipc/handlers.js';
import { registerIssueIpc } from './issue/ipc.js';
import { LAUNCH_FIXTURE_PROJECTS } from './launch-fixture.js';
import { registerLinkIpc } from './link/ipc.js';
import { applyApplicationMenu } from './menu.js';
import { notifyActivationRoute, registerNotifyIpc } from './notify/ipc.js';
import { createNotifier } from './notify/notify.js';
import { isSameOrigin } from './origin.js';
import { registerPrIpc } from './pr/ipc.js';
import { createQuitGuard, registerUnsavedIpc } from './quit/guard.js';
import { unsavedQuitPrompt } from './quit/unsaved.js';
import { openDeviceRegistry, registryPath } from './remote/devices.js';
import { bindFailureEvent, setupFailureEvent } from './remote/failure-messages.js';
import { readServeAddress } from './remote/hostname.js';
import { registerRemoteIpc } from './remote/ipc.js';
import { remoteConfigFromEnv } from './remote/launch.js';
import { createPairing } from './remote/pairing.js';
import { disableServe, enableServe } from './remote/serve.js';
import { createStreamRegistry, startRemoteServer } from './remote/server.js';
import { openWritesPreference, writesPreferencePath } from './remote/writes-preference.js';
import { defaultAdhdSkillDeps } from './skills/adhd-skill.js';
import { registerAdhdSkillIpc } from './skills/ipc.js';
import { listLiveAgents } from './sources/claude-code/agents.js';
import { paneCwdOf, paneNameOf } from './sources/claude-code/pane-row.js';
import { createPrActionRunner, runPrActionViaCli } from './sources/claude-code/pr-actions.js';
import { prRepoOverride } from './sources/claude-code/pr-repos.js';
import { projectIdOf } from './sources/claude-code/project-id.js';
import { CLAUDE_CODE_SOURCE } from './sources/claude-code/source.js';
import { defaultCodexSource } from './sources/codex/source.js';
import { combineSources } from './sources/combine.js';
import type { MainSource } from './sources/source.js';
import { createControlTmuxRunner } from './sources/tmux/control.js';
import { createTmuxRunner, listVamSessions } from './sources/tmux/spawn.js';
import { createNodeEventSource } from './stream/event-source.js';
import { registerStreamIpc } from './stream/register.js';
import { registerTerminalIpc } from './terminal/ipc.js';
import { registerTerminalStreamIpc } from './terminal/stream-ipc.js';
import { checkForUpdate } from './update/check.js';
import { registerUpdateIpc } from './update/ipc.js';
import { readCodexUsage } from './usage/codex-reader.js';
import { registerCodexUsageIpc, registerUsageIpc } from './usage/ipc.js';
import { readUsage } from './usage/reader.js';
import { runGitViaCli } from './worktrees/git-run.js';
import { registerWorktreesIpc } from './worktrees/ipc.js';
import { resolveProjectDirectoryFrom } from './worktrees/resolve-directory.js';
import { lockZoom } from './zoom.js';

/**
 * FIRST, BEFORE ANYTHING ELSE TOUCHES `app`: a test/fixture launch gets its
 * own throwaway `userData`, never the operator's real profile.
 *
 * `app.setPath('userData', ...)` has to run before `app.whenReady()` and
 * before any subsystem opens a file under the default location -- Chromium's
 * disk caches, `Local Storage`, `Preferences` and the per-origin zoom level
 * all resolve against whatever `userData` was when they first initialise,
 * and nothing below this line is early enough to still redirect them. It is
 * placed ahead of `app.on('web-contents-created', ...)` for the same reason,
 * even though that handler does not itself touch `userData`: nothing in this
 * module may run first.
 *
 * Read once, from `VAM_USER_DATA_DIR`: unset in every production launch
 * (Finder, Dock, Spotlight, `pnpm run dev:app`), so this is a no-op there and
 * the platform default is untouched. Only `test/electron/launch.test.ts` and
 * `e2e/electron-launch.et.ts` ever set it, each to a fresh directory made
 * with `fs.mkdtempSync` and torn down after the run.
 */
const userDataOverride = resolveUserDataOverride(process.env);
if (userDataOverride !== undefined) {
  app.setPath('userData', userDataOverride);
}

/**
 * Serves `test/electron/launch.test.ts` only, selected by `VAM_FIXTURE_SOURCE`
 * on the spawned process. The data lives in `launch-fixture.ts`, not here --
 * that file's own header says why (this one cannot be unit-imported at all).
 */
const LAUNCH_FIXTURE_SOURCE: MainSource = {
  descriptor: CLAUDE_CODE_SOURCE.descriptor,
  load: () => Promise.resolve(LAUNCH_FIXTURE_PROJECTS),
};

/**
 * A SECOND FIXTURE VALUE, `VAM_FIXTURE_SOURCE=2`: genuinely nothing, for
 * `test/electron/getting-started-image.test.ts` alone. `LAUNCH_FIXTURE_
 * SOURCE` above always owns a session (AC-13's composer needs one on
 * screen), which is exactly the state `GettingStarted.tsx`'s own `<img>`
 * (vam's mark, wrapped in `IconFrame`) can never be reached in -- it draws
 * only when vam owns no session ANYWHERE. That screen is, since
 * "start-polish" (2026-09-23) moved `TerminalOnlyStart`'s mark to the
 * session's own agent, the ONE place left in this app that draws an `<img>`
 * at all, so it needs its own launch to prove the same `file://`-relative-
 * path regression `LAUNCH_FIXTURE_SOURCE` used to cover through it.
 */
const EMPTY_FIXTURE_SOURCE: MainSource = {
  descriptor: CLAUDE_CODE_SOURCE.descriptor,
  load: () => Promise.resolve([]),
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
/**
 * A LIST, IN THE ORDER VAM ASKS THEM, and the list is where a second source
 * arrives -- `docs/design/a-second-source.md` Stage 0. One member today, and
 * `combineSources` folds a list of one to that member by reference, so this
 * is the same object every consumer below held before it became a list.
 *
 * THE ORDER IS PART OF THE CONTRACT, not incidental: it is the order projects
 * are concatenated in, and the order `createSessionInDirectory` picks its
 * first willing source from -- a route with no session and no project to key
 * on. Written here, where it can be read, rather than derived somewhere a
 * reader would have to reconstruct it.
 */
const DESKTOP_SOURCES: readonly MainSource[] =
  process.env.VAM_FIXTURE_SOURCE === '1'
    ? [LAUNCH_FIXTURE_SOURCE]
    : process.env.VAM_FIXTURE_SOURCE === '2'
      ? [EMPTY_FIXTURE_SOURCE]
      : [
          CLAUDE_CODE_SOURCE,
          /**
           * THE OPERATOR'S OWN CODEX THREADS, read from `~/.codex/state_5.sqlite`
           * and their rollout files, with `codex queue` as the one write.
           *
           * SECOND, AND THE ORDER IS THE CONTRACT ABOVE: Claude Code's rows come
           * first in the canvas, and `createSessionInDirectory` -- the "new
           * project" route, which has no session and no project to key on --
           * goes to the first source that advertises `createSession`, which is
           * Claude Code. The Codex source withdraws `createSession` for exactly
           * that reason: starting a Codex session is Stage 2.
           *
           * Registered whether or not Codex is installed. A machine with no
           * `~/.codex` gets a source that withdraws everything and SAYS WHY in
           * its label and in every decline, which is the version answer this
           * source owes; an empty list of threads would read as "you have no
           * Codex sessions", which is the one lie it must not tell.
           */
          defaultCodexSource(existsSync),
        ];

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

  // No page zoom, on this contents and on every later one. Bound here rather
  // than in `createWindow` for the same reason the navigation policy is: a
  // second `webContents` created after startup must obey the same rule.
  lockZoom(contents);

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
 * notifications, ...), silently, regardless of `sandbox: true`. Nothing is
 * allowlisted back in, and nothing ever has been.
 *
 * ── WHAT THAT COSTS, NAMED, BECAUSE IT IS NO LONGER NOTHING ───────────────
 * This comment used to say "nothing this app renders needs any of these". It
 * was true when it was written and it stopped being true twice, while staying
 * on screen directly above the policy a later reader would consult before
 * widening it. Both capabilities are listed here now, and
 * `test/main/permission-census.test.ts` scans the renderer so a third cannot
 * arrive in silence.
 *
 *  1. THE CLIPBOARD. `navigator.clipboard.writeText` rejects with
 *     `NotAllowedError` under this policy -- measured, not assumed -- so the
 *     write goes over the bridge to main's own `clipboard` module instead
 *     (`src/renderer/panels/clipboard.ts`). Allowlisting
 *     `clipboard-sanitized-write` was tried and does NOT fix it. A PASTE is a
 *     different thing and needs no permission: the event carries its own
 *     `DataTransfer` because the operator pressed the keys.
 *
 *  2. DICTATION. Speaking a prompt needs the microphone, and this policy
 *     refuses it -- before Chromium's own missing speech-service key is ever
 *     reached, so the refusal is vam's and not the platform's. The answer is
 *     NOT to widen the policy for it: the control is withheld in this build
 *     instead, on the rule that a control which cannot act is not drawn
 *     (`dictationAvailable` in `src/renderer/panels/dictation.ts` answers
 *     false wherever the preload bridge exists). Dictation stays on the paired
 *     phone and in a browser tab, which is where it works.
 *
 * The rule for the next one is in that census file: route it through main,
 * withhold the control, or argue the policy -- in that order.
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

/**
 * The Terminal tab's persistent tmux connection, so `before-quit` below can
 * close it. `null` until `app.whenReady()` creates it (`registerTerminalIpc`'s
 * own call site) -- a quit before then has nothing to dispose of, which
 * `?.dispose()` already says without a second check.
 */
let terminalTmuxRunner: ReturnType<typeof createControlTmuxRunner> | null = null;

/**
 * Every open Terminal-tab STREAMING connection, so `before-quit` below can
 * dispose them alongside `terminalTmuxRunner`'s own connection -- the same
 * "no orphan `tmux -C` process may survive app quit" requirement, for the
 * SECOND persistent client this app now keeps. `null` until `createWindow()`
 * registers it (it needs a window's own `webContents` to push to, the same
 * reason `registerStreamIpc` below is registered there and not here).
 */
let terminalStreamRegistration: ReturnType<typeof registerTerminalStreamIpc> | null = null;

/**
 * THE GUARD ON CMD-Q, and the one piece of renderer state main keeps a copy of.
 *
 * The Files tab holds unsaved edits in renderer memory and nowhere else, and
 * guards them with `beforeunload` -- a PAGE hook, which covers the window
 * closing and does not cover quitting: Cmd-Q reaches `app.on('before-quit')`
 * here, where a page hook has no standing, and the window is torn down after.
 * So the renderer pushes what it is holding (`CHANNELS.filesUnsaved`), main
 * keeps the last report, and the handler below reads a local variable.
 *
 * IT NEVER WAITS ON THE RENDERER. That is the whole reason the fact is pushed
 * rather than asked for: a quit handler that waits is a quit handler a wedged
 * renderer can hang, and an app that cannot be quit is worse than the bug this
 * closes -- it has to be force-killed, which loses the same text and every
 * other session's state with it. `src/main/quit/guard.ts` holds the four ways
 * that could still have happened and the guard on each.
 *
 * `showMessageBoxSync`, NOT the async form: `before-quit` is a veto and the
 * veto has to be decided before the handler returns. See that same header.
 */
const quitGuard = createQuitGuard({
  ask: (report) => {
    const prompt = unsavedQuitPrompt(report);
    // Attached to the window where there is one, so it is a sheet on vam
    // rather than a free-floating alert; modeless when the window has already
    // gone, which `dialog` accepts and which must not throw here (a prompt
    // that cannot be drawn is not a veto -- the guard would let the quit
    // through anyway, but there is no reason to take that path when electron
    // offers this overload).
    const [window] = BrowserWindow.getAllWindows();
    const chosen =
      window === undefined
        ? dialog.showMessageBoxSync(prompt)
        : dialog.showMessageBoxSync(window, prompt);
    return chosen === prompt.cancelId ? 'cancel' : 'quit';
  },
  // `destroy()`, NOT `close()`. The operator has just been told this text will
  // be discarded and pressed the button that discards it -- and `close()`
  // would run the renderer's `beforeunload`, which the Files tab arms whenever
  // anything is dirty, i.e. exactly now. Electron documents that handler as
  // able to cancel a quit, and to do so WITHOUT a prompt of its own, so
  // `close()` here risks an application that silently declines to quit right
  // after saying it would. `destroy()` skips `beforeunload` and `unload`
  // entirely, and nothing in this renderer persists anything at unload time
  // (prefs are written to `localStorage` as they change), so nothing else is
  // lost by taking that route. See `QuitGuardDeps.release`.
  release: () => {
    for (const open of BrowserWindow.getAllWindows()) {
      open.destroy();
    }
  },
});

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

  // The window is gone, so the unsaved text it was holding is gone with it --
  // `beforeunload` owns that exit, and by the time this fires it has either
  // had its say or been bypassed. What must not happen next is main asking
  // about buffers that no longer exist: `window-all-closed` calls `app.quit()`
  // below, and a stale report would put a dialog in front of a quit nobody can
  // answer usefully. A reload needs no equivalent hook -- the fresh renderer
  // reports on mount, including zero.
  window.on('closed', () => {
    quitGuard.clear();
  });

  // Registered here, not at `app.whenReady`, because it needs THIS window's
  // `webContents` to push to. `subscribe()` never races it: the preload only
  // exists once this window's page has loaded it, which is after this call.
  registerStreamIpc(ipcMain, window.webContents, {
    url: streamUrl,
    createEventSource: (url) => createNodeEventSource(url) as unknown as EventSource,
  });
  // SAME REASON AS ABOVE -- it needs THIS window's `webContents` to push
  // `%output`/reseed/down events to. Guarded on `terminalTmuxRunner` rather
  // than asserted: `app.whenReady()` always sets it before calling
  // `createWindow()` (below), but nothing here forces that ordering to stay
  // true, and skipping registration is a strictly safer failure than a
  // non-null assertion that turns out wrong.
  if (terminalTmuxRunner !== null) {
    terminalStreamRegistration = registerTerminalStreamIpc(
      ipcMain,
      window.webContents,
      terminalTmuxRunner,
    );
  }
  // SAME REASON AS ABOVE -- it needs this window's `webContents` to push to.
  // Nothing recorded before this call is lost: `recordMainFailure`
  // (`./errors/log.js`) buffers unconditionally, and the renderer's own
  // bootstrap (`bridgeMainErrors`, `src/renderer/errors/main-errors-bridge.ts`)
  // pulls the WHOLE backlog on its first ask rather than waiting for a tick.
  // `startRemoteTransport()` below runs BEFORE this window exists at all, so
  // a remote-endpoint failure recorded there is exactly the case this
  // ordering has to survive.
  registerMainErrorIpc(ipcMain, window.webContents);
  // DESKTOP NOTIFICATIONS -- same reason again: a click on a banner has to
  // reach THIS window. `Notification.isSupported()` is deliberately not
  // consulted: it answers `true` on a machine where delivery is impossible,
  // and the only honest signal is the `failed` event, which the notifier
  // writes into the failure buffer above (`./notify/notify.js`).
  registerNotifyIpc(
    ipcMain,
    createNotifier({
      create: (options) => new Notification(options),
      onActivate: notifyActivationRoute(window.webContents, () => {
        // `steal: true` because the operator just clicked a banner ABOUT vam:
        // that is the one gesture macOS treats as consent to bring an app
        // forward over whatever they were in.
        if (window.isMinimized()) window.restore();
        window.show();
        app.focus({ steal: true });
      }),
    }),
  );

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
      // The panel's two links. `shell.openExternal` is the operating system's
      // browser, not this window -- which would refuse the navigation anyway.
      // The renderer hands over a KEY; `remote/ipc.ts` owns both destinations.
      openExternal: async (url) => {
        await shell.openExternal(url);
      },
    });
    try {
      await startRemoteServer({
        ...config,
        devices,
        // READ-ONLY, ON PURPOSE. The phone has no `window.api` at all, so
        // `/api/devices` is its only way to see what is paired -- and it is a
        // LIST function rather than the registry itself, so nothing on the
        // other end of that route can grant or revoke anything. See
        // `RemoteServerOptions.pairedDevices`.
        pairedDevices: () => devices.list(),
        pairing,
        streams,
        webRoot,
        sources: DESKTOP_SOURCES,
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

/**
 * A live session's own working directory, off the SAME live agent roster
 * `registerFilesIpc`'s own root list is built from -- asked fresh per call,
 * never cached, so a session that closed between two requests stops
 * authorising anything the moment it drops off the roster. Shared between
 * `registerAttachImageIpc` and `registerFilesListIpc` so the image picker and
 * the file-editor tab's listing cannot drift on how a session id becomes a
 * directory -- they used to be two copies of the same four lines.
 *
 * A `pane:` ROW ID IS CHECKED FIRST, and answered from vam's own tmux
 * listing rather than `claude agents --json` -- issues 502/507's "other entry
 * points": a pane row has no live agent to look up (there never is one, the
 * same fact `recordPrompt`/`closeSession` dispatch on in `source.ts`), so
 * this used to answer `unknown-session` for exactly the pane the Response
 * view's `PaneReady` state had already confirmed running a provider and
 * enabled the composer for -- the image-attach button and the file-editor
 * tab's own listing refusing a row the prompt box beside them could already
 * send into. `paneCwdOf` (`pane-row.ts`) is the pure lookup; this is only the
 * tmux call it needs.
 */
async function resolveSessionCwd(sessionId: string): Promise<string | null> {
  if (paneNameOf(sessionId) !== null) {
    const listed = await listVamSessions(createTmuxRunner());
    // `unavailable` becomes `null` for the identical reason the agent-list
    // branch below does: vam could not ask, so it has no cwd to answer with.
    return listed.kind === 'ok' ? paneCwdOf(listed.sessions, sessionId) : null;
  }
  const agentsResult = await listLiveAgents();
  // `unavailable` becomes `null`, same as an unmatched row: vam could not
  // ask, so it has no cwd to answer with -- never "no sessions are running".
  if (agentsResult.kind === 'unavailable') return null;
  const row =
    agentsResult.agents.find((agent) => agent.key === sessionId) ??
    agentsResult.agents.find((agent) => agent.sessionId === sessionId);
  return row?.cwd ?? null;
}

/**
 * `projectId -> directory`, for the worktrees feature ALONE -- distinct from
 * `resolveSessionCwd` above, which resolves a SESSION id, because a project
 * with live sessions but no chosen one yet (the state right after "Start",
 * `pane-row.ts`) still needs an answer here. The resolution itself is the
 * SAME two-tier rule `create-session.ts`'s own `createSessionInProject`
 * applies -- a live agent first, a live pane only when no agent answers --
 * reimplemented as `resolve-directory.ts`'s pure `resolveProjectDirectoryFrom`
 * so that module carries no dependency on this file's tmux wiring. Asked
 * fresh per call, never cached, for `resolveSessionCwd`'s own reason.
 */
async function resolveWorktreeProjectDirectory(projectId: string): Promise<string | null> {
  const agentsResult = await listLiveAgents();
  const agents = agentsResult.kind === 'ok' ? agentsResult.agents : [];
  const listed = await listVamSessions(createTmuxRunner());
  const panes = listed.kind === 'ok' ? listed.sessions : [];
  return resolveProjectDirectoryFrom(agents, panes, projectId);
}

/**
 * THE ONE RUNNER FOR THE WHOLE APPLICATION, and that singleness is the
 * guarantee rather than a tidiness.
 *
 * `createPrActionRunner` refuses a second write while one is in flight
 * (`pr-actions.ts`), and a guard held per call would refuse nothing at all: a
 * fresh one per invoke has never seen the merge that is already running. Built
 * once, at module scope, exactly as `PR_READER` is in `source.ts` for the same
 * kind of reason.
 */
const PR_ACTIONS = createPrActionRunner(runPrActionViaCli());

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
  // AND THE LOCALE, FOR THE SAME REASON AND AT THE SAME MOMENT: a GUI launch
  // has no LANG or LC_* either, and a tmux client without a UTF-8 LC_CTYPE
  // rewrites the separators in every listing vam reads -- which made every
  // session vam started invisible to it. See `./env/utf8-ctype.ts`.
  applyUtf8Ctype(process.env, process.platform);
  registerPermissionPolicy();
  registerContentSecurityPolicy();
  // vam's own menu, replacing Electron's default one. The default claims
  // Cmd+0/Cmd+Plus/Cmd+- for page zoom and Cmd+W for Close Window, and a
  // native menu is matched before the page sees the keydown -- so those keys
  // are the renderer's only once this runs. See `./menu.js`.
  applyApplicationMenu();
  // Registered before the window is created, so the renderer's first call can
  // never race an unregistered channel.
  registerSourceIpc(ipcMain, DESKTOP_SOURCES);
  // Reads the Keychain and calls the real usage endpoint only when the
  // renderer asks; both side effects are `reader.ts`'s own, never this
  // module's -- main-process-only because a Keychain read is not a thing the
  // renderer, the least trusted process here, may ever perform.
  registerUsageIpc(ipcMain, () => readUsage());
  // A filesystem scan of ~/.codex/sessions rather than a network call, but
  // the same rule: main-process-only, read only when the renderer asks, and
  // never on a floor the renderer itself controls (`codex-reader.ts`,
  // `usage/ipc.ts`).
  registerCodexUsageIpc(ipcMain, () => readCodexUsage());
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
  // The route to github.com the error log never had. It takes a TITLE and a
  // BODY and builds the address itself (`src/shared/issue.ts`), so the
  // renderer names no destination -- the same bargain `remoteOpenLink` makes.
  // It opens the prefilled form and posts nothing; submitting stays the
  // operator's own act. See `./issue/ipc.ts`.
  registerIssueIpc(ipcMain, async (url) => {
    await shell.openExternal(url);
  });
  // THE ONE CHANNEL THAT TAKES A DESTINATION FROM THE RENDERER, and the
  // allowlist in `./link/ipc.ts` is what pays for it: `http:`/`https:` only,
  // parsed by `new URL` on THIS side of the boundary, whatever the page
  // believed. The addresses are an agent's own, written into its answer --
  // there is no key for main to map onto a constant the way `remoteOpenLink`
  // and `issueOpen` above both can. The window's deny-by-default navigation
  // policy (`registerNavigationPolicy`) is untouched: nothing here navigates
  // this window anywhere, it hands a URL to the operating system's browser.
  registerLinkIpc(ipcMain, async (url) => {
    await shell.openExternal(url);
  });
  /**
   * The PRs tab's own two channels -- and the ONE place in this file that
   * registers something which changes state on GitHub.
   *
   * THE OPERATOR AUTHORISED BOTH ON 2026-09-18. `pull-requests.ts` had
   * recorded, from the day it was written, that opening a pull request in a
   * browser was a second outbound capability and deliberately absent; that
   * sentence is now a dated record of a decision that changed, rather than a
   * rule quietly deleted.
   *
   * THE DIRECTORY IS RESOLVED HERE, from the session id, and it is resolved
   * the SAME WAY THE READER RESOLVES IT: the operator's per-project override
   * first, the session's own cwd otherwise. A merge that ran somewhere other
   * than where the list was read from would act on a repository the operator
   * was not looking at -- which is the whole failure `prRepoOverride` exists
   * to prevent on the read side.
   *
   * `resolveSessionCwd` is shared with the image picker and the file listing
   * above, so a session that has closed stops authorising anything the moment
   * it drops off the live roster.
   */
  registerPrIpc(ipcMain, {
    openExternal: async (url) => {
      await shell.openExternal(url);
    },
    resolveCwd: async (sessionId) => {
      const cwd = await resolveSessionCwd(sessionId);
      if (cwd === null) return null;
      return prRepoOverride('claude-code', projectIdOf(cwd)) ?? cwd;
    },
    run: PR_ACTIONS,
  });
  /**
   * Settings -> Integrations -> GitHub. `channels.ts`'s own note carries the
   * whole argument for why every one of these six is desktop-only; this is
   * only the wiring.
   *
   * `createTmuxRunner()`, not the control-mode runner the Terminal tab uses:
   * Connect/Disconnect is one spawn per press, not a per-keystroke hot path,
   * so the plain runner already every OTHER occasional tmux write in this
   * file uses (`resolveWorktreeProjectDirectory`, above) is the right one.
   */
  const githubTmuxRunner = createTmuxRunner();
  const readGithubReposOf = readGithubRepos(createGithubReposRun());
  const readGithubViewerOrgs = readGithubOrgs(createGithubReposRun());
  const readOneProjectsRemotes = readProjectRemotes();
  registerGithubIntegrationIpc(ipcMain, {
    authStatus: readGithubAuthStatus(createGhAuthRun()),
    connectStart: (kind) => startGithubAuthPane(githubTmuxRunner, kind),
    connectRead: () => readGithubAuthPane(githubTmuxRunner),
    reposList: async (owner) => {
      const result = await readGithubReposOf(owner);
      if (result.kind === 'ok') return result;
      return result.kind === 'bad-response'
        ? { kind: 'error', code: 'bad-response', message: result.message }
        : { kind: 'error', code: result.error.code, message: result.error.message };
    },
    orgsList: async () => {
      const result = await readGithubViewerOrgs();
      return result.kind === 'ok'
        ? result
        : { kind: 'error', code: result.error.code, message: result.error.message };
    },
    projectRemotes: async (projectId) => {
      const cwd = await resolveWorktreeProjectDirectory(projectId);
      return cwd === null ? [] : readOneProjectsRemotes(cwd);
    },
  });
  // The Terminal tab's only route to tmux. Registered unconditionally, but it
  // spawns nothing until the renderer asks -- and the renderer asks only while
  // the tab is open, so a closed tab costs a process nothing.
  //
  // A CONTROL-MODE RUNNER, NOT A PLAIN `createTmuxRunner()`, since the
  // typing-latency measurement this file's own history records: two
  // `execFile` spawns per keystroke (`sendToPane`, `readAimedPane`) were over
  // 90% of a steady keystroke's own keydown-to-painted cost. `control.ts`'s
  // runner is a drop-in `TmuxRun` -- everything downstream is unchanged -- and
  // degrades to exactly the spawn this replaced whenever its persistent
  // connection is not available, so this line can never make the Terminal tab
  // WORSE than it was, only faster when tmux is reachable. Assigned to the
  // module-level `terminalTmuxRunner` so `before-quit` below can close its
  // connection cleanly; nothing else in the app depends on that happening.
  terminalTmuxRunner = createControlTmuxRunner();
  registerTerminalIpc(ipcMain, terminalTmuxRunner);
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
    resolveSessionCwd,
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
  // The file-editor tab's read and write. The root set is every LIVE
  // session's own cwd, asked fresh per request -- the same reasoning as
  // `registerAttachImageIpc`'s own cwd lookup just above, generalised from
  // one session to all of them because this channel is not asked with a
  // session id at all: a path is authorised by being inside SOME session's
  // directory, not one particular caller's. See `./files/authorize.ts`.
  registerFilesIpc(
    ipcMain,
    async () => {
      const agentsResult = await listLiveAgents();
      // `unavailable` becomes no roots at all, same reading as the image
      // picker's own `null`: vam could not ask, so nothing is authorised --
      // never "every path is", which is the direction a bug here must fail.
      if (agentsResult.kind === 'unavailable') return [];
      return [...new Set(agentsResult.agents.map((agent) => agent.cwd))];
    },
    // The real `fs.realpath`, the same seam `registerAttachImageIpc` wires
    // just above and for the same reason: a symlink inside a session's
    // directory that points outside it must be caught before its content is
    // ever read or its target ever written to.
    (path) => realpath(path),
    { stat, readFile, writeFile, rename },
  );
  // The file-editor tab's directory listing -- the piece `filesRead`/
  // `filesWrite` never carried: a way for the renderer to DISCOVER a path
  // before it has one to hand either of them. Keyed by session id and
  // resolved through `resolveSessionCwd` exactly as the image picker is
  // above; see `./files/list-ipc.ts` and `CHANNELS.filesList`'s own header.
  registerFilesListIpc(
    ipcMain,
    resolveSessionCwd,
    (path) => realpath(path),
    (dir) => readdir(dir, { withFileTypes: true }),
  );
  // `src/foo/bar.ts:42`, as an AGENT wrote it, turned into an absolute path --
  // authorised against THAT session's own directory alone rather than against
  // every live root the way `registerFilesIpc` is, because nobody typed this
  // path. Same `resolveSessionCwd` and the same real `realpath` as the listing
  // above, so a `..`, a look-alike sibling directory and a symlink out of the
  // project are all caught against the real disk. See `./files/resolve-ipc.ts`.
  registerFilesResolveIpc(ipcMain, resolveSessionCwd, (path) => realpath(path));
  // list/create/remove a linked git worktree of a project vam already
  // knows. `knownProjectIds` re-reads the SAME `source.load()` project set
  // `remote/server.ts`'s own `confineToProjectSet` confines the
  // create-session-in ROUTE to -- applied here to the LOCAL bridge instead,
  // where the caller never hands over a raw path to canonicalise in the
  // first place, only a project id. `resolveWorktreeProjectDirectory` above
  // is the only way that id becomes a directory at all: `Project` carries no
  // `cwd` (`renderer/domain/model.ts`'s own rule). DESKTOP-ONLY, like
  // `registerFilesIpc` above -- see `CHANNELS.worktreeList`'s own comment
  // for why a paired phone has no route to any of the three.
  registerWorktreesIpc(ipcMain, {
    run: runGitViaCli(),
    realpathFn: (path) => realpath(path),
    resolveProjectDirectory: resolveWorktreeProjectDirectory,
    knownProjectIds: async () => (await combineSources(DESKTOP_SOURCES).load()).map((p) => p.id),
  });
  // Install the real `ayghri/i-have-adhd` skill into `~/.claude/skills` and
  // `~/.agents/skills`, read its status back, or remove what vam wrote.
  // `defaultAdhdSkillDeps` resolves BOTH of its inputs here, once: the real
  // `os.homedir()` and the bundled pinned copy this build ships at
  // `resources/skills/i-have-adhd` (`app.getAppPath()`, the same call
  // `webRoot` above makes for `dist-web` -- repo root in dev, the asar root
  // once packaged). DESKTOP-ONLY, like `registerWorktreesIpc` above -- see
  // `CHANNELS.adhdSkillInstall`'s own comment.
  registerAdhdSkillIpc(ipcMain, defaultAdhdSkillDeps(app.getAppPath()));
  // The file-editor tab's LAST channel, and the only one that carries no path
  // at all: how many of its buffers are unsaved, and what they are called.
  // Registered here rather than in `createWindow` because the guard it feeds
  // is bound to `app`, not to a window -- and registered BEFORE the window
  // exists, like every channel above, so the renderer's first report cannot
  // race an unregistered channel. See `quitGuard` above.
  registerUnsavedIpc(ipcMain, quitGuard);
  startRemoteTransport();
  createWindow();
});

/**
 * THE VETO. Emitted before the application starts closing its windows, which
 * is the one moment a renderer's `beforeunload` cannot speak for itself --
 * see `quitGuard` above for the whole argument and `src/main/quit/guard.ts`
 * for why this can never leave the app unquittable.
 *
 * Registered beside `window-all-closed` below because they are the two halves
 * of one lifecycle: that one turns the last window closing into a quit, and
 * this one is what that quit then has to get past.
 */
app.on('before-quit', (event) => {
  quitGuard.beforeQuit(event);
  // Best-effort only, and never awaited: the veto above is what may still
  // stop the quit, and a persistent tmux client left running one more
  // instant is an idle process, not a correctness problem. A tab reopened
  // before the app actually exits just reconnects (`control.ts`'s own
  // degrade-and-retry). `dispose()` now ALSO asks tmux to kill the `vamctl`
  // housekeeping session itself (A9), not only this client's connection to
  // it -- left alive, that session (and the whole tmux server, if it held
  // nothing else) would otherwise outlive the app indefinitely.
  terminalTmuxRunner?.dispose();
  // Every open streaming connection, closed the same best-effort way --
  // see `terminalStreamRegistration`'s own note.
  terminalStreamRegistration?.dispose();
});

app.on('window-all-closed', () => {
  app.quit();
});
