import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openChangeStream } from '../../src/adapter/stream.js';

/**
 * A minimal stand-in for the browser's EventSource: just enough surface for
 * openChangeStream to register listeners on and for the test to dispatch
 * named events through, with no real socket anywhere.
 */
function fakeEventSource() {
  const listeners = new Map<string, Array<(event: { data?: string }) => void>>();
  const closeSpy = vi.fn();
  const fake = {
    readyState: 1,
    addEventListener(type: string, handler: (event: { data?: string }) => void) {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    close() {
      closeSpy();
      listeners.clear();
    },
    emit(type: string, data?: string) {
      for (const handler of listeners.get(type) ?? []) {
        handler({ data });
      }
    },
  };
  return { fake, closeSpy };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('openChangeStream', () => {
  it('exists and exports the fixed shape', () => {
    expect(typeof openChangeStream).toBe('function');
  });

  it('builds exactly one EventSource, at the relative default URL', () => {
    const { fake } = fakeEventSource();
    const createEventSource = vi.fn(() => fake as unknown as EventSource);
    openChangeStream({ createEventSource, onChange: vi.fn() });
    expect(createEventSource).toHaveBeenCalledTimes(1);
    expect(createEventSource).toHaveBeenCalledWith('/api/stream');
  });

  it('delivers a well-formed change frame to onChange, parsed, exactly once', () => {
    const { fake } = fakeEventSource();
    const onChange = vi.fn();
    openChangeStream({ createEventSource: () => fake as unknown as EventSource, onChange });
    fake.emit('change', '{"sessions":["s1"],"at":"2026-08-01T00:00:00Z"}');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ sessions: ['s1'], at: '2026-08-01T00:00:00Z' });
  });

  it('drops malformed frames silently and does not reach onChange', () => {
    const { fake } = fakeEventSource();
    const onChange = vi.fn();
    openChangeStream({ createEventSource: () => fake as unknown as EventSource, onChange });
    expect(() => {
      fake.emit('change', 'not-json');
      fake.emit('change', '{"sessions":"s1"}');
      fake.emit('change', '{"sessions":["s1"],"at":"2026-08-01T00:00:00Z"}');
    }).not.toThrow();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('delivers a well-formed hello frame to onHello, parsed', () => {
    const { fake } = fakeEventSource();
    const onHello = vi.fn();
    openChangeStream({
      createEventSource: () => fake as unknown as EventSource,
      onHello,
      onChange: vi.fn(),
    });
    fake.emit('hello', '{"heartbeatMs":15000,"floorMs":10000}');
    expect(onHello).toHaveBeenCalledTimes(1);
    expect(onHello).toHaveBeenCalledWith({ heartbeatMs: 15000, floorMs: 10000 });
  });

  it('tolerates a missing onHello without throwing or touching onChange', () => {
    const { fake } = fakeEventSource();
    const onChange = vi.fn();
    openChangeStream({ createEventSource: () => fake as unknown as EventSource, onChange });
    expect(() => {
      fake.emit('hello', '{"heartbeatMs":15000,"floorMs":10000}');
    }).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('holds no timer or clock: 120s of silence after hello moves nothing', () => {
    const { fake, closeSpy } = fakeEventSource();
    const onChange = vi.fn();
    const createEventSource = vi.fn(() => fake as unknown as EventSource);
    openChangeStream({ createEventSource, onHello: vi.fn(), onChange });
    fake.emit('hello', '{"heartbeatMs":15000,"floorMs":10000}');
    vi.advanceTimersByTime(120000);
    expect(onChange).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
    expect(createEventSource).toHaveBeenCalledTimes(1);
  });

  it('closes exactly once and stops delivery after close', () => {
    const { fake, closeSpy } = fakeEventSource();
    const onChange = vi.fn();
    const stream = openChangeStream({
      createEventSource: () => fake as unknown as EventSource,
      onChange,
    });
    stream.close();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    fake.emit('change', '{"sessions":["s1"],"at":"2026-08-01T00:00:00Z"}');
    expect(onChange).not.toHaveBeenCalled();
    stream.close();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('does not treat an error event as fatal: no close, no reconnect', () => {
    const { fake, closeSpy } = fakeEventSource();
    fake.readyState = 0;
    const onChange = vi.fn();
    const createEventSource = vi.fn(() => fake as unknown as EventSource);
    openChangeStream({ createEventSource, onChange });
    expect(() => fake.emit('error')).not.toThrow();
    expect(closeSpy).not.toHaveBeenCalled();
    expect(createEventSource).toHaveBeenCalledTimes(1);
  });
});
