/**
 * The empty step slot — §3.5's dashed `no step yet` placeholder.
 *
 * A session with fewer than three visible decisions still draws three slots
 * (epic.md §3.5, §5.2): the cell height is a constant 290 regardless of how
 * many steps a session has. This is purely presentational — no click handler,
 * no focus ring, no jump label, no selection state — because there is nothing
 * here to jump to.
 */

export function StepSlotNode(_props: { readonly id: string }) {
  return (
    <div
      style={{
        width: '250px',
        height: '90px',
        borderStyle: 'dashed',
        borderWidth: '1px',
        borderColor: 'var(--color-line-strong)',
        borderRadius: 'var(--radius-md)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-ink-faint)',
        }}
      >
        no step yet
      </span>
    </div>
  );
}
