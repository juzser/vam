/**
 * The four asserting e2e scripts, run for real, in one command.
 *
 *   node e2e/run-web-guards.mjs
 *
 * Until now these scripts ran only when a human remembered them: 59 throwing
 * assertions covering exactly what jsdom cannot see (project-switch
 * reconciliation, per-project layout restore, the per-pane `+`, drag-to-move,
 * which pane is focused AT THE MOMENT OF AN EVENT, `position: sticky` against
 * real layout, which element is on top at a pixel, which of a column's many
 * sticky prompts is PINNED at a given scroll offset and what a percentage
 * max-height actually resolves to, and -- since the tooltip
 * audit -- what a tooltip FLATTENS TO for a screen reader, whether Tab
 * reaches the element a `Note` hangs on, the computed contrast of the tip's
 * boundary against the surface it floats over in both themes, and -- since the
 * pane took its own colour token -- what a surface ACTUALLY PAINTS and whether
 * a swatch in the settings form reaches it). This driver builds the web bundle, serves it with
 * `vite preview`, points each script at it and fails with a non-zero exit as
 * soon as any assertion throws — so CI can hold them.
 *
 * The other `e2e/*.mjs` scripts (issue-188-shots, pane-refinements-shots,
 * pane-patches-shots, phone-list-shots, phone-prompt-shots) are NOT run
 * here and must not be added: they take screenshots and assert nothing, so
 * running them would only turn a green tick into a broader claim than it is.
 *
 * Environment:
 *   VAM_E2E_PORT       preview port (default 5520)
 *   VAM_E2E_OUT        screenshot directory (default e2e/test-results/web-guards,
 *                      gitignored — never docs/ui, CI must not produce a repo diff)
 *   VAM_E2E_SKIP_BUILD serve whatever is already in dist-web. This is how the
 *                      guard itself gets falsified: mutate the built bundle,
 *                      re-run, watch it go red.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const GUARDS = [
  'split-panes-shots',
  'prompt-suggest-shots',
  'transcript-flow-shots',
  'transcript-column-shots',
  'prompt-mode-icon-shots',
  'long-prompt-shots',
  'narrow-pane-overlay-shots',
  'tab-strip-shots',
  'turn-signal-shots',
  'tooltip-shots',
  'pane-colour-shots',
  'key-truth-shots',
];

const port = Number(process.env.VAM_E2E_PORT ?? 5520);
const origin = `http://localhost:${port}`;
const outDir = process.env.VAM_E2E_OUT ?? 'e2e/test-results/web-guards';

/** Run a command with its output going straight to ours — an assertion that
 *  throws must arrive in the log with its own message, never summarised. */
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function waitForServer(deadlineMs) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(origin);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${origin} did not answer within ${deadlineMs}ms.`);
}

mkdirSync(outDir, { recursive: true });

if (!process.env.VAM_E2E_SKIP_BUILD) {
  const built = await run('node_modules/.bin/vite', ['build', '--config', 'vite.web.config.ts']);
  if (built !== 0) process.exit(built);
}

const preview = spawn(
  'node_modules/.bin/vite',
  ['preview', '--config', 'vite.web.config.ts', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
const failed = [];
try {
  await waitForServer(60_000);
  // Sequential, not parallel: four Chromiums on one CI runner is how a guard
  // starts flaking, and a flaky guard is the one the next person disables.
  for (const guard of GUARDS) {
    console.log(`\n=== e2e/${guard}.mjs`);
    const code = await run('node', [`e2e/${guard}.mjs`, origin, outDir]);
    if (code !== 0) failed.push(guard);
  }
} finally {
  preview.kill('SIGTERM');
}

if (failed.length > 0) {
  console.error(`\nFAILED: ${failed.map((g) => `e2e/${g}.mjs`).join(', ')}`);
  process.exit(1);
}
console.log(`\nAll ${GUARDS.length} web guards passed. Screenshots in ${outDir}.`);
