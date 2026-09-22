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
    expect(result.current.buffers['/w/atlas/app.ts']).toMatchObject({ content: 'local edit, never sent' });

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
});
