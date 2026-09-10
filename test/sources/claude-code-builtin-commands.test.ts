/**
 * Claude Code's BUILT-IN slash commands, asked of the installed CLI itself.
 *
 * WHY THERE IS A MODULE TO TEST AT ALL. `slash-commands.ts` used to say that
 * built-ins are never listed because "`claude --help` names no way to
 * enumerate them for the installed version, and a hand-maintained guess would
 * drift". Half of that is still true and half of it was a stopping point
 * rather than a fact: `--help` really does list only CLI SUBCOMMANDS (`agents`,
 * `attach`, `auth`, `doctor`, …), but the CLI answers the SDK's own
 * `initialize` control request with its command list, names and descriptions
 * together, and that answer comes from the installed binary rather than from
 * anybody's memory of it. See the module header for the measurements.
 *
 * The spawn itself is the one thing not tested here, for `deliver.ts`'s
 * reason: a test that ran it would start a real Claude Code process on the
 * machine running the suite. Argv, the request line, parsing and failure
 * classification are pure and are all tested.
 *
 * Nothing off this machine is reproduced in these fixtures -- the command
 * names below are invented, the same rule `claude-code-slash-commands.test.ts`
 * follows.
 */

import { describe, expect, it } from 'vitest';
import {
  builtinCommandsArgv,
  classifyInitializeFailure,
  createBuiltinCommandReader,
  INITIALIZE_REQUEST_ID,
  initializeRequestLine,
  MAX_BUILTIN_DESCRIPTION,
  parseBuiltinCommands,
} from '../../src/main/sources/claude-code/builtin-commands.js';

/** One `control_response` line in the exact shape the CLI answers with. */
const responseLine = (commands: readonly unknown[], subtype = 'success') =>
  `${JSON.stringify({
    type: 'control_response',
    response: { subtype, request_id: INITIALIZE_REQUEST_ID, response: { commands } },
  })}\n`;

describe('builtinCommandsArgv', () => {
  const argv = builtinCommandsArgv();

  it('asks in SAFE MODE, which is what keeps the question free of side effects', () => {
    // MEASURED, not assumed: without this flag the same question ran six of
    // this machine's own `SessionStart` hooks. A list is a question, and a
    // question must not run the operator's automation to be answered.
    expect(argv).toContain('--safe-mode');
  });

  it('sends NO PROMPT, so nothing is ever asked of a model', () => {
    // The list arrives in the handshake, before any turn exists. Every element
    // is a flag or a flag's value; a stray prompt element would be a model
    // call on every app start.
    expect(argv.filter((a) => !a.startsWith('-'))).toEqual(['stream-json', 'stream-json']);
  });

  it('keeps the session off disk and out of the operator’s MCP configuration', () => {
    expect(argv).toContain('--no-session-persistence');
    expect(argv).toContain('--strict-mcp-config');
  });
});

describe('initializeRequestLine', () => {
  it('is one newline-terminated JSON control request and nothing else', () => {
    const line = initializeRequestLine();
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({
      type: 'control_request',
      request_id: INITIALIZE_REQUEST_ID,
      request: { subtype: 'initialize' },
    });
  });
});

