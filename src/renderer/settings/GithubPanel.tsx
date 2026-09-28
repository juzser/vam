/**
 * Settings -> Integrations -> GitHub.
 *
 * Operator: "add an Integrations section in Settings, to connect a GitHub
 * account and select a repo." vam stores no token of its own -- `gh` keeps it
 * in the Keychain, exactly as `pull-requests.ts` already relies on -- so this
 * panel is three reads and two writes, all through `gh`:
 *
 *  1. STATUS. `gh auth status`, asked once on mount and again on "re-check".
 *  2. CONNECT/DISCONNECT. `gh auth login --web`/`gh auth logout` run in a NEW
 *     vam pane -- the SAME mechanism vam uses to start a session in one
 *     (`main/integrations/github-pane.ts`) -- so the operator watches the
 *     device code and the browser prompt exactly as they would any other
 *     pane. Never read back here for vam's own use, only rendered.
 *  3. THE REPO PICKER, per project. `gh repo list <owner>`, the viewer's own
 *     orgs, and the project's own git remotes as first suggestions -- a
 *     search box over all three. THE OVERRIDE STAYS A DIRECTORY: picking the
 *     project's own remote clears it, and picking anything else opens vam's
 *     existing native directory chooser so the operator confirms WHERE that
 *     repository is checked out, then `setProjectPrRepo` writes exactly what
 *     it always has (`Canvas.tsx`'s prior wiring, retired in favour of this
 *     panel). This keeps `pull-requests.ts`'s own invariant intact: `gh`
 *     still resolves the remote from where vam stands, and no `--repo`
 *     reaches its argv from a value this panel produced.
 *
 * A CONTROL THAT CANNOT ACT IS NOT DRAWN AS ONE -- `RemotePanel.tsx`'s rule,
 * kept here: no bridge means no section content at all (this panel is
 * desktop-only end to end, so `SettingsOverlay` never mounts it for a phone);
 * no project means no repo picker, because there is nothing to point it at.
 *
 * THE SKILLS-CARD SHAPE (settings-views restructure, item F). Operator:
 * "restyle GitHub connect UI to match the Skills card shape (icon, title,
 * description, status pill: Connected/Not connected/gh not installed;
 * 'Logged in as: **account**' when connected); keep Connect/repo-picker/
 * reconnect." `AdhdSkillCard.tsx`'s own top row (icon tile, `h4` title, a
 * one-line hint, a pill in the corner) is the precedent this reuses rather
 * than invents -- down to the outer `rounded border bg-card p-4` box that
 * component's own comment calls "the one exception" to this dialog's flat
 * rows; it is the second exception now, for the same reason.
 *
 * THE BRAND MARK, NOW DRAWN (operator request; this paragraph used to argue
 * the opposite, on the grounds that lucide-react dropped GitHub's own
 * octocat and a second, unverified trademarked outline was a worse trade
 * than `GitPullRequest`, a real lucide glyph already imported elsewhere for
 * the same subject). `GithubMark` below is that outline, this time carried
 * the way `PROVIDER_MARKS` (`sources/provider-marks.tsx`) already carries
 * four others: copied verbatim from Simple Icons, CC0, with its source noted
 * at the definition. It is NOT added to `PROVIDER_MARKS` itself -- that table
 * answers "which agent ran this session", a `SourceId`-keyed question this
 * card is not asking; a GitHub host icon and a GitHub Copilot session-source
 * icon are two different pictures for two different facts, and folding this
 * one into a table built for the other would have this card's own icon
 * fetched by an id that has never meant "GitHub the host" anywhere else in
 * the app.
 *
 * TOKENS NEVER RENDERED, NEVER LOGGED. `gh` keeps the credential in the
 * Keychain and this component never asks it for one -- `GithubAuthStatus`'s
 * own type carries a login, a host and a scope list, never a secret, so
 * there is no string here that COULD leak one by being printed.
 */

