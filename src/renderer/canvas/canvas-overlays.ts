import { useState } from 'react';
import type { SectionId } from '../settings/sections.js';

/**
 * The overlay open/close flags -- palette, key sheet, settings, error log,
 * force-close confirm -- plus the two states that back the palette's own
 * search (`jumping`, `query`) and its result (`status`). Pure UI-visibility
 * state, moved out of `CanvasInner` unchanged: every flag and setter keeps
 * its name so the call site destructures back into the same bindings.
 */
export function useCanvasOverlays() {
  const [jumping, setJumping] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [keySheetOpen, setKeySheetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Which section Settings opens on next — `appearance` unless the Remote
   *  icon or its key just asked for `remote` directly (see `openSettings`). */
  const [settingsSection, setSettingsSection] = useState<SectionId>('appearance');
  const [errorLogOpen, setErrorLogOpen] = useState(false);
  /**
   * The row a close refused without being able to prove it is not vam's own
   * -- `SourceError.forcible` -- and offered the operator a confirmed kill
   * for. `null` means no such prompt is on screen. See `ConfirmForceClose`.
   */
  const [confirmForceClose, setConfirmForceClose] = useState<{
    sessionId: string;
    title: string;
  } | null>(null);

  return {
    jumping,
    setJumping,
    status,
    setStatus,
    query,
    setQuery,
    paletteOpen,
    setPaletteOpen,
    keySheetOpen,
    setKeySheetOpen,
    settingsOpen,
    setSettingsOpen,
    settingsSection,
    setSettingsSection,
    errorLogOpen,
    setErrorLogOpen,
    confirmForceClose,
    setConfirmForceClose,
  };
}