describe('parseBuiltinCommands', () => {
  it('reads the commands out of the response, named and described', () => {
    const out = parseBuiltinCommands(
      responseLine([
        { name: 'wombat', description: 'does wombat things', argumentHint: '<burrow>' },
        { name: 'otter', description: 'does otter things', argumentHint: '' },
      ]),
    );
    expect(out).toEqual({
      kind: 'ok',
      commands: [
        { id: 'builtin:otter', name: 'otter', description: 'does otter things' },
        { id: 'builtin:wombat', name: 'wombat', description: 'does wombat things' },
      ],
    });
  });

  it('prefixes ids so a built-in and a file of the same name are two rows', () => {
    const out = parseBuiltinCommands(responseLine([{ name: 'ship', description: 'x' }]));
    expect(out.kind === 'ok' && out.commands[0]?.id).toBe('builtin:ship');
  });

  it('answers a null description rather than an empty string', () => {
    // `null` is what the popover reads as "this one has no description"; an
    // empty string would draw an empty line under the name.
    const out = parseBuiltinCommands(responseLine([{ name: 'wombat', description: '' }]));
    expect(out.kind === 'ok' && out.commands[0]?.description).toBeNull();
  });

  it('clips a description that is really a paragraph', () => {
    // Some of the CLI's own descriptions run to over a thousand characters --
    // a skill's whole trigger list. Every session carries this list, so the
    // full text would be the biggest thing in `load()`'s payload by an order
    // of magnitude. See the module header for the measured sizes.
    const long = 'w'.repeat(MAX_BUILTIN_DESCRIPTION + 200);
    const out = parseBuiltinCommands(responseLine([{ name: 'wombat', description: long }]));
    const drawn = (out.kind === 'ok' && out.commands[0]?.description) || '';
    expect(drawn.length).toBeLessThanOrEqual(MAX_BUILTIN_DESCRIPTION + 1);
    expect(drawn.endsWith('…')).toBe(true);
  });

  it('drops an entry with no usable name instead of offering a blank row', () => {
    const out = parseBuiltinCommands(
      responseLine([
        { description: 'nameless' },
        { name: '', description: 'empty' },
        { name: 'ok' },
      ]),
    );
    expect(out.kind === 'ok' && out.commands.map((c) => c.name)).toEqual(['ok']);
  });

  it('ignores every other line in the stream, including hook chatter', () => {
    const noise = `${JSON.stringify({ type: 'system', subtype: 'hook_started' })}\nnot json at all\n`;
    const out = parseBuiltinCommands(noise + responseLine([{ name: 'wombat' }]));
    expect(out.kind === 'ok' && out.commands.map((c) => c.name)).toEqual(['wombat']);
  });

  /**
   * THE TWO UNKNOWNS, kept apart (`pull-requests.ts`). "The CLI has no
   * commands" is not a thing that happens; every shape below is vam failing to
   * ask, and each one says so in its own words rather than becoming a short
   * list nobody can tell from a real one.
   */
  it('is unavailable, never an empty list, when no response arrives', () => {
    const out = parseBuiltinCommands('');
    expect(out.kind).toBe('unavailable');
    expect(out.kind === 'unavailable' && out.code).toBe('no-response');
  });

  it('is unavailable when the CLI answered the control request with an error', () => {
    const out = parseBuiltinCommands(responseLine([], 'error'));
    expect(out.kind === 'unavailable' && out.code).toBe('refused');
  });

  it('is unavailable when the response carries no command list at all', () => {
    // An older CLI that answers the handshake without this field must not read
    // as "this version has no built-in commands".
    const line = `${JSON.stringify({
      type: 'control_response',
      response: { subtype: 'success', request_id: INITIALIZE_REQUEST_ID, response: {} },
    })}\n`;
    expect(parseBuiltinCommands(line).kind).toBe('unavailable');
  });

  it('is unavailable when the list is there but empty', () => {
    expect(parseBuiltinCommands(responseLine([])).kind).toBe('unavailable');
  });
});

describe('classifyInitializeFailure', () => {
  it('names a missing CLI rather than blaming the list', () => {
    const out = classifyInitializeFailure({ code: 'ENOENT' }, '');
    expect(out.code).toBe('cli-missing');
    expect(out.message).toContain('claude');
  });

  it('says so when the CLI was too slow, and says how long it was given', () => {
    const out = classifyInitializeFailure({ killed: true }, '');
    expect(out.code).toBe('timed-out');
    expect(out.message).toMatch(/\d+s/);
  });

  it('carries the CLI’s own words through when it said something', () => {
    const out = classifyInitializeFailure({ code: 1 }, 'not logged in\n');
    expect(out.code).toBe('cli-failed');
    expect(out.message).toContain('not logged in');
  });
});

/**
 * THE PROCESS-LIFETIME CACHE. `useSourceModel` polls every ten seconds and the
 * installed CLI does not change under a running app, so this question is asked
 * ONCE -- the same reason `PR_READER` exists as one object for the life of the
 * process rather than one per `load()`.
 */
describe('createBuiltinCommandReader', () => {
  const ok = { kind: 'ok', commands: [] } as const;

  it('asks once however many loads go past', async () => {
    let asked = 0;
    const read = createBuiltinCommandReader(async () => {
      asked += 1;
      return ok;
    });
    await Promise.all([read(), read(), read()]);
    await read();
    expect(asked).toBe(1);
  });

  it('does not remember a failure forever, but does not retry it per poll either', async () => {
    // A CLI installed while vam is running must eventually be seen; a broken
    // one must not cost a process every ten seconds.
    let asked = 0;
    let now = 0;
    const read = createBuiltinCommandReader(
      async () => {
        asked += 1;
        return { kind: 'unavailable', code: 'cli-missing', message: 'no claude' } as const;
      },
      () => now,
    );
    await read();
    await read();
    expect(asked).toBe(1);
    now = 10 * 60_000;
    await read();
    expect(asked).toBe(2);
  });
});
