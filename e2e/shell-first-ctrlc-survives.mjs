/**
 * THE OPERATOR'S REPORT: "In the new build, when I press Ctrl+C in the
 * terminal, the session still shuts down entirely." Against a REAL tmux, this
 * spawns through the REAL create and resume paths (`createSessionInDirectory`,
 * `resumeClaudeSession`, bundled from source, unmodified) and presses Ctrl-C
 * twice through the real send path (`typeThenEnter`'s own `send-keys`), the
 * same as a real `claude` needs (real `codex` needs only one -- a strict
 * subset -- see the fixture's own header) and asserts the tmux SESSION
 * SURVIVES with the SHELL in its pane's foreground.
 *
 * UNLIKE EVERY OTHER GUARD IN THIS DIRECTORY, this one drives no browser and
 * needs no served page: the bug and the fix are both entirely in MAIN, three
 * calls deep from any renderer, so there is nothing here for Chromium to add.
 * It is still folded into `run-web-guards.mjs`'s `GUARDS` list -- "every
 * asserting e2e script, run for real, in one command" -- and simply ignores
 * the `origin`/`outDir` argv every other guard there is called with.
 *
 * `claude` and `codex` cannot authenticate in CI, so both spawn paths run a
 * FIXTURE (`e2e/fixtures/ctrlc-exit-agent.cjs`) instead of the real CLI,
 * substituted for `shared/providers.ts`'s table at BUNDLE time (an esbuild
 * plugin rewrites the one relative import both `create-session.ts` and
 * `resume.ts` make) -- so the code under test is the real create/resume
 * logic, unmodified, and only the LAST-MILE "what word is `claude`" is
 * swapped.
 *
 * `codex/resume.ts` is not exercised here: `codexResumeCommand` hard-codes
 * the literal word `codex` rather than reading it from the provider table
 * (measured against its own source), so there is no seam here to substitute
 * a fixture into without either a real `codex` install or editing the file
 * under test. It shares the identical `typeThenEnter` primitive the two
 * phases below DO exercise live, and its own argv is pinned exactly by
 * `test/sources/codex-resume.test.ts`; this guard's job is the tmux-level
 * mechanism, which is identical code once `typeThenEnter` is reached.
 *
 * A THIRD PHASE FALSIFIES THE FIRST TWO: it spawns the identical fixture
 * DIRECTLY -- the shape both paths used to have -- and asserts the SAME
 * Ctrl-C sequence this time takes the whole tmux session with it. A guard
 * whose "survives" assertion could not also observe "does not survive" is not
 * proving anything about Ctrl+C; this phase is what proves it is.
 *
 *   node e2e/shell-first-ctrlc-survives.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SOCKET = 'vam-e2e-shellfirst';

const which = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
if (which.error || which.status !== 0) {
  console.warn(
    'SKIP  shell-first-ctrlc-survives.mjs: no `tmux` on PATH. This guard proves ' +
      'Ctrl+C no longer ends the whole session against a REAL tmux, because no stub ' +
      'can stand in for a real pane dying with the process it held. Install tmux on ' +
      'this runner for it to assert anything.',
  );
  process.exit(0);
}
console.log(`tmux: ${which.stdout.trim()} on private socket -L ${SOCKET}`);

const env = { ...process.env, LC_CTYPE: 'en_US.UTF-8' };
const tmux = (...args) => execFileSync('tmux', ['-L', SOCKET, ...args], { env, encoding: 'utf8' });
const killServer = () => spawnSync('tmux', ['-L', SOCKET, 'kill-server'], { env });
killServer();

const repos = [];
function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'vam-shellfirst-ctrlc-'));
  mkdirSync(join(dir, '.git'));
  repos.push(dir);
  return dir;
}

const FIXTURE = new URL('./fixtures/ctrlc-exit-agent.cjs', import.meta.url).pathname;

/* ── bundle the real create/resume logic, with a fixture provider table ─── */

