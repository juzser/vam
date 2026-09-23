// @vitest-environment happy-dom
/**
 * The extracted FILE-BUFFER hook, asserted through its own return value --
 * not through `FilesTab`'s DOM. Three cases carry the load-bearing rules
 * `FilesTab.tsx`'s own header names: a clean save clears the dirty mark, a
 * `changed-on-disk` refusal becomes the conflict outcome rather than an
 * overwrite, and a reload discards whatever the operator typed.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FileSignature } from '../../src/main/files/types.js';
import { useFileBuffers } from '../../src/renderer/panels/files-buffers.js';
import type { SourceError } from '../../src/renderer/sources/port.js';

const signature = (size: number): FileSignature => ({
  size,
  mtimeMs: 1,
  sha256: `hash-${size}`,
});

describe('useFileBuffers', () => {
  it('opens a file, edits it, and clears the dirty mark once the save resolves', async () => {
    const read = vi.fn().mockResolvedValue({
      isBinary: false,
      content: 'before',
      signature: signature(6),
    });
    const write = vi.fn().mockResolvedValue({ signature: signature(9) });
    const { result } = renderHook(() =>
      useFileBuffers({ sessionId: 'session-1', root: null, read, write }),
    );

    act(() => result.current.openFile('/w/atlas/.env'));
    await waitFor(() => expect(result.current.buffers['/w/atlas/.env']?.kind).toBe('editable'));

    act(() => result.current.setContent('/w/atlas/.env', 'after'));
    const dirtyBuffer = result.current.buffers['/w/atlas/.env'];
    expect(dirtyBuffer).toMatchObject({ kind: 'editable', content: 'after' });

    await act(async () => {
      await result.current.saveFile('/w/atlas/.env');
    });

    const savedBuffer = result.current.buffers['/w/atlas/.env'];
    expect(savedBuffer).toMatchObject({
      kind: 'editable',
      content: 'after',
      savedContent: 'after',
      save: { kind: 'idle' },
    });
    expect(write).toHaveBeenCalledWith('/w/atlas/.env', 'after', signature(6));
  });

  it('turns a changed-on-disk refusal into the conflict outcome, never an overwrite', async () => {
    const read = vi.fn().mockResolvedValue({
      isBinary: false,
      content: 'before',
      signature: signature(6),
    });
    const conflictError: SourceError = {
      kind: 'refused',
      code: 'changed-on-disk',
      message: 'the file changed on disk',
    };
    const write = vi.fn().mockRejectedValue(conflictError);
    const { result } = renderHook(() =>
      useFileBuffers({ sessionId: 'session-1', root: null, read, write }),
    );

    act(() => result.current.openFile('/w/atlas/notes.md'));
    await waitFor(() => expect(result.current.buffers['/w/atlas/notes.md']?.kind).toBe('editable'));

    act(() => result.current.setContent('/w/atlas/notes.md', 'typed while stale'));

    await act(async () => {
      await result.current.saveFile('/w/atlas/notes.md');
    });

    const buffer = result.current.buffers['/w/atlas/notes.md'];
    expect(buffer).toMatchObject({
      kind: 'editable',
      // The typed text survives — a conflict refuses to overwrite disk, and
      // it must not overwrite the operator's own buffer either.
      content: 'typed while stale',
      savedContent: 'before',
      save: { kind: 'conflict' },
    });
  });

  it('a reload discards the local edit and replaces the buffer from disk', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ isBinary: false, content: 'v1', signature: signature(2) })
      .mockResolvedValueOnce({ isBinary: false, content: 'v2 on disk', signature: signature(10) });
    const write = vi.fn();
    const { result } = renderHook(() =>
      useFileBuffers({ sessionId: 'session-1', root: null, read, write }),
    );

    act(() => result.current.openFile('/w/atlas/app.ts'));
    await waitFor(() => expect(result.current.buffers['/w/atlas/app.ts']?.kind).toBe('editable'));

    act(() => result.current.setContent('/w/atlas/app.ts', 'local edit, never sent'));
    expect(result.current.buffers['/w/atlas/app.ts']).toMatchObject({
      content: 'local edit, never sent',
    });

    act(() => result.current.reloadFile('/w/atlas/app.ts'));
    await waitFor(() =>
      expect(result.current.buffers['/w/atlas/app.ts']).toMatchObject({
        kind: 'editable',
        content: 'v2 on disk',
        savedContent: 'v2 on disk',
      }),
    );
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('opens a not-found path as a new, empty editable buffer rather than a refusal', async () => {
    const notFound: SourceError = {
      kind: 'refused',
      code: 'not-found',
      message: 'no such file',
    };
    const read = vi.fn().mockRejectedValue(notFound);
    const write = vi.fn();
    const { result } = renderHook(() =>
      useFileBuffers({ sessionId: 'session-1', root: null, read, write }),
    );

    act(() => result.current.openFile('/w/atlas/fresh.txt'));
    await waitFor(() =>
      expect(result.current.buffers['/w/atlas/fresh.txt']).toMatchObject({
        kind: 'editable',
        content: '',
        savedContent: '',
        baseSignature: null,
        isNew: true,
        save: { kind: 'idle' },
      }),
    );
  });

  it('marks a non-not-found read failure as refused, carrying the error through', async () => {
    const permissionError: SourceError = {
      kind: 'refused',
      code: 'outside-root',
      message: 'path escapes the workspace',
    };
    const read = vi.fn().mockRejectedValue(permissionError);
    const write = vi.fn();
    const { result } = renderHook(() =>
      useFileBuffers({ sessionId: 'session-1', root: null, read, write }),
    );

    act(() => result.current.openFile('/w/atlas/../secrets'));
    await waitFor(() =>
      expect(result.current.buffers['/w/atlas/../secrets']).toEqual({
        kind: 'refused',
        error: permissionError,
      }),
    );
  });

  it('loads a binary file as a binary buffer, not editable', async () => {
    const read = vi.fn().mockResolvedValue({
      isBinary: true,
      signature: signature(1024),
    });
    const write = vi.fn();
    const { result } = renderHook(() =>
      useFileBuffers({ sessionId: 'session-1', root: null, read, write }),
    );

    act(() => result.current.openFile('/w/atlas/logo.png'));
    await waitFor(() =>
      expect(result.current.buffers['/w/atlas/logo.png']).toEqual({ kind: 'binary', size: 1024 }),
    );
  });

  it('turns a non-conflict write failure into a save error, keeping the typed text', async () => {
    const read = vi.fn().mockResolvedValue({
      isBinary: false,
      content: 'before',
      signature: signature(6),
    });
    const ioError: SourceError = {
      kind: 'unreachable',
      code: 'disk-full',
      message: 'no space left on device',
    };
    const write = vi.fn().mockRejectedValue(ioError);
    const { result } = renderHook(() =>
      useFileBuffers({ sessionId: 'session-1', root: null, read, write }),
    );

    act(() => result.current.openFile('/w/atlas/big.log'));
    await waitFor(() => expect(result.current.buffers['/w/atlas/big.log']?.kind).toBe('editable'));

    act(() => result.current.setContent('/w/atlas/big.log', 'still typing'));

    await act(async () => {
      await result.current.saveFile('/w/atlas/big.log');
    });

    expect(result.current.buffers['/w/atlas/big.log']).toMatchObject({
      kind: 'editable',
      content: 'still typing',
      savedContent: 'before',
      save: { kind: 'error', error: ioError },
    });
  });

  it('re-opening an already-open, dirty file shows it as-is and does not refetch', async () => {
    const read = vi.fn().mockResolvedValue({
      isBinary: false,
      content: 'v1',
      signature: signature(2),
    });
    const write = vi.fn();
    const { result } = renderHook(() =>
      useFileBuffers({ sessionId: 'session-1', root: null, read, write }),
    );

    act(() => result.current.openFile('/w/atlas/app.ts'));
    await waitFor(() => expect(result.current.buffers['/w/atlas/app.ts']?.kind).toBe('editable'));

    act(() => result.current.setContent('/w/atlas/app.ts', 'unsaved local edit'));
    // Switch away, then back — the buffer must survive untouched and `read`
    // must not fire again, which is the whole of how tab-switching keeps
    // unsaved text (see `openFile`'s own header).
    act(() => result.current.openFile('/w/atlas/other.ts'));
    act(() => result.current.openFile('/w/atlas/app.ts'));

    expect(result.current.buffers['/w/atlas/app.ts']).toMatchObject({
      content: 'unsaved local edit',
    });
    expect(read).toHaveBeenCalledTimes(2); // app.ts once, other.ts once — never app.ts twice
  });

  it('unsavedKey reflects exactly the dirty files, labelled relative to root, and clears once saved', async () => {
    const read = vi.fn().mockResolvedValue({
      isBinary: false,
      content: 'before',
      signature: signature(6),
    });
    const write = vi.fn().mockResolvedValue({ signature: signature(9) });
    const { result } = renderHook(() =>
      useFileBuffers({ sessionId: 'session-1', root: '/w/atlas', read, write }),
    );

    act(() => result.current.openFile('/w/atlas/notes.md'));
    await waitFor(() => expect(result.current.buffers['/w/atlas/notes.md']?.kind).toBe('editable'));
    expect(result.current.unsavedKey).toBe('[]');

    act(() => result.current.setContent('/w/atlas/notes.md', 'dirty now'));
    expect(result.current.unsavedKey).toBe(JSON.stringify([['/w/atlas/notes.md', 'notes.md']]));

    await act(async () => {
      await result.current.saveFile('/w/atlas/notes.md');
    });
    expect(result.current.unsavedKey).toBe('[]');
  });
});
