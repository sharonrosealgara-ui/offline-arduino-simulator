/**
 * Right panel: properties and component inspector.
 *
 * Shows the selected component's identity, editable properties, terminal list with wiring
 * status, and the guidance note for that part. Every field writes straight through to the
 * store, so an edit here is immediately what the netlist compiler will see.
 */
import { Info, Link2, Trash2, RotateCw, Unlink } from 'lucide-react';
import type { CircuitComponent } from '@offline-arduino/contracts/circuit';
import { catalogEntry, type CatalogProperty } from '../circuit/component-catalog';
import { formatOhms } from '../circuit/hardware/resistor-bands';
import { useCircuit, useActions, useSimulation } from '../../state/store';

export function Inspector(): JSX.Element {
  const circuit = useCircuit();
  const actions = useActions();
  const simulation = useSimulation();

  const selectedComponents = circuit.components.filter((c) => circuit.selectedIds.includes(c.id));
  const selectedWires = circuit.wires.filter((w) => circuit.selectedIds.includes(w.id));

  return (
    <div className="sidePanel" aria-label="Properties and component inspector">
      <section className="sidePanel__section sidePanel__section--grow">
        <h2 className="sidePanel__heading">
          <Info size={13} aria-hidden /> Inspector
        </h2>

        {circuit.pendingWireFrom && (
          <div className="inspectorNotice" role="status">
            <Link2 size={13} aria-hidden />
            <div>
              <strong>Wiring from {circuit.pendingWireFrom.terminalId}</strong>
              <p>Click another terminal to finish, or the same one to cancel.</p>
              <button type="button" className="linkBtn" onClick={() => actions.cancelWire()}>
                Cancel wire
              </button>
            </div>
          </div>
        )}

        {selectedComponents.length === 0 && selectedWires.length === 0 && (
          <p className="sidePanel__empty">
            Nothing selected. Click a part or a wire in the workspace to inspect it.
          </p>
        )}

        {selectedWires.map((wire) => (
          <div key={wire.id} className="inspectorBlock">
            <h3 className="inspectorBlock__title">Wire</h3>
            <dl className="propGrid">
              <dt>From</dt>
              <dd>
                {wire.from.componentId} · {wire.from.terminalId}
              </dd>
              <dt>To</dt>
              <dd>
                {wire.to.componentId} · {wire.to.terminalId}
              </dd>
              <dt>Colour</dt>
              <dd>{wire.colorRole.replace('-', ' ')}</dd>
            </dl>
            <button type="button" className="btn btn--danger btn--block" onClick={() => actions.deleteWires([wire.id])}>
              <Unlink size={14} aria-hidden /> Remove wire
            </button>
          </div>
        ))}

        {selectedComponents.map((component) => (
          <ComponentInspector key={component.id} component={component} />
        ))}
      </section>

      {/* ---- Circuit diagnostics ------------------------------------------------- */}
      {simulation.circuitDiagnostics.length > 0 && (
        <section className="sidePanel__section">
          <h2 className="sidePanel__heading">Circuit checks</h2>
          <ul className="diagList">
            {simulation.circuitDiagnostics.map((d, i) => (
              <li key={i} className={`diagList__item diagList__item--${d.severity}`}>
                {/* Severity is spelled out, never conveyed by colour alone. */}
                <span className="diagList__sev">{d.severity.toUpperCase()}</span>
                <span>{d.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ComponentInspector({ component }: { component: CircuitComponent }): JSX.Element {
  const actions = useActions();
  const circuit = useCircuit();
  const entry = catalogEntry(component.kind);

  const wiredTerminals = new Set(
    circuit.wires.flatMap((w) => [
      w.from.componentId === component.id ? w.from.terminalId : null,
      w.to.componentId === component.id ? w.to.terminalId : null,
    ]).filter((t): t is string => t !== null),
  );

  if (component.kind === 'uno-r3') {
    return (
      <div className="inspectorBlock">
        <h3 className="inspectorBlock__title">{component.label}</h3>
        <dl className="propGrid">
          <dt>Target</dt>
          <dd>Arduino Uno R3</dd>
          <dt>MCU</dt>
          <dd>ATmega328P</dd>
          <dt>Clock</dt>
          <dd>16 MHz</dd>
          <dt>Flash</dt>
          <dd>32 KB (31.5 KB usable)</dd>
          <dt>SRAM</dt>
          <dd>2 KB</dd>
        </dl>
        <p className="inspectorBlock__guidance">
          The board is the simulation target and cannot be removed. Its built-in <strong>L</strong> LED
          follows pin 13.
        </p>
      </div>
    );
  }

  return (
    <div className="inspectorBlock">
      <label className="fieldLabel" htmlFor={`label-${component.id}`}>
        Name
      </label>
      <input
        id={`label-${component.id}`}
        className="textInput"
        value={component.label}
        onChange={(e) => actions.setComponentLabel(component.id, e.target.value)}
      />

      <dl className="propGrid">
        <dt>Type</dt>
        <dd>{entry?.name ?? component.kind}</dd>
        <dt>ID</dt>
        <dd>
          <code>{component.id}</code>
        </dd>
        <dt>Rotation</dt>
        <dd>{component.rotation}°</dd>
      </dl>

      <div className="inspectorBlock__actions">
        <button type="button" className="btn" onClick={() => actions.rotateComponent(component.id)}>
          <RotateCw size={14} aria-hidden /> Rotate
        </button>
        <button type="button" className="btn btn--danger" onClick={() => actions.deleteComponents([component.id])}>
          <Trash2 size={14} aria-hidden /> Delete
        </button>
      </div>

      {entry && entry.properties.length > 0 && (
        <>
          <h4 className="inspectorBlock__subtitle">Properties</h4>
          {entry.properties.map((property) => (
            <PropertyField key={property.key} component={component} property={property} />
          ))}
        </>
      )}

      {entry && (
        <>
          <h4 className="inspectorBlock__subtitle">Terminals</h4>
          <ul className="terminalList">
            {entry.terminals.map((terminal) => (
              <li key={terminal.id} className="terminalList__item">
                <span className="terminalList__name">{terminal.label}</span>
                <span
                  className={`terminalList__state terminalList__state--${
                    wiredTerminals.has(terminal.id) ? 'wired' : 'open'
                  }`}
                >
                  {wiredTerminals.has(terminal.id) ? 'Connected' : 'Not connected'}
                </span>
                <span className="terminalList__hint">{terminal.hint}</span>
              </li>
            ))}
          </ul>

          <p className="inspectorBlock__guidance">{entry.guidance}</p>
        </>
      )}
    </div>
  );
}

function PropertyField({
  component,
  property,
}: {
  component: CircuitComponent;
  property: CatalogProperty;
}): JSX.Element {
  const actions = useActions();
  const inputId = `${component.id}-${property.key}`;
  const raw = component.properties[property.key];

  if (property.type === 'select') {
    return (
      <div className="field">
        <label className="fieldLabel" htmlFor={inputId}>
          {property.label}
        </label>
        <select
          id={inputId}
          className="selectInput"
          value={String(raw ?? property.options[0]?.value ?? '')}
          onChange={(e) => actions.setComponentProperty(component.id, property.key, e.target.value)}
        >
          {property.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const value = typeof raw === 'number' ? raw : Number(raw ?? property.min);

  return (
    <div className="field">
      <label className="fieldLabel" htmlFor={inputId}>
        {property.label}
        {property.unit ? ` (${property.unit})` : ''}
      </label>
      <div className="field__row">
        <input
          id={inputId}
          className="textInput"
          type="number"
          min={property.min}
          max={property.max}
          step={property.step}
          value={Number.isFinite(value) ? value : property.min}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (!Number.isFinite(next)) return;
            // Clamp rather than reject, so a typed-through value can't put the solver into
            // a state the UI can never show.
            const clamped = Math.min(property.max, Math.max(property.min, next));
            actions.setComponentProperty(component.id, property.key, clamped);
          }}
        />
        {property.key === 'ohms' && <span className="field__suffix">{formatOhms(value)}</span>}
      </div>
    </div>
  );
}
