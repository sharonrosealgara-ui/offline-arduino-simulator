/**
 * Left panel: project explorer + component library.
 *
 * Placement flow: clicking a part arms it (`circuit.placementKind`), and the next click in
 * the 3D workspace drops it there. Clicking the armed part again disarms it. This is the
 * whole interaction — there is no drag-and-drop-from-panel path advertised that does not
 * work.
 */
import { Boxes, FileCode2, CircuitBoard, Trash2, RotateCw } from 'lucide-react';
import { COMPONENT_CATALOG } from '../circuit/component-catalog';
import { useAppStore, useCircuit, useProject, useActions } from '../../state/store';

export function ComponentLibrary(): JSX.Element {
  const circuit = useCircuit();
  const project = useProject();
  const actions = useActions();
  const armed = circuit.placementKind;

  const placedParts = circuit.components.filter((c) => c.kind !== 'uno-r3');
  const selected = new Set(circuit.selectedIds);

  return (
    <div className="sidePanel" aria-label="Project and component library">
      {/* ---- Project explorer ---------------------------------------------------- */}
      <section className="sidePanel__section">
        <h2 className="sidePanel__heading">
          <FileCode2 size={13} aria-hidden /> Project
        </h2>
        <div className="explorerItem explorerItem--active">
          <CircuitBoard size={13} aria-hidden />
          <span className="explorerItem__name">{project.name}</span>
          {project.dirty && (
            <span className="explorerItem__badge" title="Unsaved changes">
              ●
            </span>
          )}
        </div>
        <div className="explorerItem explorerItem--child">
          <span className="explorerItem__name">Sketch.ino</span>
        </div>
        <div className="explorerItem explorerItem--child">
          <span className="explorerItem__name">Circuit</span>
          <span className="explorerItem__count">
            {placedParts.length} part{placedParts.length === 1 ? '' : 's'} · {circuit.wires.length} wire
            {circuit.wires.length === 1 ? '' : 's'}
          </span>
        </div>
      </section>

      {/* ---- Component library --------------------------------------------------- */}
      <section className="sidePanel__section sidePanel__section--grow">
        <h2 className="sidePanel__heading">
          <Boxes size={13} aria-hidden /> Component Library
        </h2>
        <p className="sidePanel__hint">
          {armed ? 'Click the workspace to place it.' : 'Select a part, then click the workspace.'}
        </p>

        <ul className="partList">
          {COMPONENT_CATALOG.map((entry) => {
            const isArmed = armed === entry.kind;
            return (
              <li key={entry.kind}>
                <button
                  type="button"
                  className={`partCard${isArmed ? ' partCard--armed' : ''}`}
                  aria-pressed={isArmed}
                  onClick={() => actions.armPlacement(isArmed ? null : entry.kind)}
                  title={entry.summary}
                >
                  <span className="partCard__thumb">{entry.thumbnail}</span>
                  <span className="partCard__text">
                    <span className="partCard__name">{entry.name}</span>
                    <span className="partCard__summary">{entry.summary}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ---- Placed parts -------------------------------------------------------- */}
      {placedParts.length > 0 && (
        <section className="sidePanel__section">
          <h2 className="sidePanel__heading">On the bench</h2>
          <ul className="placedList">
            {placedParts.map((component) => (
              <li key={component.id}>
                <div className={`placedRow${selected.has(component.id) ? ' placedRow--selected' : ''}`}>
                  <button
                    type="button"
                    className="placedRow__select"
                    onClick={() => actions.selectIds([component.id])}
                    title={`Select ${component.label}`}
                  >
                    {component.label}
                  </button>
                  <button
                    type="button"
                    className="iconBtn"
                    onClick={() => actions.rotateComponent(component.id)}
                    title={`Rotate ${component.label}`}
                    aria-label={`Rotate ${component.label}`}
                  >
                    <RotateCw size={13} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="iconBtn iconBtn--danger"
                    onClick={() => actions.deleteComponents([component.id])}
                    title={`Delete ${component.label}`}
                    aria-label={`Delete ${component.label}`}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Places the armed component. Exported so the 3D canvas can call it on a workspace click. */
export function placeArmedComponent(x: number, y: number): void {
  const state = useAppStore.getState();
  const kind = state.circuit.placementKind;
  if (!kind) return;
  state.actions.addComponent(kind, x, y);
}
