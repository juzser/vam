/**
 * THE ONE `<img>` LEFT IN THIS APP, PROVEN UNDER THE REAL `file://` DOCUMENT.
 *
 * `test/electron/launch.test.ts` used to cover this through `TerminalOnlyStart`
 * -- the one screen with an `<img>` at the time, reached by clicking into a
 * row its own `LAUNCH_FIXTURE_PROJECTS` fixture always owns. "start-polish"
 * (2026-09-23) moved that screen's mark to the session's own AGENT
 * (`SourceMark`, an inline SVG through `IconFrame`), which the operator asked
 * for ("change the agent screen's icon to the agent's icon") and which has no
 * `<img>` to check any more. `GettingStarted.tsx`'s own screen -- vam's mark,
 * unchanged, also now wrapped in `IconFrame` and drawn larger -- is the one
 * place left that draws an `<img>` at all, and it draws only when vam owns no
 * session ANYWHERE, a state `LAUNCH_FIXTURE_PROJECTS` can never be in (it
 * exists so `launch.test.ts`'s own composer/AC-13 assertions have a session
 * to reach). So this is its own, separate, EMPTY launch --
 * `VAM_FIXTURE_SOURCE=2` (`src/main/index.ts`'s `EMPTY_FIXTURE_SOURCE`).
 *
 * A NARROW PROBE, NOT THE FULL SMOKE SUITE -- the same reason
 * `userdata-probe.cjs`/`userdata-isolation.test.ts` are their own pair
 * rather than one more branch inside `probe.cjs`/`launch.test.ts`: this
 * proves one thing, fast, and does not want the other's fixture shape.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = (name: string) => path.join(repoRoot, 'node_modules', '.bin', name);
const probePath = path.join('test', 'electron', 'getting-started-image-probe.cjs');

interface ImageResult {
  src: string | null;
  naturalWidth: number;
  naturalHeight: number;
  complete: boolean;
}

interface ProbeRun {
  code: number | null;
  stdout: string;
  stderr: string;
  images: ImageResult[] | null;
}

/** A genuinely free loopback port -- never the operator's own remote-serve
 *  port (58217), the same discipline every other electron probe in this
 *  directory follows. */
async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address !== null && typeof address === 'object' ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port === null) reject(new Error('no port assigned'));
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

function runProbe(userDataDir: string, remotePort: number): Promise<ProbeRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin('electron'), [probePath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        VAM_FIXTURE_SOURCE: '2',
        VAM_USER_DATA_DIR: userDataDir,
        VAM_REMOTE_PORT: String(remotePort),
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(
          `getting-started-image-probe did not exit within 30s\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    }, 30_000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = stdout
        .split('\n')
        .find((l) => l.startsWith('VAM_GETTING_STARTED_IMAGE_RESULT '));
      resolve({
        code,
        stdout,
        stderr,
        images:
          line === undefined
            ? null
            : (
                JSON.parse(line.slice('VAM_GETTING_STARTED_IMAGE_RESULT '.length)) as {
                  images: ImageResult[];
                }
              ).images,
      });
    });
  });
}

describe('the getting-started screen’s own mark, under the real file:// document', () => {
  let userDataDir: string;

  beforeAll(() => {
    execFileSync(bin('electron-vite'), ['build'], { cwd: repoRoot, stdio: 'pipe' });
    userDataDir = mkdtempSync(path.join(tmpdir(), 'vam-getting-started-image-userdata-'));
  }, 180_000);

  afterAll(() => {
    if (userDataDir !== undefined) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it('draws the mark, and it actually loaded', async () => {
    const remotePort = await freePort();
    const run = await runProbe(userDataDir, remotePort);
    expect(`${run.code} ${run.stderr}`).toBe(`0 ${run.stderr}`);
    expect(
      run.images,
      `no VAM_GETTING_STARTED_IMAGE_RESULT line.\nstderr:\n${run.stderr}`,
    ).not.toBeNull();
    const images = run.images as ImageResult[];
    // THE CORPUS IS ASSERTED FIRST -- a guard that finds zero images passes
    // vacuously and proves nothing.
    expect(images.length, 'no <img> was on screen').toBeGreaterThan(0);
    for (const image of images) {
      expect(
        image.naturalWidth,
        `${image.src ?? '(no src)'} did not load under file:// (naturalWidth 0)`,
      ).toBeGreaterThan(0);
    }
  });
});
