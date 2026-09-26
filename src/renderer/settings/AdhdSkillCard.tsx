/**
 * THE ADHD SKILL CARD -- what replaced the concise-output switch.
 *
 * Operator, translated: "turn Concise output in Settings into a card [an Orca
 * screenshot]. Talk about the ADHD skill." Asked how it should work, the
 * design decision that followed: INSTALL THE REAL SKILL. `main/terminal/
 * concise.ts` (deleted) typed vam's own ten-rule wording of
 * `ayghri/i-have-adhd` into the first prompt of every session, once, and had
 * to say -- honestly, at length -- that a `/clear` empties it and vam cannot
 * tell. This card instead writes the ACTUAL upstream `SKILL.md` into the
 * agent's own skills directory, which every session that agent ever starts
 * reads for itself: one the operator started by hand, one started before vam
 * existed, one running right now. There is nothing left for a `/clear` to
 * outrun.
 *
 * `src/shared/adhd-skill.ts` carries the pinned commit, the two directories
 * (`~/.claude/skills`, `~/.agents/skills`) and every state name this card
 * draws; `src/main/skills/adhd-skill.ts` is where a byte moves. This file
 * only asks and draws.
 *
 * NO BRIDGE, NO BUTTONS -- `UpdatePanel.tsx`'s own rule, reused rather than
 * reinvented: a browser tab (the demo fixture, a paired phone) has no
 * preload, so there is nothing on THIS machine for a status check or an
 * install to reach. The title, the one-line description and the credit stay,
 * because they are true regardless of which surface is looking; a sentence
 * says why the rest is missing rather than leaving a silent gap.
 */

import { Brain, Copy, RefreshCw, Terminal, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AdhdSkillApi } from '../../preload/api.js';
import {
  ADHD_SKILL_AGENT_LABEL,
  ADHD_SKILL_AGENTS,
  ADHD_SKILL_SOURCE_URL,
  type AdhdSkillAgent,
  type AdhdSkillState,
  type AdhdSkillStatus,
  adhdSkillInstallCommand,
} from '../../shared/adhd-skill.js';
import { t } from '../i18n/strings.js';
import { type Prefs, setConciseOutput } from '../prefs/prefs.js';
import { Block } from './SettingsOverlay.js';

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

// `capitalize`, LIKE `UpdatePanel.tsx`'s OWN `BUTTON` CONSTANT: every button
// on this surface whose text names a SETTING or an ACTION is Title Case --
// `e2e/settings-chrome-shots.mjs`'s case ladder measures the PAINTED
// `text-transform`, not the letters this file typed, so the class carries
// the fact rather than a capital `I` in the string doing it silently. The
// one exception is the credit link below, which drops this class and adds
// `data-verbatim` instead: a GitHub handle is not a setting's name.
const BUTTON = `vam-tap flex h-[28px] w-fit cursor-pointer items-center gap-1.5 rounded border border-line px-3 text-control text-ink-dim capitalize hover:border-line-strong hover:text-ink disabled:cursor-default disabled:opacity-60 ${FOCUS_RING}`;

const QUIET_BUTTON = `vam-tap flex h-[28px] w-fit cursor-pointer items-center gap-1.5 rounded px-2 text-control text-ink-faint capitalize hover:text-ink-dim disabled:cursor-default disabled:opacity-60 ${FOCUS_RING}`;

/** `QUIET_BUTTON` minus `capitalize`, for the one button whose text is a
 *  proper name rather than a setting: the credit link. Paired with
 *  `data-verbatim`, the same word this codebase already uses for "somebody
 *  chose these letters" (`UpdatePanel.tsx`'s version line). */
const VERBATIM_BUTTON = `vam-tap flex h-[28px] w-fit cursor-pointer items-center gap-1.5 rounded px-2 text-control text-ink-faint hover:text-ink-dim disabled:cursor-default disabled:opacity-60 ${FOCUS_RING}`;

/** The bridge, where there is one. A browser tab has no preload, which is
 *  what decides whether this card draws any button at all -- the same
 *  member name `UpdatePanel.tsx` and `RemotePanel.tsx` use for their own. */
export function desktopAdhdSkillApi(): AdhdSkillApi | undefined {
  return (globalThis.window as { api?: { adhdSkill?: AdhdSkillApi } } | undefined)?.api?.adhdSkill;
}

const PILL_TEXT: Record<AdhdSkillState, string> = {
  'not-installed': t('settings.behaviour.adhd.not-installed'),
  installed: t('settings.behaviour.adhd.installed'),
  'outdated-modified': t('settings.behaviour.adhd.outdated-modified'),
};

/** Amber for "nothing here yet" and for "needs a look", green once every
 *  bundled file matches -- `status-mark.tsx`'s own tokens (`text-waiting`,
 *  `text-done`), reused rather than invented so this pill reads as the same
 *  kind of fact a session's own status dot does. */
const PILL_TONE: Record<AdhdSkillState, string> = {
  'not-installed': 'text-waiting',
  installed: 'text-done',
  'outdated-modified': 'text-failed',
};

