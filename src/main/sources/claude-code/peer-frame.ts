/**
 * The cross-session inbox wire format: build a message frame, read a status.
 *
 * WHERE THIS CAME FROM. Not from reading Claude Code's bundle, and not from
 * guessing. A recorder stood up a unix socket, advertised ITSELF as a local
 * session, and a throwaway session (Claude Code 2.1.260) started for the
 * purpose sent it a message. The `buildPeerMessageFrame` half reproduces the
 * bytes that arrived, field for field; `test/fixtures/peer-protocol.json`
 * carries that shape with invented values.
 *
 * WHAT WAS *NOT* OBSERVED, and it matters before anyone trusts the second
 * half: the status frame. The recipient in that capture never gets to speak.
 * Measured, four times: when the recorder wrote ANYTHING back on the inbound
 * connection -- a plausible status frame, `{}`, even a bare newline -- the
 * sender reported `Failed to send`; when it wrote nothing, the same send
 * reported success. So a receiver must stay silent on the connection it is
 * handed, and `PeerStatus` below follows the field names the task brief
 * states (`dropped`, `drop_reason`, `wereHeld`), NOT anything seen on a
 * wire. Treat it as provisional until a real status is captured; the parser is
 * deliberately strict, so an unrecognised frame reads as `unreadable`
 * rather than as a delivery.
 *
 * Nothing here opens a socket. Building bytes and reading bytes is all this
 * module does, which is what makes it testable without a live session.
 */

/** A frame as it arrives on the inbox socket, one per NDJSON line. */
export type PeerMessageFrame = {
  readonly msgV: 1;
  readonly msg_id: string;
  readonly type: 'user';
  readonly message: { readonly role: 'user'; readonly content: string };
  readonly priority: 'next';
  readonly from: string;
};

/** What the sending session was doing when it sent -- observed: `prompting`. */
export type PeerFromMode = 'prompting' | 'idle';

/**
 * Attribute values sit inside a `<cross-session-message ...>` tag in the
 * message body, so a quote or an angle bracket in a session name would close
 * the tag early and hand the reading model a body of our making.
 */
function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * The frame for `text`, addressed FROM this session's own inbox socket.
 *
 * `msgId` is taken rather than generated so the caller can correlate a status
 * with the send, and so this stays a pure function.
 */
export function buildPeerMessageFrame(input: {
  msgId: string;
  text: string;
  fromSocketPath: string;
  fromName: string;
  fromMode: PeerFromMode;
}): PeerMessageFrame {
  const { msgId, text, fromSocketPath, fromName, fromMode } = input;
  const from = `uds:${fromSocketPath}`;
  const open = `<cross-session-message from="${escapeAttribute(from)}" from-name="${escapeAttribute(fromName)}" from-mode="${fromMode}">`;
  return {
    msgV: 1,
    msg_id: msgId,
    type: 'user',
    message: { role: 'user', content: `${open}\n${text}\n</cross-session-message>` },
    priority: 'next',
    from,
  };
}

/** One NDJSON line, trailing newline included: the transport's whole framing. */
export function encodePeerFrame(frame: unknown): string {
  return `${JSON.stringify(frame)}\n`;
}

/**
 * The outcome of a send, as the peer reports it. Five kinds, all distinct: a
 * caller that cannot tell "dropped" from "held" from "we could not read the
 * answer" would show the operator a delivery that never happened.
 */
export type PeerStatus =
  | { readonly kind: 'delivered'; readonly msgId: string }
  | { readonly kind: 'dropped'; readonly msgId: string; readonly reason: string | null }
  | { readonly kind: 'held'; readonly msgId: string }
  | { readonly kind: 'incomplete'; readonly missing: string }
  | { readonly kind: 'unreadable' };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Parse one NDJSON status line. Never throws: a bad line is an outcome. */
export function parsePeerStatus(line: string): PeerStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: 'unreadable' };
  }
  const frame = asRecord(parsed);
  if (frame === null || frame.type !== 'peer_message_status') return { kind: 'unreadable' };
  if (typeof frame.msg_id !== 'string') return { kind: 'incomplete', missing: 'msg_id' };
  const msgId = frame.msg_id;
  if (typeof frame.dropped !== 'boolean') return { kind: 'incomplete', missing: 'dropped' };
  if (frame.dropped) {
    const reason = typeof frame.drop_reason === 'string' ? frame.drop_reason : null;
    return { kind: 'dropped', msgId, reason };
  }
  if (typeof frame.wereHeld !== 'boolean') return { kind: 'incomplete', missing: 'wereHeld' };
  return frame.wereHeld ? { kind: 'held', msgId } : { kind: 'delivered', msgId };
}
