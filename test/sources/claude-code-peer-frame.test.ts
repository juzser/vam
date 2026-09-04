/**
 * The peer inbox wire format, checked against the recorded fixture.
 *
 * No test here opens a socket or needs a live session: the fixture IS the
 * protocol as far as this suite is concerned, which is the only way to test a
 * format whose other end is somebody else's session.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildPeerMessageFrame,
  encodePeerFrame,
  parsePeerStatus,
} from '../../src/main/sources/claude-code/peer-frame.js';

type Fixture = {
  message: Record<string, unknown>;
  status: Record<string, Record<string, unknown>>;
  malformed: string;
};

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/peer-protocol.json', import.meta.url), 'utf8'),
) as Fixture;

const statusLine = (key: string): string => `${JSON.stringify(fixture.status[key])}\n`;

describe('buildPeerMessageFrame', () => {
  it('reproduces the recorded frame field for field', () => {
    const frame = buildPeerMessageFrame({
      msgId: '00000000-0000-4000-8000-000000000001',
      text: 'hello there',
      fromSocketPath: '/sock/sender.sock',
      fromName: 'sender-name',
      fromMode: 'prompting',
    });
    expect(frame).toEqual(fixture.message);
  });

  it('escapes a name that would otherwise break out of the wrapper', () => {
    const frame = buildPeerMessageFrame({
      msgId: 'id',
      text: 'body',
      fromSocketPath: '/sock/s.sock',
      fromName: 'a"b<c&d',
      fromMode: 'prompting',
    });
    expect(frame.message.content).toContain('from-name="a&quot;b&lt;c&amp;d"');
  });

  it('encodes as one newline-delimited JSON line', () => {
    const line = encodePeerFrame(fixture.message);
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1).includes('\n')).toBe(false);
    expect(JSON.parse(line)).toEqual(fixture.message);
  });
});

describe('parsePeerStatus', () => {
  it('reads a delivered status', () => {
    expect(parsePeerStatus(statusLine('delivered'))).toEqual({
      kind: 'delivered',
      msgId: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('reads a dropped status with its reason', () => {
    expect(parsePeerStatus(statusLine('dropped'))).toEqual({
      kind: 'dropped',
      msgId: '00000000-0000-4000-8000-000000000002',
      reason: 'inbox closed',
    });
  });

  it('reads a held status', () => {
    expect(parsePeerStatus(statusLine('held'))).toEqual({
      kind: 'held',
      msgId: '00000000-0000-4000-8000-000000000003',
    });
  });

  it('names the missing field rather than assuming a delivery', () => {
    expect(parsePeerStatus(statusLine('missingDropped'))).toEqual({
      kind: 'incomplete',
      missing: 'dropped',
    });
  });

  it('reports an unreadable line', () => {
    expect(parsePeerStatus(fixture.malformed)).toEqual({ kind: 'unreadable' });
  });

  it('reports a frame of the wrong type as unreadable', () => {
    expect(parsePeerStatus(encodePeerFrame(fixture.message))).toEqual({ kind: 'unreadable' });
  });

  it('gives the five outcomes five distinct kinds', () => {
    const kinds = [
      parsePeerStatus(statusLine('delivered')).kind,
      parsePeerStatus(statusLine('dropped')).kind,
      parsePeerStatus(statusLine('held')).kind,
      parsePeerStatus(statusLine('missingDropped')).kind,
      parsePeerStatus(fixture.malformed).kind,
    ];
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});
