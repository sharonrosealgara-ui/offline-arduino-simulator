/**
 * How the workbench divides its width.
 *
 * The two side panels are fixed-width; the editor and the 3D workspace share what is left.
 * That leftover is the "flexible region", and the editor's stored percentage is a share of
 * it — NOT of the window.
 *
 * This used to be a percentage of the whole grid (`--editor-width: 42%`), which meant the
 * fixed panels came out of the workspace rather than being shared. At 1280px the canvas was
 * left 316px while the editor took 538px, so the circuit — the thing the product exists to
 * show — was the narrowest pane on exactly the laptops this ships to.
 *
 * The maths lives here rather than only in CSS because the splitter has to convert pointer
 * pixels into the same units the track uses; if the two disagree, dragging feels geared
 * wrong. The CSS in global.css `.workbench` mirrors these formulas.
 */

/** Width of the column splitter between the editor and the workspace, in CSS pixels. */
export const SPLITTER_SIZE = 6;

/** The editor's share of the flexible region, as a percentage. Mirrors PaneSplitter's clamp. */
export const MIN_EDITOR_PERCENT = 25;
export const MAX_EDITOR_PERCENT = 70;
export const DEFAULT_EDITOR_PERCENT = 42;

export interface WorkbenchWidths {
  containerWidth: number;
  /** Rendered width of the library pane; 0 when it is toggled off. */
  libraryWidth: number;
  /** Rendered width of the inspector pane; 0 when it is toggled off. */
  inspectorWidth: number;
}

/**
 * The width the editor and workspace actually share.
 *
 * Never negative: a window narrow enough to be over-subscribed by the panels should make
 * the flexible tracks collapse to zero, not send the splitter's gearing inside out.
 */
export function flexibleRegionWidth({ containerWidth, libraryWidth, inspectorWidth }: WorkbenchWidths): number {
  return Math.max(0, containerWidth - libraryWidth - inspectorWidth - SPLITTER_SIZE);
}

/** Width of the editor track for a given share of the flexible region. */
export function editorTrackWidth(widths: WorkbenchWidths, editorPercent: number): number {
  return (flexibleRegionWidth(widths) * clampEditorPercent(editorPercent)) / 100;
}

/** Width of the 3D workspace track — the rest of the flexible region. */
export function workspaceTrackWidth(widths: WorkbenchWidths, editorPercent: number): number {
  return flexibleRegionWidth(widths) - editorTrackWidth(widths, editorPercent);
}

export function clampEditorPercent(percent: number): number {
  return Math.max(MIN_EDITOR_PERCENT, Math.min(MAX_EDITOR_PERCENT, percent));
}

/**
 * Converts a pointer delta into a change in the editor's percentage.
 *
 * Dividing by the flexible region, not the window, is what keeps a 100px drag move the
 * splitter 100px whatever the panels are doing.
 */
export function pointerDeltaToEditorPercent(widths: WorkbenchWidths, deltaPx: number): number {
  const flexible = flexibleRegionWidth(widths);
  if (flexible <= 0) return 0;
  return (deltaPx / flexible) * 100;
}

/** Reads the live pane widths out of a mounted `.workbench` element. */
export function measureWorkbench(workbench: HTMLElement | null): WorkbenchWidths {
  if (!workbench) return { containerWidth: 0, libraryWidth: 0, inspectorWidth: 0 };
  const paneWidth = (selector: string): number =>
    (workbench.querySelector(selector) as HTMLElement | null)?.getBoundingClientRect().width ?? 0;
  return {
    containerWidth: workbench.clientWidth,
    libraryWidth: paneWidth('.libraryPane'),
    inspectorWidth: paneWidth('.inspectorPane'),
  };
}
