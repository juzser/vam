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
 */

import { useCallback, useEffect, useState } from 'react';
import type { GithubApi } from '../../preload/api.js';
import type { GithubAuthPaneView, GithubAuthStatus, GithubRemote } from '../../shared/github.js';
import { GITHUB_LOGIN_COMMAND, GITHUB_LOGOUT_COMMAND } from '../../shared/github.js';
import type { SourceId } from '../domain/model.js';
import { t } from '../i18n/strings.js';
import { type Prefs, prRepoFor, setProjectPrRepo } from '../prefs/prefs.js';

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

const BUTTON = `vam-tap flex h-[28px] w-fit cursor-pointer items-center rounded border border-line px-3 text-control text-ink-dim capitalize hover:border-line-strong hover:text-ink disabled:cursor-default disabled:opacity-60 ${FOCUS_RING}`;

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
};

export function GithubPanel({
  api,
  active,
  prefs,
  onChange,
  projects,
  copyText,
  chooseDirectory,
}: GithubPanelProps) {
  const [status, setStatus] = useState<GithubAuthStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [pane, setPane] = useState<GithubAuthPaneView>({ kind: 'none' });
  const [connecting, setConnecting] = useState(false);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const copy = async (command: string) => {
    if (copyText === undefined) return;
    const ok = await copyText(command);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    }
  };

  if (api === undefined) {
    return (
      <p data-testid="github-off" className="text-control text-ink-dim">
        {t('settings.integrations.github.status.missing')}
      </p>
    );
  }

  const missingScopes =
    status?.kind === 'logged-in'
      ? (status.accounts.find((a) => a.active)?.missingScopes ?? [])
      : [];
  const isLoggedIn = status?.kind === 'logged-in' && status.accounts.length > 0;
  const command =
    pane.kind === 'ok' && pane.authKind === 'logout' ? GITHUB_LOGOUT_COMMAND : GITHUB_LOGIN_COMMAND;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span data-github-status className="text-body text-ink">
            {checking && status === null
              ? t('settings.integrations.github.rechecking')
              : statusSentence(status)}
          </span>
          {status?.kind === 'cli-missing' ? (
            <a
              href="https://cli.github.com"
              target="_blank"
              rel="noreferrer"
              className="text-control text-ink-dim underline"
            >
              {t('settings.integrations.github.status.installLink')}
            </a>
          ) : null}
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
            {t('settings.integrations.github.scopesWarning', { scopes: missingScopes.join(', ') })}
          </p>
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
                onClick={() => void copy(isLoggedIn ? GITHUB_LOGOUT_COMMAND : GITHUB_LOGIN_COMMAND)}
                className={BUTTON}
              >
                {copied
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
              their own terminal instead. */}
          {copyText !== undefined ? (
            <p className="font-mono text-control text-ink-faint">{command}</p>
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
