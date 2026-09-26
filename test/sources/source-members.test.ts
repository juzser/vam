/**
 * Which source a row came from, and therefore what may be drawn on it.
 *
 * The rule with a trap in it is the FALLBACK: `members` is absent whenever
 * main serves one source, which is every build vam shipped before Codex, so a
 * reader that treated absence as "no capabilities" would withdraw every
 * affordance from every row on all of them.
 *
 * Every id and label here is invented.
 */

import { describe, expect, it } from 'vitest';
import { capabilitiesFor, memberFor } from '../../src/renderer/sources/members.js';
import type { SessionSource, SourceCapabilities } from '../../src/renderer/sources/port.js';

const caps = (over: Partial<SourceCapabilities> = {}): SourceCapabilities => ({
  liveUpdates: false,
  recordPrompt: false,
  deliverPrompt: false,
  promptAttachments: false,
  slashCommands: false,
  renameSession: false,
  closeSession: false,
  createSession: false,
  governance: false,
  pullRequests: false,
  terminal: false,
  agentRoster: false,
  resumeSession: false,
  ...over,
});

const alone: SessionSource = {
  id: 'claude-code',
  label: 'Claude Code',
  capabilities: caps({ terminal: true, deliverPrompt: true }),
  declines: {},
  viewerScope: { kind: 'connection', note: 'invented' },
  load: async () => [],
};

const both: SessionSource = {
  ...alone,
  id: 'claude-code+codex',
  label: 'Claude Code + Codex',
  // The OR, as `combineSources` builds it.
  capabilities: caps({ terminal: true, deliverPrompt: true }),
  declines: {},
  members: [
    {
      id: 'claude-code',
      label: 'Claude Code',
      capabilities: caps({ terminal: true, deliverPrompt: true }),
      declines: {},
    },
    {
      id: 'codex',
      label: 'Codex',
      capabilities: caps({ terminal: false, deliverPrompt: true }),
      declines: { terminal: 'vam did not start this session and has no pane into it' },
    },
  ],
};

describe('capabilitiesFor', () => {
  it('reads the top level when main serves ONE source', () => {
    // The case every vam before this one was: absence means "this source IS
    // the member", never "this source can do nothing".
    expect(capabilitiesFor(alone, 'claude-code').capabilities.terminal).toBe(true);
  });

  it('reads the top level for a row that names no source at all', () => {
    // A fixture, a demo, a hand-built `Session` -- the rows this app is
    // tested with.
    expect(capabilitiesFor(both, undefined).capabilities.terminal).toBe(true);
  });

  it('reads the top level for a row naming a source main does not serve', () => {
    expect(capabilitiesFor(both, 'a-source-nobody-serves').capabilities.terminal).toBe(true);
  });

  it('answers per row once two sources disagree', () => {
    expect(capabilitiesFor(both, 'claude-code').capabilities.terminal).toBe(true);
    expect(capabilitiesFor(both, 'codex').capabilities.terminal).toBe(false);
    // Both deliver -- the pair that makes Codex the source that separated
    // "vam started it" from "vam can reach it".
    expect(capabilitiesFor(both, 'codex').capabilities.deliverPrompt).toBe(true);
  });

  it('hands back the declining source’s OWN words, not the combination’s', () => {
    expect(capabilitiesFor(both, 'codex').declines.terminal).toContain('did not start');
    expect(capabilitiesFor(both, 'claude-code').declines.terminal).toBeUndefined();
  });
});

describe('memberFor', () => {
  it('answers null for the fallback cases, so a caller can tell them apart', () => {
    expect(memberFor(alone, 'claude-code')).toBeNull();
    expect(memberFor(both, undefined)).toBeNull();
    expect(memberFor(both, 'codex')?.label).toBe('Codex');
  });
});
