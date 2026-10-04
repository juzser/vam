/**
 * Settings -> Integrations -> GitLab.
 *
 * Operator: "add other providers like GitLab and Bitbucket?" -- then, asked
 * to choose: "GitLab now via glab, Bitbucket later." `GithubPanel.tsx`'s own
 * shape, mirrored and narrowed to what was actually asked for: a status
 * read, and a pane vam types `glab auth login`/`glab auth logout` into.
 * vam stores no token of its own -- `glab` keeps it in the OS keyring (or,
 * lacking one, its own plaintext config file), exactly as `GithubPanel.tsx`
 * relies on `gh`'s Keychain for the same guarantee.
 *
 * NO REPO PICKER, NO SCOPES WARNING -- both were asked of the GitHub card
 * and neither was asked of this one. Merge requests, MR status and a repo
 * picker are explicitly out of scope for this pass ("Bitbucket later" was
 * the other half of the same sentence that scoped GitLab to just this).
 * `glab auth status` has no `--json` form and reports no scopes at all
 * either (`shared/gitlab.ts`'s own header), so there is nothing here for a
 * scopes warning to read.
 *
 * THE SAME CARD SHAPE `GithubPanel.tsx` uses -- `AdhdSkillCard.tsx`'s own
 * top row (icon tile, `h4` title, a one-line hint, a pill in the corner) --
 * reused rather than invented a second time, so the two cards read as
 * siblings in the Integrations section rather than two different ideas of
 * what a connected-account card looks like.
 *
 * THE BRAND MARK: `GitlabMark` below is GitLab's own outline, copied
 * verbatim from Simple Icons (CC0), the same source and the same pinned
 * version `GithubMark` cites -- carried the identical way, at the identical
 * rank (this file's own icon tile, never `PROVIDER_MARKS`, which answers "an
 * agent host source", a different question this card never asks).
 *
 * TOKENS NEVER RENDERED, NEVER LOGGED. `glab` keeps the credential in the
 * keyring and this component never asks it for one -- `GitlabAuthStatus`'s
 * own type carries a login and a host, never a secret, so there is no
 * string here that COULD leak one by being printed.
 */

import { useCallback, useEffect, useState } from 'react';
import type { GitlabApi } from '../../preload/api.js';
import type { GitlabAuthPaneView, GitlabAuthStatus } from '../../shared/gitlab.js';
import { GITLAB_LOGIN_COMMAND, GITLAB_LOGOUT_COMMAND } from '../../shared/gitlab.js';
import { t } from '../i18n/strings.js';
import { ExternalLink } from './primitives.js';

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

const BUTTON = `vam-tap flex h-[28px] w-fit cursor-pointer items-center rounded border border-line px-3 text-control text-ink-dim capitalize hover:border-line-strong hover:text-ink disabled:cursor-default disabled:opacity-60 ${FOCUS_RING}`;

// GitLab's own mark, path data copied verbatim from Simple Icons (CC0 1.0): https://github.com/simple-icons/simple-icons/blob/16.32.0/icons/gitlab.svg
function GitlabMark({ size = 16 }: { readonly size?: number }) {
  return (
    <svg
      data-gitlab-mark
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
        d="m23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z"
      />
    </svg>
  );
}

/** `GithubPillKind`'s own three states, restated for GitLab -- coarser than
 *  `GitlabAuthStatus['kind']`, which also carries `unknown`. */
type GitlabPillKind = 'connected' | 'not-connected' | 'cli-missing' | 'no-active-account';

function pillKindFor(status: GitlabAuthStatus): GitlabPillKind {
  const kind = status.kind;
  if (kind === 'cli-missing') return 'cli-missing';
  if (status.kind === 'logged-in' && status.accounts.length === 0) return 'no-active-account';
  if (kind === 'logged-in') return 'connected';
  return 'not-connected';
}

const PILL_TEXT: Record<GitlabPillKind, string> = {
  connected: t('settings.integrations.gitlab.pill.connected'),
  'not-connected': t('settings.integrations.gitlab.pill.notConnected'),
  'cli-missing': t('settings.integrations.gitlab.pill.cliMissing'),
  'no-active-account': t('settings.integrations.gitlab.pill.noActiveAccount'),
};

/** `GithubStatusPill`'s own tone tables, reused. */
const PILL_TONE: Record<GitlabPillKind, string> = {
  connected: 'text-done',
  'not-connected': 'text-waiting',
  'cli-missing': 'text-failed',
  'no-active-account': 'text-waiting',
};
const PILL_BORDER: Record<GitlabPillKind, string> = {
  connected: 'border-done-tint',
  'not-connected': 'border-waiting-tint',
  'cli-missing': 'border-failed/40',
  'no-active-account': 'border-waiting-tint',
};