import { useCallback, useEffect, useState } from 'react';
import type { GithubApi } from '../../preload/api.js';
import type { GithubAuthPaneView, GithubAuthStatus, GithubRemote } from '../../shared/github.js';
import { GITHUB_LOGIN_COMMAND, GITHUB_LOGOUT_COMMAND } from '../../shared/github.js';
import type { SourceId } from '../domain/model.js';
import { t } from '../i18n/strings.js';
import { type Prefs, prRepoFor, setProjectPrRepo } from '../prefs/prefs.js';
import { ExternalLink } from './primitives.js';

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

const BUTTON = `vam-tap flex h-[28px] w-fit cursor-pointer items-center rounded border border-line px-3 text-control text-ink-dim capitalize hover:border-line-strong hover:text-ink disabled:cursor-default disabled:opacity-60 ${FOCUS_RING}`;

// GitHub's own mark, path data copied verbatim from Simple Icons (CC0 1.0): https://github.com/simple-icons/simple-icons/blob/16.32.0/icons/github.svg
function GithubMark({ size = 16 }: { readonly size?: number }) {
  return (
    <svg
      data-github-mark
      viewBox="0 0 24 24"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      className="text-ink-dim"
    >
      <path
        fill="currentColor"
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
      />
    </svg>
  );
}

/**
 * THE STATUS PILL'S OWN THREE STATES -- coarser than `GithubAuthStatusKind`
 * (which also carries `unknown`, `gh auth status` answering something this
 * app cannot parse): `unknown` reads as `not-connected` here, the same
 * "nothing to press but re-check" shape `logged-out` already has, and the
 * longer `data-github-status` sentence right below the pill still carries
 * the raw message for an operator who wants it.
 */
type GithubPillKind = 'connected' | 'not-connected' | 'cli-missing';

function pillKindFor(kind: GithubAuthStatus['kind']): GithubPillKind {
  if (kind === 'cli-missing') return 'cli-missing';
  if (kind === 'logged-in') return 'connected';
  return 'not-connected';
}

const PILL_TEXT: Record<GithubPillKind, string> = {
  connected: t('settings.integrations.github.pill.connected'),
  'not-connected': t('settings.integrations.github.pill.notConnected'),
  'cli-missing': t('settings.integrations.github.pill.cliMissing'),
};

/** `SessionList.tsx`'s own status-filter pill tokens, the same precedent
 *  `AdhdSkillCard.tsx`'s `PILL_TONE`/`PILL_BORDER` already cite. */
const PILL_TONE: Record<GithubPillKind, string> = {
  connected: 'text-done',
  'not-connected': 'text-waiting',
  'cli-missing': 'text-failed',
};
const PILL_BORDER: Record<GithubPillKind, string> = {
  connected: 'border-done-tint',
  'not-connected': 'border-waiting-tint',
  'cli-missing': 'border-failed/40',
};

/**
 * A REAL PILL, `AdhdSkillCard.tsx`'s `StatusPill` in every measurement --
 * same rounded-full/bordered/dotted shape, same two tone tables. The one
 * difference: `cli-missing` carries NO `capitalize` class and instead
 * `data-verbatim` (`GithubPanel.tsx`'s own header explains this file has no
 * brand mark to carry, but `gh` -- the CLI binary's own, lower-case name --
 * is exactly the "somebody chose these letters" case that attribute exists
 * for; `text-transform: capitalize` would otherwise paint it "Gh Not
 * Installed", capitalising an acronym as if it were a sentence). The
 * case-ladder sweep (`e2e/settings-chrome-shots.mjs`) excludes anything
 * `data-verbatim` marks from its own "every control is capitalised" rule for
 * the identical reason.
 */
function GithubStatusPill({ kind }: { readonly kind: GithubPillKind }) {
  const verbatim = kind === 'cli-missing';
  return (
    <span
      data-github-status-pill={kind}
      {...(verbatim ? { 'data-verbatim': true } : {})}
      className={`inline-flex items-center gap-1.5 rounded-full border bg-ground px-2.5 py-1 font-mono text-control ${verbatim ? '' : 'capitalize'} ${PILL_BORDER[kind]} ${PILL_TONE[kind]}`}
    >
      <span
        aria-hidden="true"
        className="inline-block h-[6px] w-[6px] flex-none rounded-full bg-current"
      />
      {PILL_TEXT[kind]}
    </span>
  );
}

