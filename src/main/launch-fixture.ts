/**
 * The launch smoke test's own fixture data, kept out of `index.ts`.
 *
 * `src/main/index.ts` runs `app.whenReady()` and registers `app.on(...)`
 * listeners at MODULE SCOPE, so importing that file outside a real Electron
 * process throws immediately (`app` does not exist there) -- which is why
 * `test/electron/launch.test.ts` proves this fixture only by launching the
 * real binary (`test/electron/probe.cjs`). This file holds nothing but data,
 * so `test/main/launch-fixture.test.ts` can assert its shape directly, fast,
 * without a real process.
 *
 * TYPE-ONLY IMPORT, the same discipline `sources/source.ts` already states:
 * nothing under `src/renderer/` may be a runtime import from main (AC-16a).
 */
import type { Project } from '../renderer/domain/model.js';

/**
 * One project, one session -- `src/main/index.ts`'s `LAUNCH_FIXTURE_SOURCE`
 * serves exactly this, selected by `VAM_FIXTURE_SOURCE=1` on the spawned
 * process. A clean CI runner has no Claude Code sessions on disk, so
 * `CLAUDE_CODE_SOURCE.load()` there legitimately answers `[]`, and AC-13's
 * proof that the launched shell actually reaches a real, INTERACTIVE model
 * needs at least one project to reach -- every field `test/electron/
 * launch.test.ts`'s shape assertion reads off `DEMO_MODEL`'s first session
 * (`waitingFor`, `vamControlled` included) is here too.
 *
 * `vamControlled: true`, NOT `false`. AC-13 needs the composer ON SCREEN --
 * that is the whole point of an interactive session to reach -- and `false`
 * is what `session-filter.ts`'s `isForeign` reads as "vam did not start
 * this". The shipped `hideForeign` default (on by default, Stage 1 of
 * `docs/design/vam-owns-the-session.md`) then hides the only row this
 * fixture draws, taking the composer with it. Caught for real by
 * `test/electron/launch.test.ts`'s "denies its own microphone" assertion
 * (`sendControls`), in a CI suite (`vitest run --config vitest.app.config.ts`,
 * excluded from the default `vitest run`) neither this branch's own gate nor
 * the agent who first shipped `hideForeign` had run.
 */
export const LAUNCH_FIXTURE_PROJECTS: readonly Project[] = [
  {
    id: 'launch-fixture',
    name: 'launch fixture',
    source: 'claude-code',
    sessions: [
      {
        id: 'launch-fixture-1',
        title: 'launch fixture session',
        epic: null,
        branch: null,
        status: 'waiting',
        runningAgents: 0,
        activity: null,
        age: null,
        decisions: [],
        agents: [],
        waitingFor: null,
        vamControlled: true,
      },
    ],
  },
  /**
   * A SECOND, SEPARATE PROJECT rather than a second session in the first: the
   * fixture above is deliberately exactly one project of exactly one session
   * (its own header, and `launch-fixture.test.ts`'s first assertion), so a
   * row added here has to arrive as a project of its own rather than disturb
   * that count.
   *
   * WHY IT EXISTS: AC-13's own asset-path defect
   * (`docs/design/vam-terminal-only.md`) -- `TerminalOnlyStart`
   * (`DetailPanel.tsx`) is the one screen in this app that draws an `<img>`,
   * and a root-absolute `src` reads as the filesystem root under this
   * window's real `file://` document (`index.ts`, `loadFile`), which no web
   * build or unit test can see. `test/electron/probe.cjs` clicks this row and
   * asserts every `<img>` on screen loaded -- the one check that is only true
   * against the REAL packaged app.
   */
  {
    id: 'launch-fixture-terminal',
    name: 'launch fixture (terminal-only)',
    source: 'claude-code',
    sessions: [
      {
        id: 'pane:launch-fixture-terminal-1',
        title: 'launch fixture terminal-only session',
        epic: null,
        branch: null,
        status: 'terminal',
        runningAgents: 0,
        activity: null,
        age: null,
        decisions: [],
        vamControlled: true,
        pane: 'launch-fixture-terminal-1',
        resumeCommand: 'claude --resume 00000000-0000-4000-8000-000000000000',
      },
    ],
  },
];
