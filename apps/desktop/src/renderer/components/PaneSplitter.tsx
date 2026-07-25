/**
 * Accessible resize splitter. Source: UI_CANVAS_AND_PACKAGING_SPEC.md §2.2.
 *
 * Dragging updates a CSS custom property through requestAnimationFrame (not React state
 * per pointer event); the final size commits to the store on pointer-up. Arrow keys
 * move 8px, Shift+Arrow 32px, Home/End to limits, double-click restores default.
 */
import { useRef } from 'react';

interface Props {
  orientation: 'vertical' | 'horizontal';
  ariaLabel: string;
  min: number;
  max: number;
  value: number;
  /** Live value during drag (px or %, matching value units). Called via rAF. */
  onDragValue(value: number): void;
  /** Commit on pointer up / key change. */
  onCommit(value: number): void;
  onRestoreDefault(): void;
  /** Convert a pointer delta (px) into a value delta in the value's units. */
  pxToValue(deltaPx: number): number;
  /** Optional style override (e.g. visibility:hidden when a pane is maximized). */
  style?: React.CSSProperties;
}

export function PaneSplitter({ orientation, ariaLabel, min, max, value, onDragValue, onCommit, onRestoreDefault, pxToValue, style }: Props): JSX.Element {
  const rafRef = useRef(0);
  const draggingRef = useRef<{ startPos: number; startValue: number } | null>(null);

  const clamp = (v: number): number => Math.max(min, Math.min(max, v));

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    draggingRef.current = { startPos: orientation === 'vertical' ? event.clientX : event.clientY, startValue: value };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = draggingRef.current;
    if (!drag) return;
    const currentPos = orientation === 'vertical' ? event.clientX : event.clientY;
    const next = clamp(drag.startValue + pxToValue(currentPos - drag.startPos));
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => onDragValue(next));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = draggingRef.current;
    if (!drag) return;
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    const currentPos = orientation === 'vertical' ? event.clientX : event.clientY;
    const next = clamp(drag.startValue + pxToValue(currentPos - drag.startPos));
    draggingRef.current = null;
    onCommit(next);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const stepPx = event.shiftKey ? 32 : 8;
    let next: number | null = null;
    if ((orientation === 'vertical' && event.key === 'ArrowLeft') || (orientation === 'horizontal' && event.key === 'ArrowUp')) next = clamp(value - pxToValue(stepPx));
    else if ((orientation === 'vertical' && event.key === 'ArrowRight') || (orientation === 'horizontal' && event.key === 'ArrowDown')) next = clamp(value + pxToValue(stepPx));
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    if (next !== null) {
      event.preventDefault();
      onCommit(next);
    }
  };

  return (
    <div
      className="splitter"
      role="separator"
      aria-label={ariaLabel}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      style={style}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      onDoubleClick={onRestoreDefault}
    />
  );
}