/** The bridge, where there is one -- `UpdatePanel.tsx`'s own local cast, not
 *  a global `Window` member: a browser tab and the paired phone have neither
 *  a preload nor this member. */
type BridgeWithGithub = { readonly github?: GithubApi };
export function desktopGithubApi(): GithubApi | undefined {
  return (globalThis.window as { api?: BridgeWithGithub } | undefined)?.api?.github;
}

/** How often the pane's own screen is re-read while Connect/Disconnect is
 *  running. A poll, not a stream: the pane is plain text and this is a
 *  Settings dialog, not the Terminal tab. */
const PANE_POLL_MS = 800;

function statusSentence(status: GithubAuthStatus | null): string {
  if (status === null) return '';
  switch (status.kind) {
    case 'cli-missing':
      return t('settings.integrations.github.status.missing');
    case 'logged-out':
      return t('settings.integrations.github.status.loggedOut');
    case 'unknown':
      return t('settings.integrations.github.status.unknown', { message: status.message });
    case 'logged-in': {
      const active = status.accounts.find((a) => a.active) ?? status.accounts[0];
      return active === undefined
        ? t('settings.integrations.github.status.loggedOut')
        : t('settings.integrations.github.status.loggedIn', {
            login: active.login,
            host: active.host,
          });
    }
    default:
      return '';
  }
}

export type GithubPanelProps = {
  /** Absent in the browser build and on a phone -- neither has a preload. */
  readonly api: GithubApi | undefined;
  /** Polling (the pane's screen) runs only while this section is open. */
  readonly active: boolean;
  readonly prefs: Prefs;
  readonly onChange: (next: Prefs) => void;
  /** Every project vam knows about, so the repo picker can be aimed at one. */
  readonly projects: readonly {
    readonly id: string;
    readonly source: SourceId;
    readonly name: string;
  }[];
  /** Electron's clipboard; the page's own is denied by the permission policy. */
  readonly copyText?: (text: string) => Promise<boolean>;
  /** The native folder picker behind "choose another repo" -- absent in the
   *  browser build, which has no dialog bridge either. */
  readonly chooseDirectory?: () => Promise<string | null>;
  /**
   * Opens the gh-missing guide's two external links (brew.sh, cli.github.com)
   * in the operating system's browser -- `window.api.link.open`, the same
   * allowlisted bridge `out-markdown.tsx` already uses for an agent's own
   * links (`src/main/link/ipc.ts`). Absent in the browser build, which has no
   * preload and therefore no policy to be refused by either -- see
   * `ExternalLink` (`primitives.js`).
   */
  readonly openExternal?: (url: string) => Promise<unknown>;
};

