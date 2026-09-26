/**
 * THE FOUR SHAPES ORCA'S APPEARANCE SETTINGS ARE MADE OF, adapted into vam's
 * own tokens: `SettingsCard` (a collapsible section), `SettingsRow` (one
 * setting -- `Block`'s replacement, under a new name because it now lives
 * outside any one panel's file), `SettingsSubgroup` (a sub-heading over a run
 * of indented rows, e.g. "Terminal Typography") and `AdvancedDisclosure` (the
 * chevron-plus-"Advanced" fold a card keeps its rarely-touched rows behind).
 *
 * STEP 1 OF THE CARDS RESTRUCTURE builds these and re-files vam's existing
 * settings into them; it adds no new setting. Follow-up PRs build their own
 * rows on top of what is here, which is the whole reason this file exists
 * separately from `SettingsOverlay.tsx` rather than as four more local
 * functions in it.
 *
 * EVERY CARD IS ALWAYS MOUNTED, collapsed or not -- the settings overlay is
 * now one scrolling page of them, not a tab strip that swaps a single
 * visible panel. Collapsing a card (or closing its Advanced disclosure)
 * hides its content with the plain HTML `hidden` attribute rather than by
 * unmounting it: that keeps every `querySelector` a guard or a unit test
 * already writes against `[data-settings-panel="x"] [data-settings-rows]`
 * finding what it asks for regardless of fold state, the same invariant the
 * single-panel overlay this replaces already relied on.
 *
 * OPEN BY DEFAULT, THE CARD; SHUT BY DEFAULT, ADVANCED -- see
 * `card-collapse.ts` for why the two defaults point opposite ways, and both
 * are persisted per section so an operator who folds a card they never use
 * does not fold it again next launch.
 */

import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import {
  isAdvancedOpen,
  isCardCollapsed,
  setAdvancedOpen,
  setCardCollapsed,
} from './card-collapse.js';
import type { SectionId } from './sections.js';

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

const rowsId = (id: string) => `vam-settings-rows-${id}`;

/**
 * One section, drawn as a collapsible card: an icon tile, the section's own
 * name, a chevron that says which way the fold goes -- all inside ONE
 * button, so a click or a key anywhere on the header toggles it -- a divider,
 * then the hint and the rows a caller passes as `children`.
 *
 * `id` IS THE SECTION, not a free-standing prop: it is what keys the fold's
 * own persistence (`card-collapse.ts`), what the outer `data-settings-panel`
 * hook is named, and what `panelId`/the rows region's own `id` are derived
 * from -- one value the card cannot come to disagree with itself about.
 */
export function SettingsCard({
  id,
  label,
  Icon,
  hint,
  onOpenChange,
  children,
}: {
  readonly id: SectionId;
  readonly label: string;
  readonly Icon: LucideIcon;
  readonly hint: string;
  /**
   * Told the open state on mount and on every toggle after. OPTIONAL: most
   * cards are self-contained, and only the two whose own content polls a
   * bridge while it is on screen (`GithubPanel`, `RemotePanel`) need to know,
   * so they can stop polling for a card nobody is looking at.
   */
  readonly onOpenChange?: (open: boolean) => void;
  readonly children: React.ReactNode;
}) {
  const [open, setOpen] = useState(() => !isCardCollapsed(id));
  // biome-ignore lint/correctness/useExhaustiveDependencies: `onOpenChange` is read, not depended on -- a caller that passes a fresh arrow every render must not re-fire this for a state that has not changed, only `open` deciding whether it has.
  useEffect(() => {
    onOpenChange?.(open);
  }, [open]);
  const contentId = rowsId(id);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    setCardCollapsed(id, !next);
  };
  return (
    <section data-settings-panel={id} className="mt-6 first:mt-0">
      <div className="rounded-md border border-line bg-panel">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={contentId}
          className={`vam-tap flex w-full cursor-pointer items-center gap-2.5 px-4 py-3 text-left ${FOCUS_RING}`}
        >
          {/* THE ICON TILE -- a rounded square, the section's own glyph inside
              it, decorative: the button's own accessible name is the label
              text beside it, and a screen reader that read the icon too would
              say the section twice. */}
          <span
            aria-hidden="true"
            className="flex h-6 w-6 flex-none items-center justify-center rounded-[7px] border border-line bg-sunken text-ink-dim"
          >
            <Icon size={13} strokeWidth={1.6} />
          </span>
          <h3
            data-settings-heading
            className="flex-1 font-semibold text-body text-ink uppercase tracking-[0.07em]"
          >
            {label}
          </h3>
          <ChevronDown
            aria-hidden="true"
            size={15}
            strokeWidth={1.8}
            className={`flex-none text-ink-dim transition-transform ${open ? '' : '-rotate-90'}`}
          />
        </button>
        <div className="border-line-loud border-t" />
        {/* THE HINT IS A SIBLING OF THE ROWS, NOT ONE OF THEM -- it is the
            section's own description, not a row's caption, and
            `copy-budget.test.tsx` counts `[data-settings-rows] p` as "one
            paragraph per row" on that exact assumption; nesting the hint
            inside would double-count it (once by its own hook, once by
            that selector). Both share the one `hidden` wrapper, so the hint
            folds shut with the rest of the card's content. */}
        <div id={contentId} hidden={!open} className="px-4 py-4">
          <p data-settings-panel-hint className="vam-sentence mb-5 text-control text-ink-dim">
            {hint}
          </p>
          <div data-settings-rows>{children}</div>
        </div>
      </div>
    </section>
  );
}