const require = createRequire(new URL('../node_modules/.pnpm/node_modules/', import.meta.url));
const esbuild = require('esbuild');
const bundleDir = mkdtempSync(join(tmpdir(), 'vam-shellfirst-ctrlc-bundle-'));

/** Rewrites the ONE relative import both `create-session.ts` and
 *  `resume.ts` make of `shared/providers.ts` to a two-row table whose
 *  commands are both the fixture -- everything else in either file is
 *  unmodified, bundled straight from source. */
const fixtureProvidersPlugin = {
  name: 'vam-fixture-providers',
  setup(build) {
    build.onResolve({ filter: /shared\/providers\.js$/ }, () => ({
      path: 'vam-fixture-providers',
      namespace: 'vam-fixture',
    }));
    build.onLoad({ filter: /.*/, namespace: 'vam-fixture' }, () => ({
      loader: 'js',
      contents: `
        export const DEFAULT_PROVIDER_ID = 'claude-code';
        export const PROVIDERS = [
          { id: 'claude-code', label: 'Claude Code', command: ['node', ${JSON.stringify(FIXTURE)}] },
          { id: 'codex', label: 'Codex', command: ['node', ${JSON.stringify(FIXTURE)}] },
        ];
        export const CAN_CHOOSE_PROVIDER = true;
        export function resolveProvider(id) {
          return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
        }
        export function readProviderId(id) { return resolveProvider(id).id; }
      `,
    }));
  },
};

const bundleOf = async (entry) => {
  const outfile = join(bundleDir, `${entry.replace(/[/.]/g, '_')}.mjs`);
  await esbuild.build({
    entryPoints: [new URL(`../${entry}`, import.meta.url).pathname],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent',
    plugins: [fixtureProvidersPlugin],
  });
  return import(pathToFileURL(outfile).href);
};

const { createSessionInDirectory } = await bundleOf(
  'src/main/sources/claude-code/create-session.ts',
);
const { resumeClaudeSession } = await bundleOf('src/main/sources/claude-code/resume.ts');
const { createTmuxRunner } = await bundleOf('src/main/sources/tmux/spawn.ts');
const { loginShellCommand } = await bundleOf('src/main/sources/tmux/shell.ts');

const realRunner = createTmuxRunner('tmux');
/** The app's own runner, aimed at the private socket. Same argv otherwise. */
const run = (argv) => realRunner(['-L', SOCKET, ...argv]);

const SHELL_COMM = loginShellCommand()[0].split('/').pop();