export function GithubPanel({
  api,
  active,
  prefs,
  onChange,
  projects,
  copyText,
  chooseDirectory,
  openExternal,
}: GithubPanelProps) {
  const [status, setStatus] = useState<GithubAuthStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [pane, setPane] = useState<GithubAuthPaneView>({ kind: 'none' });
  const [connecting, setConnecting] = useState(false);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  /** WHICH command was last copied, not a bare flag -- the login/logout
   *  command and the guide's own `brew install gh` are two independent
   *  buttons now, and a single `copied` boolean would have flipped BOTH to
   *  "copied" from either press. `null` covers "neither, or the 2s window
   *  already closed". */
  const [copied, setCopied] = useState<'command' | 'brew' | null>(null);

  const check = useCallback(async () => {
    if (api === undefined) return;
    setChecking(true);
    try {
      setStatus(await api.authStatus());
    } finally {
      setChecking(false);
    }
  }, [api]);

  useEffect(() => {
    if (!active) return;
    void check();
    // Read once per mount/activation, never polled: the operator's own
    // "re-check" press (or the pane ending, below) is what asks again.
  }, [active, check]);

  // Poll the pane's own screen while one is running, and stop the instant it
  // answers anything but `ok` -- `ended` re-checks status once, the same
  // signal a manual re-check gives, because Connect/Disconnect just changed
  // exactly the fact this section reports.
  useEffect(() => {
    if (api === undefined || !active || pane.kind !== 'ok') return;
    let live = true;
    const timer = setInterval(() => {
      void api.connectRead().then((next) => {
        if (!live) return;
        setPane(next);
        if (next.kind !== 'ok') void check();
      });
    }, PANE_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, active, pane.kind, check]);

  const startPane = async (kind: 'login' | 'logout') => {
    if (api === undefined) return;
    setConnecting(true);
    setConfirmingLogout(false);
    try {
      await api.connectStart(kind);
      setPane(await api.connectRead());
    } finally {
      setConnecting(false);
    }
  };

  const copy = async (command: string, which: 'command' | 'brew') => {
    if (copyText === undefined) return;
    const ok = await copyText(command);
    if (ok) {
      setCopied(which);
      // Clears only ITS OWN "copied" -- if the other button was pressed
      // again in between, its own timeout (not this one) owns the reset.
      setTimeout(() => setCopied((current) => (current === which ? null : current)), 2_000);
    }
  };

  const missingScopes =
    status?.kind === 'logged-in'
      ? (status.accounts.find((a) => a.active)?.missingScopes ?? [])
      : [];
  const isLoggedIn = status?.kind === 'logged-in' && status.accounts.length > 0;
  const activeAccount =
    isLoggedIn && status?.kind === 'logged-in' ? status.accounts.find((a) => a.active) : undefined;
  const command =
    pane.kind === 'ok' && pane.authKind === 'logout' ? GITHUB_LOGOUT_COMMAND : GITHUB_LOGIN_COMMAND;

  return (
    <div className="mt-6 first:mt-0" data-settings-block="github">
      {/* THE CARD ITSELF, `AdhdSkillCard.tsx`'s own shape verbatim -- see this
          file's own header for why it is the second exception to this
          dialog's otherwise-flat rows, not an invention of its own. */}
      <div className="flex flex-col gap-3 rounded border border-line bg-card p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 flex-none items-center justify-center rounded border border-line-strong">
            <GithubMark size={16} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="m-0 font-medium text-body text-ink capitalize">
                {t('settings.integrations.github.heading')}
              </h4>
              {/* ABSENT, NOT DIMMED, WHILE THE FIRST READ IS IN FLIGHT --
                  `AdhdSkillCard.tsx`'s own rule for its pill, reused: the read
                  is one `gh auth status` spawn, over before a blank pill
                  could be noticed, and there is no bridge at all to draw one
                  against in the browser build. */}
              {api !== undefined && status !== null && (
                <span className="ml-auto">
                  <GithubStatusPill kind={pillKindFor(status.kind)} />
                </span>
              )}
            </div>
            <p className="vam-sentence m-0 max-w-[52ch] text-control text-ink-dim">
              {t('settings.integrations.github.hint')}
            </p>
          </div>
        </div>

        {/* "LOGGED IN AS: **ACCOUNT**" -- the operator's own words, item F.
            `data-verbatim`: a GitHub login is a proper name a person chose,
            the same rank `AdhdSkillCard.tsx`'s credit link already carries
            for a handle. */}
        {isLoggedIn && activeAccount !== undefined ? (
          <p data-github-account-line className="m-0 text-control text-ink-dim">
            {t('settings.integrations.github.loggedInAs')}{' '}
            <span data-github-account data-verbatim className="font-medium text-ink">
              {activeAccount.login}
            </span>
          </p>
        ) : null}

        {api === undefined ? (
          <p
            data-testid="github-off"
            className="vam-sentence m-0 max-w-[52ch] text-control text-ink-dim"
          >
            {t('settings.integrations.github.status.missing')}
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span data-github-status className="text-body text-ink">
                  {checking && status === null
                    ? t('settings.integrations.github.rechecking')
                    : statusSentence(status)}
                </span>
              </div>
              {status?.kind !== 'cli-missing' ? (
                <button
                  type="button"
                  data-github-recheck
                  disabled={checking}
                  aria-busy={checking}
                  onClick={() => void check()}
                  className={BUTTON}
                >
                  {checking
                    ? t('settings.integrations.github.rechecking')
                    : t('settings.integrations.github.recheck')}
                </button>
              ) : null}
              {missingScopes.length > 0 ? (
                <p
                  data-github-scopes-warning
                  className="max-w-[52ch] text-control text-ink-dim"
                  role="alert"
                >
                  {t('settings.integrations.github.scopesWarning', {
                    scopes: missingScopes.join(', '),
                  })}
                </p>
              ) : null}
              {/* THE GH-MISSING GUIDE (operator request): the pill and the
                  status sentence above already say `gh` is not on PATH; this
                  is what to DO about it -- install, sign in, then ask again,
                  never run for the operator. `brew install gh` is the one
                  command vam offers to copy; `gh auth login` is shown but not
                  copy-wired, since it is the second STEP, not a fix the
                  operator would run before `gh` exists to run it against. */}
              {status?.kind === 'cli-missing' ? (
                <div
                  data-github-cli-guide
                  className="flex flex-col gap-2 rounded border border-line bg-well p-3"
                >
                  <p className="vam-sentence m-0 max-w-[52ch] text-control text-ink-dim">
                    {t('settings.integrations.github.guide.intro')}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code
                      data-github-guide-brew
                      data-verbatim
                      className="rounded border border-line bg-panel px-2 py-1 font-mono text-control text-ink"
                    >
                      brew install gh
                    </code>
                    {copyText !== undefined ? (
                      <button
                        type="button"
                        data-github-guide-copy-brew
                        onClick={() => void copy('brew install gh', 'brew')}
                        className={BUTTON}
                      >
                        {copied === 'brew'
                          ? t('settings.integrations.github.copied')
                          : t('settings.integrations.github.copyCommand')}
                      </button>
                    ) : null}
                  </div>
                  {/* NO Homebrew DETECTION -- checking that would need a second
                      main-process spawn (`brew --version` or similar) this
                      panel has no bridge for today, and the operator's own
                      instruction covers exactly this case: link out rather
                      than build the check. */}
                  <p className="vam-sentence m-0 max-w-[52ch] text-control text-ink-faint">
                    {t('settings.integrations.github.guide.noBrew')}{' '}
                    <ExternalLink
                      href="https://brew.sh"
                      onOpen={
                        openExternal === undefined
                          ? undefined
                          : () => void openExternal('https://brew.sh')
                      }
                      className="underline"
                    >
                      https://brew.sh
                    </ExternalLink>
                  </p>
                  <code
                    data-github-guide-login
                    data-verbatim
                    className="w-fit rounded border border-line bg-panel px-2 py-1 font-mono text-control text-ink"
                  >
                    gh auth login
                  </code>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-github-guide-check
                      disabled={checking}
                      aria-busy={checking}
                      onClick={() => void check()}
                      className={BUTTON}
                    >
                      {checking
                        ? t('settings.integrations.github.rechecking')
                        : t('settings.integrations.github.guide.checkAgain')}
                    </button>
                    <ExternalLink
                      href="https://cli.github.com"
                      onOpen={
                        openExternal === undefined
                          ? undefined
                          : () => void openExternal('https://cli.github.com')
                      }
                      className="text-control text-ink-dim underline"
                    >
                      {t('settings.integrations.github.status.installLink')}
                    </ExternalLink>
                  </div>
                </div>
              ) : null}
            </div>

            {status?.kind !== 'cli-missing' ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {isLoggedIn ? (
                    confirmingLogout ? (
                      <>
                        <span className="text-control text-ink-dim">
                          {t('settings.integrations.github.disconnect.confirm')}
                        </span>
                        <button
                          type="button"
                          data-github-disconnect-confirm
                          disabled={connecting}
                          onClick={() => void startPane('logout')}
                          className={BUTTON}
                        >
                          {t('settings.integrations.github.disconnect.yes')}
                        </button>
                        <button
                          type="button"
                          data-github-disconnect-cancel
                          onClick={() => setConfirmingLogout(false)}
                          className={BUTTON}
                        >
                          {t('settings.integrations.github.disconnect.cancel')}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        data-github-disconnect
                        onClick={() => setConfirmingLogout(true)}
                        className={BUTTON}
                      >
                        {t('settings.integrations.github.disconnect')}
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      data-github-connect
                      disabled={connecting}
                      aria-busy={connecting}
                      onClick={() => void startPane('login')}
                      className={BUTTON}
                    >
                      {connecting
                        ? t('settings.integrations.github.connecting')
                        : t('settings.integrations.github.connect')}
                    </button>
                  )}
                  {copyText !== undefined ? (
                    <button
                      type="button"
                      data-github-copy-command
                      onClick={() =>
                        void copy(
                          isLoggedIn ? GITHUB_LOGOUT_COMMAND : GITHUB_LOGIN_COMMAND,
                          'command',
                        )
                      }
                      className={BUTTON}
                    >
                      {copied === 'command'
                        ? t('settings.integrations.github.copied')
                        : t('settings.integrations.github.copyCommand')}
                    </button>
                  ) : null}
                </div>
                {pane.kind === 'ok' ? (
                  <pre
                    data-github-pane
                    className="max-h-[160px] overflow-auto whitespace-pre-wrap rounded border border-line bg-well p-2 font-mono text-control text-ink"
                  >
                    {pane.text}
                  </pre>
                ) : pane.kind === 'ended' ? (
                  <p className="text-control text-ink-dim">
                    {t('settings.integrations.github.pane.ended')}
                  </p>
                ) : null}
                {/* The command line drawn under "Copy command" -- what was, or will
              be, typed into the pane, for an operator who wants to run it in
              their own terminal instead. `data-verbatim`: shell syntax is
              not a sentence, and the structural sentence-case rule
              ([data-settings-rows] p::first-letter, `styles.css`) would
              otherwise paint `gh auth login` as `Gh auth login` -- a real
              command an operator might paste, capitalised into one that
              fails. Found in this card's own "after" screenshot (item F),
              not by a guard: `settings-chrome-shots.mjs`'s case ladder never
              reaches this row at all in the browser build it runs against
              (no bridge, no pane, no command line to sweep). */}
                {copyText !== undefined ? (
                  <p data-verbatim className="font-mono text-control text-ink-faint">
                    {command}
                  </p>
                ) : null}
              </div>
            ) : null}

            <RepoPicker
              api={api}
              prefs={prefs}
              onChange={onChange}
              projects={projects}
              chooseDirectory={chooseDirectory}
            />
          </>
        )}
      </div>
    </div>
  );
}

type RepoPickerProps = {
  readonly api: GithubApi;
  readonly prefs: Prefs;
  readonly onChange: (next: Prefs) => void;
  readonly projects: GithubPanelProps['projects'];
  readonly chooseDirectory?: () => Promise<string | null>;
};

function RepoPicker({ api, prefs, onChange, projects, chooseDirectory }: RepoPickerProps) {
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(false);
  const [remotes, setRemotes] = useState<readonly GithubRemote[]>([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<readonly string[]>([]);
  const [searching, setSearching] = useState(false);
  const project = projects[selected];

  /** Switching WHICH project this picker is aimed at (the `<select>` below)
   *  closes any open search rather than leaving a stale search or its
   *  results on screen for a project they no longer describe. Done inline,
   *  in the one place `selected` can change, rather than a `useEffect`
   *  keyed on a value nothing in its body reads. */
  const selectProject = (index: number) => {
    setSelected(index);
    setOpen(false);
    setResults([]);
    setSearch('');
  };

  useEffect(() => {
    if (!open || project === undefined) return;
    let live = true;
    void api.projectRemotes(project.id).then((next) => {
      if (live) setRemotes(next);
    });
    return () => {
      live = false;
    };
  }, [open, project, api]);

  if (project === undefined) {
    return (
      <p data-github-repo-noproject className="text-control text-ink-dim">
        {t('settings.integrations.repo.noProject')}
      </p>
    );
  }

  const override = prRepoFor(prefs, project.source, project.id);
  const currentName =
    override === null
      ? t('settings.integrations.repo.own')
      : override.replace(/\/+$/, '').split('/').pop() || override;

  const runSearch = async () => {
    const owner = search.trim().split('/')[0] ?? '';
    if (owner === '') return;
    setSearching(true);
    try {
      const answer = await api.reposList(owner);
      setResults(answer.kind === 'ok' ? answer.repos : []);
    } finally {
      setSearching(false);
    }
  };

  const isOwnRemote = (repo: string) => remotes.some((r) => r.repo === repo);

  const pick = async (repo: string) => {
    if (isOwnRemote(repo)) {
      onChange(setProjectPrRepo(prefs, project.source, project.id, ''));
      return;
    }
    if (chooseDirectory === undefined) return;
    const picked = await chooseDirectory();
    if (picked === null) return;
    onChange(setProjectPrRepo(prefs, project.source, project.id, picked));
  };

  const filteredRemotes = remotes.filter(
    (r) => search.trim() === '' || r.repo.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const candidates = [
    ...filteredRemotes.map((r) => r.repo),
    ...results.filter((r) => !filteredRemotes.some((f) => f.repo === r)),
  ];

  return (
    <div className="flex flex-col gap-2 border-line border-t pt-4">
      <h4 className="font-medium text-body text-ink capitalize">
        {t('settings.integrations.repo.heading')}
      </h4>
      {projects.length > 1 ? (
        <select
          aria-label="project"
          value={selected}
          onChange={(event) => selectProject(Number(event.target.value))}
          className="h-[28px] w-fit rounded border border-line bg-panel px-2 text-control text-ink"
        >
          {projects.map((p, i) => (
            <option key={p.id} value={i}>
              {p.name}
            </option>
          ))}
        </select>
      ) : null}
      <p data-github-repo-current className="text-control text-ink-dim">
        {t('settings.integrations.repo.current', { name: currentName })}
      </p>
      <div className="flex gap-2">
        {override !== null ? (
          <button
            type="button"
            data-github-repo-clear
            onClick={() => onChange(setProjectPrRepo(prefs, project.source, project.id, ''))}
            className={BUTTON}
          >
            {t('settings.integrations.repo.clear')}
          </button>
        ) : null}
        <button
          type="button"
          data-github-repo-change
          onClick={() => setOpen((was) => !was)}
          className={BUTTON}
        >
          {t('settings.integrations.repo.change')}
        </button>
      </div>
      {open ? (
        <div className="flex flex-col gap-2 rounded border border-line p-2">
          <label className="flex flex-col gap-1 text-control text-ink-dim">
            {t('settings.integrations.repo.searchLabel')}
            <div className="flex gap-2">
              <input
                data-github-repo-search
                type="text"
                value={search}
                placeholder={t('settings.integrations.repo.searchPlaceholder')}
                onChange={(event) => setSearch(event.target.value)}
                className="h-[28px] flex-1 rounded border border-line bg-panel px-2 text-control text-ink"
              />
              <button
                type="button"
                data-github-repo-search-button
                disabled={searching}
                onClick={() => void runSearch()}
                className={BUTTON}
              >
                {t('settings.integrations.repo.searchButton')}
              </button>
            </div>
          </label>
          {filteredRemotes.length > 0 ? (
            <p className="text-control text-ink-faint">
              {t('settings.integrations.repo.suggested')}
            </p>
          ) : null}
          <ul className="flex flex-col gap-1">
            {candidates.map((repo) => (
              <li key={repo}>
                <button
                  type="button"
                  data-github-repo-candidate
                  onClick={() => void pick(repo)}
                  className="vam-tap w-full cursor-pointer rounded px-2 py-1 text-left text-control text-ink hover:bg-segment-on"
                >
                  {repo}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