function StatusPill({ state }: { readonly state: AdhdSkillState }) {
  return (
    <span
      data-adhd-skill-pill={state}
      className={`inline-flex items-center gap-1.5 text-control font-medium capitalize ${PILL_TONE[state]}`}
    >
      <span
        aria-hidden="true"
        className="inline-block h-[6px] w-[6px] flex-none rounded-full bg-current"
      />
      {PILL_TEXT[state]}
    </span>
  );
}

function agentChipText(state: AdhdSkillState): string {
  switch (state) {
    case 'not-installed':
      return t('settings.behaviour.adhd.agentMissing');
    case 'installed':
      return t('settings.behaviour.adhd.agentInstalled');
    default:
      return t('settings.behaviour.adhd.agentModified');
  }
}

export type AdhdSkillCardProps = {
  readonly prefs: Prefs;
  readonly onChange: (next: Prefs) => void;
  /** Absent in the browser build, which has no preload and no bridge. */
  readonly api: AdhdSkillApi | undefined;
};

export function AdhdSkillCard({ prefs, onChange, api }: AdhdSkillCardProps) {
  const [status, setStatus] = useState<AdhdSkillStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  /** `useCallback`, keyed on `api` alone, so the effect below can list ITS
   *  real dependency (this function) rather than suppressing the rule that
   *  exists to catch a stale one -- the function identity changes only when
   *  the bridge itself does (mount, or a test swapping it), never on every
   *  render, which is what makes re-running the effect on it exactly right
   *  rather than a poll on every keystroke elsewhere in the dialog. */
  const refresh = useCallback(async (): Promise<void> => {
    if (api === undefined) return;
    const next = await api.status();
    setStatus(next);
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Clears the ONE-TIME migration flag. Never sets it back to `true` -- there
   *  is no row left that could. */
  function dismissMigration(): void {
    if (prefs.conciseOutput) onChange(setConciseOutput(prefs, false));
  }

  async function runInstall(force: boolean): Promise<void> {
    if (api === undefined || busy) return;
    setBusy(true);
    setConfirming(false);
    try {
      const result = await api.install(force);
      setStatus(result.status);
      dismissMigration();
    } finally {
      setBusy(false);
    }
  }

  function onInstallClick(): void {
    if (status?.overall === 'outdated-modified') {
      setConfirming(true);
      return;
    }
    void runInstall(false);
  }

  async function onRemoveClick(): Promise<void> {
    if (api === undefined || busy) return;
    setBusy(true);
    try {
      const result = await api.remove();
      setStatus(result.status);
    } finally {
      setBusy(false);
    }
  }

  async function onRecheckClick(): Promise<void> {
    if (api === undefined || busy) return;
    setBusy(true);
    try {
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onCopyClick(): Promise<void> {
    const writeText = (
      globalThis.window as
        | { api?: { clipboard?: { writeText: (s: string) => Promise<boolean> } } }
        | undefined
    )?.api?.clipboard?.writeText;
    if (writeText === undefined) return;
    const ok = await writeText(adhdSkillInstallCommand());
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function onCreditClick(): void {
    const open = (
      globalThis.window as
        | { api?: { link?: { open: (url: string) => Promise<unknown> } } }
        | undefined
    )?.api?.link?.open;
    void open?.(ADHD_SKILL_SOURCE_URL);
  }

  const showMigration = prefs.conciseOutput === true;

  return (
    <Block
      name="adhd-skill"
      label={t('settings.behaviour.adhd.title')}
      hint={t('settings.behaviour.adhd.hint')}
      // ABSENT, NOT DIMMED, WHILE THE FIRST READ IS IN FLIGHT -- the same
      // rule `UpdatePanel.tsx` keeps for its own bridge-less state. There is
      // no fourth pill for "checking": the read is one IPC round trip to a
      // local disk, over before a blank pill could be noticed.
      action={
        api === undefined || status === null ? undefined : <StatusPill state={status.overall} />
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="m-0 max-w-[40ch] text-control text-ink-dim">
            {t('settings.behaviour.adhd.credit')}
          </p>
          {/* THE SAME SHAPE AS EVERY OTHER BUTTON ON THIS SURFACE, not Orca's
              inline underlined text -- `e2e/settings-chrome-shots.mjs`'s own
              button census pins THREE heights and ONE radius for the whole
              dialog, and a bare `underline` link measured 16px tall with no
              radius at all: a fourth shape nobody argued for. */}
          <button
            type="button"
            data-adhd-skill-credit
            data-verbatim
            onClick={onCreditClick}
            className={VERBATIM_BUTTON}
          >
            {t('settings.behaviour.adhd.creditLink')}
          </button>
        </div>

        {showMigration && (
          <div
            data-adhd-skill-migration
            className="flex flex-wrap items-center gap-2 rounded border border-line-loud bg-raised px-3 py-2"
          >
            <p className="m-0 max-w-[52ch] text-control text-ink-dim">
              {t('settings.behaviour.adhd.migration')}
            </p>
            {/* SAME SHAPE as the confirm buttons below: a `SmallButton`-style
                pill, not underlined text -- see the credit link's own note
                on why. */}
            <button
              type="button"
              data-adhd-skill-migration-dismiss
              onClick={dismissMigration}
              className={`vam-tap cursor-pointer rounded border border-line px-2 py-0.5 text-ink-dim text-control capitalize ${FOCUS_RING}`}
            >
              {t('settings.behaviour.adhd.migrationDismiss')}
            </button>
          </div>
        )}

        {api === undefined ? (
          <p data-adhd-skill-browser className="m-0 max-w-[52ch] text-control text-ink-dim">
            {t('settings.behaviour.adhd.browser')}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-adhd-skill-install
                disabled={busy || status === null}
                aria-busy={busy}
                onClick={onInstallClick}
                className={BUTTON}
              >
                <Terminal size={14} strokeWidth={1.8} aria-hidden="true" />
                {status?.overall === 'outdated-modified'
                  ? t('settings.behaviour.adhd.reinstall')
                  : t('settings.behaviour.adhd.install')}
              </button>
              <button
                type="button"
                data-adhd-skill-recheck
                disabled={busy}
                aria-busy={busy}
                onClick={() => {
                  void onRecheckClick();
                }}
                className={BUTTON}
              >
                <RefreshCw size={14} strokeWidth={1.8} aria-hidden="true" />
                {t('settings.behaviour.adhd.recheck')}
              </button>
              {status !== null && status.overall !== 'not-installed' && (
                <button
                  type="button"
                  data-adhd-skill-remove
                  disabled={busy}
                  aria-busy={busy}
                  onClick={() => {
                    void onRemoveClick();
                  }}
                  className={QUIET_BUTTON}
                >
                  <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
                  {t('settings.behaviour.adhd.remove')}
                </button>
              )}
            </div>

            {confirming && (
              <p
                data-adhd-skill-confirm
                className="m-0 flex max-w-[52ch] flex-wrap items-center gap-2 rounded border border-failed/40 bg-raised px-3 py-2 text-control text-ink-dim"
              >
                {t('settings.behaviour.adhd.confirm.question')}
                <button
                  type="button"
                  data-adhd-skill-confirm-yes
                  onClick={() => {
                    void runInstall(true);
                  }}
                  className={`vam-tap cursor-pointer rounded border border-line px-2 py-0.5 text-ink capitalize ${FOCUS_RING}`}
                >
                  {t('settings.behaviour.adhd.confirm.yes')}
                </button>
                <button
                  type="button"
                  data-adhd-skill-confirm-no
                  onClick={() => setConfirming(false)}
                  className={`vam-tap cursor-pointer rounded border border-line px-2 py-0.5 text-ink-dim capitalize ${FOCUS_RING}`}
                >
                  {t('settings.behaviour.adhd.confirm.no')}
                </button>
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <p className="m-0 text-control text-ink-faint">
                {t('settings.behaviour.adhd.copyHint')}
              </p>
              {/* SAME SHAPE, SAME REASON as the credit link above. */}
              <button
                type="button"
                data-adhd-skill-copy
                onClick={() => {
                  void onCopyClick();
                }}
                className={QUIET_BUTTON}
              >
                <Copy size={12} strokeWidth={1.8} aria-hidden="true" />
                {copied ? t('settings.behaviour.adhd.copied') : t('settings.behaviour.adhd.copy')}
              </button>
            </div>

            <div className="mt-1 border-line border-t pt-3">
              <h5 className="m-0 text-control text-ink-dim">
                {t('settings.behaviour.adhd.coverageTitle')}
              </h5>
              <p className="vam-sentence m-0 mt-0.5 text-control text-ink-faint">
                {t('settings.behaviour.adhd.coverageHint')}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {ADHD_SKILL_AGENTS.map((agent: AdhdSkillAgent) => {
                  const found = status?.agents.find((a) => a.agent === agent);
                  const state = found?.state ?? 'not-installed';
                  return (
                    <span
                      key={agent}
                      data-adhd-skill-agent={agent}
                      className="inline-flex items-center gap-1.5 rounded border border-line px-2 py-1 text-control text-ink-dim"
                    >
                      <Brain size={12} strokeWidth={1.8} aria-hidden="true" />
                      {/* THE AGENT'S OWN NAME, A PROPER NOUN -- `data-verbatim`,
                          not `capitalize`: "Codex" survives either way, but
                          the taxonomy this surface's own case ladder draws is
                          "somebody chose these letters," which is true of a
                          brand name and false of a status word, and the two
                          are split into separate spans for exactly that
                          reason. */}
                      <span data-verbatim>{ADHD_SKILL_AGENT_LABEL[agent]}</span>
                      <span
                        className={`capitalize ${state === 'not-installed' ? 'text-ink-faint' : 'text-ink'}`}
                      >
                        {agentChipText(state)}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </Block>
  );
}
