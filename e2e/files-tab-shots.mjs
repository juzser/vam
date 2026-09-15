/**
 * THE FILES TAB'S OWN PICTURE, for `README.md`.
 *
 * WHY THIS IS NOT IN `readme-shots.mjs`, AND WHY IT BREAKS THAT FILE'S RULE
 * ON PURPOSE. That script takes every other README screenshot and takes them
 * all through `?demo=1`, and its header states the rule plainly: live mode
 * "would put a real workspace, with real paths and real session ids, into a
 * public repo". It then DECLINED to picture the Terminal tab rather than
 * reach for a stub source, on the grounds that "a stubbed non-demo source is
 * the same shell, still worth keeping off the one path every other screenshot
 * here is pinned to", and left that tab documented in prose instead.
 *
 * The Files tab lands in exactly that hole. `Canvas.tsx`'s `filesTab` is
 * `window.api?.files !== undefined`, and `?demo=1` has no `window.api` at
 * all, so demo mode cannot draw this tab any more than it can draw Terminal
 * -- there is no button to click.
 *
 * THE DIFFERENCE, AND IT IS THE REASON RATHER THAN AN EXCEPTION: the rule's
 * stated purpose is that no real path, session id or transcript reaches a
 * public repo. A SYNTHETIC stub satisfies that purpose completely -- every
 * string below is invented, the root is `/work/atlas`, and nothing is read
 * off the machine that runs it. What `?demo=1` additionally buys is
 * CONSISTENCY, one path for every picture, and that is worth keeping where it
 * can be kept. So this file does not widen the rule to "stubs are fine"; it
 * takes the one tab demo mode structurally cannot reach, and pays for the
 * exception with the same guarantee the rule exists to give:
 *
 *   ANY STUB USED FOR A SHIPPED PICTURE CARRIES NO REAL PATH, ID, HOSTNAME OR
 *   TRANSCRIPT. If that ever stops being true here, this file is wrong and
 *   the picture should go back to prose, the way Terminal's did.
 *
 * AND WHY IT IS NOT `files-tab-keyboard-shots.mjs`, which already stubs this
 * tab: that fixture is a GUARD's fixture -- deliberately minimal, naming
 * things "stub session" because no claim depends on the name. Twice now the
 * shipped README picture has been taken with it, and twice it read "STUB
 * PROJECT 1" over a transcript about vam's own corner reservations. A guard
 * fixture and a product picture want opposite things from the same stub.
 *
 * This asserts nothing. `files-tab-keyboard-shots.mjs` owns every claim about
 * this tab; this only has to look like the product.
 *
 *   node e2e/files-tab-shots.mjs http://localhost:5520 docs/images
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/images';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

await page.addInitScript(() => {
  const ENV = [
    '# service',
    'PORT=8787',
    'LOG_LEVEL=debug',
    '',
    '# database',
    'DATABASE_URL=postgres://localhost:5432/atlas',
    'DATABASE_POOL=10',
    '',
    '# feature flags',
    'FLAG_NEW_SCHEDULER=true',
    'FLAG_STRICT_PARSING=false',
  ].join('\n');
  const files = new Map([
    ['/work/atlas/.env', ENV],
    ['/work/atlas/.env.example', '# copy to .env\nPORT=\nDATABASE_URL=\n'],
    ['/work/atlas/package.json', '{\n  "name": "atlas"\n}\n'],
    ['/work/atlas/README.md', '# atlas\n'],
    ['/work/atlas/src/server.ts', 'export const server = 1;\n'],
    ['/work/atlas/src/db/pool.ts', 'export const pool = 1;\n'],
    ['/work/atlas/src/db/migrate.ts', 'export const migrate = 1;\n'],
    ['/work/atlas/src/routes/health.ts', 'export const health = 1;\n'],
  ]);
  const sig = (p) => ({ size: files.get(p).length, mtimeMs: 1, sha256: 'a'.repeat(64) });
  const unavailable = () => ({
    kind: 'unavailable',
    error: { kind: 'unreachable', code: 'stub', message: 'not in this picture' },
  });
  globalThis.window.api = {
    describe: async () => ({
      id: 'claude-code',
      label: 'Claude Code',
      capabilities: {
        liveUpdates: true, recordPrompt: true, deliverPrompt: false, promptAttachments: true,
        slashCommands: false, renameSession: true, closeSession: true, createSession: true,
        governance: false, pullRequests: true, terminal: true, agentRoster: true,
      },
      declines: {},
      viewerScope: 'operator',
    }),
    load: async () => [
      {
        id: 'p1',
        name: 'atlas',
        sessions: [
          {
            id: 's1', title: 'connection pool', icon: null, epic: null, branch: 'fix/pool-limit',
            status: 'waiting', runningAgents: 0, activity: null, age: '14m',
            decisions: [
              {
                id: 'd1', label: 'step 1',
                input: 'The pool is exhausting under load — raise the limit and make it configurable.',
                output: 'Raised the ceiling and moved it behind DATABASE_POOL.',
                commands: [],
              },
            ],
          },
        ],
      },
    ],
    subscribe: () => () => {},
    recordPrompt: async () => {}, renameSession: async () => {}, closeSession: async () => {},
    createSession: async () => {}, createSessionIn: async () => {}, pickImageAttachment: async () => null,
    history: async () => unavailable(), agentWork: async () => unavailable(),
    applyWaivers: async () => {}, transitionLesson: async () => {},
    usage: { get: async () => ({ kind: 'unavailable' }) },
    files: {
      list: async () => ({ root: '/work/atlas', files: [...files.keys()], truncated: false }),
      read: async (path) =>
        files.has(path)
          ? { content: files.get(path), isBinary: false, signature: sig(path) }
          : Promise.reject({ kind: 'refused', code: 'not-found', message: `${path} does not exist` }),
      write: async (path) => sig(path),
    },
  };
});

await page.goto(origin, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
await page.locator('[data-session-row]').first().click();
await page.waitForSelector('[data-view="files"]');
await page.locator('[data-view="files"]').click();
await page.waitForSelector('[data-files-row-path]');
await page.locator('[data-files-row-path="/work/atlas/.env"]').click();
await page.waitForSelector('[data-files-editor]');
await page.waitForTimeout(400);

const out = `${outDir}/files-tab.png`;
await page.screenshot({ path: out });
console.log(out);
await browser.close();
