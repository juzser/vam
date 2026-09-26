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
  /** The Stats & Usage screen — its own overlay flag, on `errorLogOpen`'s own
   *  standing rather than a Settings section: nothing in it is a preference
   *  the operator chooses, so it is not `settingsSection`'s concern either. */
  const [statsOpen, setStatsOpen] = useState(false);
  /**
   * The row a close refused without being able to prove it is not vam's own
   * -- `SourceError.forcible` -- and offered the operator a confirmed kill
   * for. `null` means no such prompt is on screen. See `ConfirmForceClose`.
   */
  const [confirmForceClose, setConfirmForceClose] = useState<{
    sessionId: string;
    title: string;
    /** The refusal that opened this prompt, carried along so declining it
     *  (`onCancel`) can dismiss the row with the SAME reason rather than a
     *  second, disconnected one -- see `closeSession`'s own dismissal path. */
    reason: string;
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
    statsOpen,
    setStatsOpen,
    confirmForceClose,
    setConfirmForceClose,
  };
}