/* ── small helpers ────────────────────────────────────────────────────── */

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` -- ${detail}`}`);
  failures.push(label);
}

async function waitFor(label, predicate, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() > until) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

const listedSessions = () => {
  const out = spawnSync(
    'tmux',
    ['-L', SOCKET, 'list-sessions', '-F', '#{session_name}\t#{pane_current_command}'],
    { env, encoding: 'utf8' },
  );
  if (out.status !== 0) return new Map(); // no server, or nothing running
  const map = new Map();
  for (const line of out.stdout.split('\n')) {
    if (line === '') continue;
    const [name, command] = line.split('\t');
    map.set(name, command);
  }
  return map;
};

const paneText = (name) => {
  const out = spawnSync('tmux', ['-L', SOCKET, 'capture-pane', '-p', '-t', `=${name}:`], {
    env,
    encoding: 'utf8',
  });
  return out.status === 0 ? out.stdout : '';
};

/** Presses Ctrl-C twice with the gap this repo measured actually double-fires
 *  it against real `claude` (a slower gap left it armed-but-unfired, real
 *  `claude` 2.1.280, private `-L` socket -- `create-session.ts`'s header). */
async function pressCtrlCTwice(name) {
  await run(['send-keys', '-t', `=${name}:`, 'C-c']);
  await new Promise((r) => setTimeout(r, 250));
  await run(['send-keys', '-t', `=${name}:`, 'C-c']);
}

/* ── phase 1: the "new project" path, through createSessionInDirectory ──── */

async function phaseNewProject() {
  console.log('\n=== phase: createSessionInDirectory (new project)');
  const cwd = tempRepo();
  const name = 'vam-e2e-shellfirst-newproj';
  const failure = await createSessionInDirectory({
    cwd,
    title: 'shellfirst-ctrlc',
    run,
    name,
    provider: 'claude-code',
  });
  check('createSessionInDirectory started', failure === null, JSON.stringify(failure));

  await waitFor('the fixture’s READY line', () => paneText(name).includes('CTRLC-FIXTURE READY'));
  await pressCtrlCTwice(name);
  await new Promise((r) => setTimeout(r, 800));

  const sessions = listedSessions();
  check('the tmux SESSION survives Ctrl-C twice', sessions.has(name), [...sessions.keys()].join(', '));
  check(
    'the pane’s foreground falls back to the shell, not gone with the agent',
    sessions.get(name) === SHELL_COMM,
    `pane_current_command was ${JSON.stringify(sessions.get(name))}, expected ${SHELL_COMM}`,
  );
}

/* ── phase 2: reopening a session, through resumeClaudeSession ──────────── */

async function phaseResume() {
  console.log('\n=== phase: resumeClaudeSession (reopen)');
  const cwd = tempRepo();
  const name = 'vam-e2e-shellfirst-resume';
  const sessionId = '00000000-1111-2222-3333-444444444444';
  const row = {
    key: `${sessionId}#1`,
    sessionId,
    name: null,
    cwd,
    status: 'done',
    kind: 'interactive',
    pid: 1,
    startedAt: null,
  };
  const failure = await resumeClaudeSession({
    rowId: row.key,
    agents: async () => ({ kind: 'ok', agents: [row] }),
    exists: () => true,
    run,
    name,
  });
  check('resumeClaudeSession started', failure === null, JSON.stringify(failure));

  await waitFor('the fixture’s READY line', () => paneText(name).includes('CTRLC-FIXTURE READY'));
  await pressCtrlCTwice(name);
  await new Promise((r) => setTimeout(r, 800));

  const sessions = listedSessions();
  check('the tmux SESSION survives Ctrl-C twice', sessions.has(name), [...sessions.keys()].join(', '));
  check(
    'the pane’s foreground falls back to the shell, not gone with the agent',
    sessions.get(name) === SHELL_COMM,
    `pane_current_command was ${JSON.stringify(sessions.get(name))}, expected ${SHELL_COMM}`,
  );
}

/* ── phase 3: FALSIFICATION -- the shape both paths used to have ────────── */

async function phaseFalsify() {
  console.log('\n=== phase: falsification -- the fixture spawned DIRECTLY, no shell underneath');
  const cwd = tempRepo();
  const name = 'vam-e2e-shellfirst-direct';
  const result = await run(['new-session', '-d', '-s', name, '-c', cwd, 'node', FIXTURE]);
  check('the direct spawn itself started', result.failure === null, JSON.stringify(result.failure));

  await waitFor('the fixture’s READY line', () => paneText(name).includes('CTRLC-FIXTURE READY'));
  await pressCtrlCTwice(name);
  await new Promise((r) => setTimeout(r, 800));

  const sessions = listedSessions();
  check(
    'the tmux session is GONE -- the exact bug the operator reported',
    !sessions.has(name),
    sessions.has(name) ? 'the session is still there; this phase proves nothing' : undefined,
  );
}

try {
  await phaseNewProject();
  killServer();
  await phaseResume();
  killServer();
  await phaseFalsify();
} finally {
  killServer();
  for (const dir of repos) rmSync(dir, { recursive: true, force: true });
  rmSync(bundleDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\nFAILED (${failures.length}): ${failures.join('; ')}`);
  process.exit(1);
}
console.log('\nOK  shell-first-ctrlc-survives.mjs');