/**
 * `GithubStatusPill`'s own shape, mirrored: `cli-missing` carries
 * `data-verbatim` rather than `capitalize` -- `glab`, the CLI binary's own
 * lower-case name, is exactly the "somebody chose these letters" case that
 * attribute exists for.
 */
function GitlabStatusPill({ kind }: { readonly kind: GitlabPillKind }) {
  const verbatim = kind === 'cli-missing';
  return (
    <span
      data-gitlab-status-pill={kind}
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

/** `desktopGithubApi`'s own local cast, restated: a browser tab and the
 *  paired phone have neither a preload nor this member. */
type BridgeWithGitlab = { readonly gitlab?: GitlabApi };
export function desktopGitlabApi(): GitlabApi | undefined {
  return (globalThis.window as { api?: BridgeWithGitlab } | undefined)?.api?.gitlab;
}

/** `PANE_POLL_MS`'s own figure, restated: a poll, not a stream. */
const PANE_POLL_MS = 800;

function statusSentence(status: GitlabAuthStatus | null): string {
  if (status === null) return '';
  switch (status.kind) {
    case 'cli-missing':
      return t('settings.integrations.gitlab.status.missing');
    case 'logged-out':
      return t('settings.integrations.gitlab.status.loggedOut');
    case 'unknown':
      return t('settings.integrations.gitlab.status.unknown', { message: status.message });
    case 'logged-in': {
      return '';
    }
    default:
      return '';
  }
}

export type GitlabPanelProps = {
  /** Absent in the browser build and on a phone -- neither has a preload. */
  readonly api: GitlabApi | undefined;
  /** Polling (the pane's screen) runs only while this section is open. */
  readonly active: boolean;
  /** Electron's clipboard; the page's own is denied by the permission policy. */
  readonly copyText?: (text: string) => Promise<boolean>;
  /**
   * Opens the glab-missing guide's two external links (brew.sh, the glab CLI
   * project) in the operating system's browser -- `GithubPanelProps.openExternal`'s
   * own contract, restated.
   */
  readonly openExternal?: (url: string) => Promise<unknown>;
};

export function GitlabPanel({ api, active, copyText, openExternal }: GitlabPanelProps) {
  const [status, setStatus] = useState<GitlabAuthStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [pane, setPane] = useState<GitlabAuthPaneView>({ kind: 'none' });
  const [connecting, setConnecting] = useState(false);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
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
  }, [active, check]);

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
      setTimeout(() => setCopied((current) => (current === which ? null : current)), 2_000);
    }
  };

  const isLoggedIn = status?.kind === 'logged-in' && status.accounts.length > 0;
  const sentence =
    checking && status === null
      ? t('settings.integrations.gitlab.rechecking')
      : statusSentence(status);
  const activeAccount = isLoggedIn && status?.kind === 'logged-in' ? status.accounts[0] : undefined;
  const command =
    pane.kind === 'ok' && pane.authKind === 'logout' ? GITLAB_LOGOUT_COMMAND : GITLAB_LOGIN_COMMAND;

  return (
    <div className="mt-6 first:mt-0" data-settings-block="gitlab">
      <div className="flex flex-col gap-3 rounded border border-line bg-card p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 flex-none items-center justify-center rounded border border-line-strong">
            <GitlabMark size={16} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="m-0 font-medium text-body text-ink capitalize">
                {t('settings.integrations.gitlab.heading')}
              </h4>
              {api !== undefined && status !== null && (
                <span className="ml-auto">
                  <GitlabStatusPill kind={pillKindFor(status)} />
                </span>
              )}
            </div>
            <p className="vam-sentence m-0 max-w-[52ch] text-control text-ink-dim">
              {t('settings.integrations.gitlab.hint')}
            </p>
          </div>
        </div>

        {api !== undefined && status !== null && pillKindFor(status) === 'no-active-account' ? (
          <p
            data-gitlab-no-active-account
            className="vam-sentence m-0 max-w-[52ch] text-control text-ink-dim"
          >
            {t('settings.integrations.gitlab.noActiveAccount')}
          </p>
        ) : null}

        {isLoggedIn && activeAccount !== undefined ? (
          <p data-gitlab-account-line className="m-0 text-control text-ink-dim">
            {t('settings.integrations.gitlab.loggedInAs')}{' '}
            <span data-gitlab-account data-verbatim className="font-medium text-ink">
              {activeAccount.login}
            </span>
          </p>
        ) : null}

        {api === undefined ? (
          <p
            data-testid="gitlab-off"
            className="vam-sentence m-0 max-w-[52ch] text-control text-ink-dim"
          >
            {t('settings.integrations.gitlab.status.missing')}
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {sentence === '' ? null : (
                <div className="flex items-center gap-2">
                  <span data-gitlab-status className="text-body text-ink">
                    {sentence}
                  </span>
                </div>
              )}
              {status?.kind !== 'cli-missing' ? (
                <button
                  type="button"
                  data-gitlab-recheck
                  disabled={checking}
                  aria-busy={checking}
                  onClick={() => void check()}
                  className={BUTTON}
                >
                  {checking
                    ? t('settings.integrations.gitlab.rechecking')
                    : t('settings.integrations.gitlab.recheck')}
                </button>
              ) : null}
              {status?.kind === 'cli-missing' ? (
                <div
                  data-gitlab-cli-guide
                  className="flex flex-col gap-2 rounded border border-line bg-well p-3"
                >
                  <p className="vam-sentence m-0 max-w-[52ch] text-control text-ink-dim">
                    {t('settings.integrations.gitlab.guide.intro')}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code
                      data-gitlab-guide-brew
                      data-verbatim
                      className="rounded border border-line bg-panel px-2 py-1 font-mono text-control text-ink"
                    >
                      brew install glab
                    </code>
                    {copyText !== undefined ? (
                      <button
                        type="button"
                        data-gitlab-guide-copy-brew
                        onClick={() => void copy('brew install glab', 'brew')}
                        className={BUTTON}
                      >
                        {copied === 'brew'
                          ? t('settings.integrations.gitlab.copied')
                          : t('settings.integrations.gitlab.copyCommand')}
                      </button>
                    ) : null}
                  </div>
                  <p className="vam-sentence m-0 max-w-[52ch] text-control text-ink-faint">
                    {t('settings.integrations.gitlab.guide.noBrew')}{' '}
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
                    data-gitlab-guide-login
                    data-verbatim
                    className="w-fit rounded border border-line bg-panel px-2 py-1 font-mono text-control text-ink"
                  >
                    glab auth login
                  </code>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-gitlab-guide-check
                      disabled={checking}
                      aria-busy={checking}
                      onClick={() => void check()}
                      className={BUTTON}
                    >
                      {checking
                        ? t('settings.integrations.gitlab.rechecking')
                        : t('settings.integrations.gitlab.guide.checkAgain')}
                    </button>
                    <ExternalLink
                      href="https://gitlab.com/gitlab-org/cli"
                      onOpen={
                        openExternal === undefined
                          ? undefined
                          : () => void openExternal('https://gitlab.com/gitlab-org/cli')
                      }
                      className="text-control text-ink-dim underline"
                    >
                      {t('settings.integrations.gitlab.status.installLink')}
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
                          {t('settings.integrations.gitlab.disconnect.confirm')}
                        </span>
                        <button
                          type="button"
                          data-gitlab-disconnect-confirm
                          disabled={connecting}
                          onClick={() => void startPane('logout')}
                          className={BUTTON}
                        >
                          {t('settings.integrations.gitlab.disconnect.yes')}
                        </button>
                        <button
                          type="button"
                          data-gitlab-disconnect-cancel
                          onClick={() => setConfirmingLogout(false)}
                          className={BUTTON}
                        >
                          {t('settings.integrations.gitlab.disconnect.cancel')}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        data-gitlab-disconnect
                        onClick={() => setConfirmingLogout(true)}
                        className={BUTTON}
                      >
                        {t('settings.integrations.gitlab.disconnect')}
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      data-gitlab-connect
                      disabled={connecting}
                      aria-busy={connecting}
                      onClick={() => void startPane('login')}
                      className={BUTTON}
                    >
                      {connecting
                        ? t('settings.integrations.gitlab.connecting')
                        : t('settings.integrations.gitlab.connect')}
                    </button>
                  )}
                  {copyText !== undefined ? (
                    <button
                      type="button"
                      data-gitlab-copy-command
                      onClick={() =>
                        void copy(
                          isLoggedIn ? GITLAB_LOGOUT_COMMAND : GITLAB_LOGIN_COMMAND,
                          'command',
                        )
                      }
                      className={BUTTON}
                    >
                      {copied === 'command'
                        ? t('settings.integrations.gitlab.copied')
                        : t('settings.integrations.gitlab.copyCommand')}
                    </button>
                  ) : null}
                </div>
                {pane.kind === 'ok' ? (
                  <pre
                    data-gitlab-pane
                    className="max-h-[160px] overflow-auto whitespace-pre-wrap rounded border border-line bg-well p-2 font-mono text-control text-ink"
                  >
                    {pane.text}
                  </pre>
                ) : pane.kind === 'ended' ? (
                  <p className="text-control text-ink-dim">
                    {t('settings.integrations.gitlab.pane.ended')}
                  </p>
                ) : null}
                {copyText !== undefined ? (
                  <p data-verbatim className="font-mono text-control text-ink-faint">
                    {command}
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