/**
 * One setting: its name, what it is for underneath rather than beside, and
 * the control under both -- `Block`'s replacement, moved out of
 * `SettingsOverlay.tsx` so a card built anywhere can use it.
 *
 * `role="group"`/`aria-labelledby` ASSOCIATE THE ROW WITH ITS LABEL formally,
 * on top of whatever accessible name the control inside already carries on
 * its own (`Switch`'s `label` prop, a button's own `aria-label`): a control
 * that manages its own name unchanged is still one control among several in
 * a row, and the group is what tells a screen reader which label a whole row
 * -- action button included -- answers to.
 */
export function SettingsRow({
  label,
  hint,
  action,
  name,
  children,
}: {
  readonly label: string;
  readonly hint: string;
  readonly action?: React.ReactNode;
  /** A hook for a guard that has to find THIS row's box -- `data-settings-block`.
   *  Optional, because most rows are found by the control they hold. */
  readonly name?: string;
  readonly children: React.ReactNode;
}) {
  const labelId = useId();
  return (
    // `<fieldset>` is biome's own alternative, and it is the wrong one here:
    // its default `min-width: min-content` fights the grid/flex layouts a
    // row's own control draws in (the palette grid, the button rows), and a
    // `<legend>` cannot sit beside an action button the way this row's own
    // heading does. `role="group"` is the ARIA Authoring Practices Guide's
    // own fallback for exactly this case.
    // biome-ignore lint/a11y/useSemanticElements: see above
    <div
      data-settings-block={name}
      role="group"
      aria-labelledby={labelId}
      className="mt-6 border-line-loud border-t pt-6 first:mt-0 first:border-t-0 first:pt-0"
    >
      <div className="flex items-baseline gap-3">
        <h4 id={labelId} className="font-medium text-body text-ink capitalize">
          {label}
        </h4>
        {action === undefined ? null : <span className="ml-auto">{action}</span>}
      </div>
      <p className="vam-sentence mt-1 max-w-[52ch] text-control text-ink-dim">{hint}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

/**
 * A sub-heading inside a card, over an indented run of rows -- "Terminal
 * Typography" over the terminal text size, say. The SAME heading style the
 * keyboard shortcut editor's own groups already use (`sections.ts`'s
 * `shortcutSections`, refinement spec §4-5: "a group heading over a rule, one
 * column of rows"), reused rather than invented: a card that needed a third
 * heading rank would be a card arguing with the one section that already
 * settled this.
 */
export function SettingsSubgroup({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="mt-6 border-line-loud border-t pt-6 first:mt-0 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-3 border-line-loud border-b pb-[6px]">
        <h4 className="flex-1 font-semibold text-body text-ink capitalize">{title}</h4>
        {action === undefined ? null : action}
      </div>
      {/* INDENTED, so the rows read as belonging to the heading above them
          rather than as one more run of the card's own top-level rows. Each
          row keeps its own `first:` reset because this is its own DOM
          parent. */}
      <div className="pl-3">{children}</div>
    </div>
  );
}

/**
 * The fold at a card's own bottom for its rarely-touched rows: a chevron and
 * the word "Advanced", closed by default, remembered per section
 * (`card-collapse.ts`) once the operator opens it.
 *
 * `id` IS THE SECTION THE DISCLOSURE BELONGS TO, the same rule `SettingsCard`
 * follows and for the same reason: one section can hold at most one Advanced
 * disclosure, so the section IS the key its own open state is stored under.
 */
export function AdvancedDisclosure({
  id,
  children,
}: {
  readonly id: SectionId;
  readonly children: React.ReactNode;
}) {
  const [open, setOpen] = useState(() => isAdvancedOpen(id));
  const contentId = `${rowsId(id)}-advanced`;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    setAdvancedOpen(id, next);
  };
  return (
    <div className="mt-6 border-line-loud border-t pt-6 first:mt-0 first:border-t-0 first:pt-0">
      <button
        type="button"
        data-settings-advanced={id}
        onClick={toggle}
        aria-expanded={open}
        aria-controls={contentId}
        className={`vam-tap flex cursor-pointer items-center gap-1 text-control text-ink-dim hover:text-ink ${FOCUS_RING}`}
      >
        {open ? (
          <ChevronDown size={13} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <ChevronRight size={13} strokeWidth={1.8} aria-hidden="true" />
        )}
        Advanced
      </button>
      <div id={contentId} hidden={!open} className="mt-4">
        {children}
      </div>
    </div>
  );
}
