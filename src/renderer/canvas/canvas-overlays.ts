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
  /**
   * Which section Settings opens on next — `null` UNLESS a caller asked for
   * one BY NAME (the Remote icon, the stats icon, a GitHub deep link): a
   * generic open (the gear icon, the `,` shortcut) passes `null` through to
   * `SettingsOverlay`'s own `initialSection` prop as `undefined`, which is
   * what lets that component's own fallback take over -- the LAST section
   * the operator actually viewed (`last-section.ts`, item C), not a value
   * this hook would otherwise have to hard-code as `interface` and force on
   * every generic open, silently overriding that fallback every time.
   */
  const [settingsSection, setSettingsSection] = useState<SectionId | null>(null);
  const [errorLogOpen, setErrorLogOpen] = useState(false);
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
    confirmForceClose,
    setConfirmForceClose,
  };
}
