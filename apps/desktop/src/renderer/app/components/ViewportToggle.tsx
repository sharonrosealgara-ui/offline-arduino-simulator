/**
 * Floating viewport mode control for the circuit pane (top-LEFT overlay).
 *
 * - Segmented control: "2D Schematic" | "3D Workspace"
 * - "Low-Spec" switch: drives `quality="low"` on <CircuitCanvas3D /> AND the
 *   app-wide low-spec simulation mode so the whole workbench degrades together.
 *
 * Two corrections from the previous version:
 *  - The 3D tab was labelled "3D Studio (4K)". Nothing here renders at 4K — the canvas
 *    caps device pixel ratio at 1.5 and drops to 1.0 in low-spec — so the label asserted
 *    a capability the renderer does not have.
 *  - It sat at top-right, directly underneath the camera-controls overlay. Moved to
 *    top-left so the two no longer overlap.
 *
 * Fully local styling (inline + design tokens), no external assets.
 */
import { LayoutTemplate, Box, Gauge } from 'lucide-react';

export type ViewportMode = '2d' | '3d';

interface Props {
  mode: ViewportMode;
  onModeChange(mode: ViewportMode): void;
  lowSpec: boolean;
  onLowSpecChange(lowSpec: boolean): void;
  /** Why 3D cannot be chosen right now, or null when it can. Shown, not hidden in a title. */
  threeDisabledReason?: string | null;
}

export function ViewportToggle({
  mode,
  onModeChange,
  lowSpec,
  onLowSpecChange,
  threeDisabledReason = null,
}: Props): JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        left: 12,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '4px 6px',
        borderRadius: 8,
        background: 'rgba(24, 27, 31, 0.82)',
        border: '1px solid var(--border, #33373d)',
        backdropFilter: 'blur(6px)',
        userSelect: 'none',
      }}
    >
      <div
        role="tablist"
        aria-label="Viewport mode"
        style={{
          display: 'flex',
          borderRadius: 6,
          overflow: 'hidden',
          border: '1px solid var(--border, #3a3f46)',
        }}
      >
        <SegmentButton
          active={mode === '2d'}
          onClick={() => onModeChange('2d')}
          label="2D Schematic"
          icon={<LayoutTemplate size={13} />}
        />
        <SegmentButton
          active={mode === '3d'}
          onClick={() => onModeChange('3d')}
          label="3D Workspace"
          icon={<Box size={13} />}
          disabled={Boolean(threeDisabledReason)}
        />
      </div>

      {/* Visible, not a tooltip: a disabled control with no stated reason reads as a bug. */}
      {threeDisabledReason && (
        <p
          role="status"
          data-testid="viewport-3d-disabled-reason"
          style={{ margin: 0, maxWidth: 260, fontSize: 12, lineHeight: 1.35, color: 'var(--text-secondary, #a1a1aa)' }}
        >
          {threeDisabledReason}
        </p>
      )}

      <label
        title="Low-Spec Mode: reduces resolution, disables shadows and antialiasing"
        style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', color: 'var(--text-secondary, #a1a1aa)' }}
      >
        <Gauge size={13} />
        <input
          type="checkbox"
          checked={lowSpec}
          onChange={(e) => onLowSpecChange(e.target.checked)}
          aria-label="Low-Spec Mode"
        />
        Low-Spec
      </label>
    </div>
  );
}

function SegmentButton({
  active,
  onClick,
  label,
  icon,
  disabled = false,
}: {
  active: boolean;
  onClick(): void;
  label: string;
  icon: JSX.Element;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      role="tab"
      aria-selected={active}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 10px',
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        color: active ? '#fff' : 'var(--text-secondary, #a1a1aa)',
        background: active ? 'var(--accent, #2563eb)' : 'transparent',
        transition: 'background 120ms ease, color 120ms ease',
      }}
    >
      {icon}
      {label}
    </button>
  );
}
