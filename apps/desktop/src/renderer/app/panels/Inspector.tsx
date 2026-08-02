/**
 * Right panel: properties and component inspector.
 *
 * Shows the selected component's identity, editable properties, terminal list with wiring
 * status, and the guidance note for that part. Every field writes straight through to the
 * store, so an edit here is immediately what the netlist compiler will see.
 */
import { Info, Link2, Trash2, RotateCw, Unlink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CircuitComponent } from '@offline-arduino/contracts/circuit';
import { catalogEntry, type CatalogProperty } from '../circuit/component-catalog';
import { useMomentaryControl } from './useMomentaryControl';
import { formatOhms } from '../circuit/hardware/resistor-bands';
import { wireRoleLabel } from '../circuit/hardware/wire-colors';
import { useCircuit, useActions, useSimulation } from '../../state/store';

import { simulationClient } from '../../simulation/simulation-client';

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
              <dd>{wireRoleLabel(wire.colorRole)}</dd>
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

  // For interactive controls (potentiometer) show a live slider bound to the running
  // simulation. Do not update React state every simulation tick; the slider keeps local
  // state while the user is interacting and syncs from the simulation only when idle.
  const simulation = useSimulation();

  const simDelta = simulation.components[component.id];
  const potValueFromSim = simDelta?.kind === 'potentiometer' && typeof simDelta.value === 'number' ? simDelta.value : undefined;

  // Local slider state in percent (0..100). Initialize from the component property so
  // the inspector shows a stable value for newly-selected parts. Do NOT call React
  // setters during render — instead synchronize from the simulator in an effect.
  const [sliderPercent, setSliderPercent] = useState<number>(() => Math.round(Number(component.properties.initialPosition ?? 0.5) * 100));
  // Momentary pushbutton lifecycle. Always instantiated (hooks must not be conditional);
  // it is only wired to an element when the selected component is a pushbutton.
  const momentary = useMomentaryControl(component.id, (id, value) => simulationClient.setControl(id, value));
  const draggingRef = useRef(false);
  const mountedRef = useRef(true);

  // Sync simulator-driven position into the slider when the selected component or
  // the simulator-reported value changes, but only when the user is not actively dragging.
  useEffect(() => {
    mountedRef.current = true;
    if (!draggingRef.current && typeof potValueFromSim === 'number') {
      const next = Math.round(potValueFromSim * 100);
      setSliderPercent((prev) => (prev !== next ? next : prev));
    }
    return () => {
      mountedRef.current = false;
    };
  }, [component.id, potValueFromSim]);

  // Ensure the dragging state clears on pointerup anywhere, pointercancel, lost capture,
  // blur on the control, or when the inspector unmounts.
  useEffect(() => {
    const onWindowPointerUp = () => {
      if (draggingRef.current) draggingRef.current = false;
    };
    window.addEventListener('pointerup', onWindowPointerUp);
    return () => window.removeEventListener('pointerup', onWindowPointerUp);
  }, [component.id]);

  const onSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pct = Number(e.target.value);
    setSliderPercent(pct);
    const pos = pct / 100;
    // Send the numeric 0..1 directly to the worker via the SimulationClient.
    simulationClient.setControl(component.id, pos);
  };

  const onSliderPointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    draggingRef.current = true;
    try {
      (e.currentTarget as Element).setPointerCapture?.((e as unknown as PointerEvent).pointerId);
    } catch {}
  };
  const onSliderPointerUp = (e?: React.PointerEvent<HTMLInputElement>) => {
    draggingRef.current = false;
    try {
      if (e) (e.currentTarget as Element).releasePointerCapture?.((e as unknown as PointerEvent).pointerId);
    } catch {}
  };

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

      {/* Pushbutton inspector control: a focusable, accessible momentary button
          used for keyboard operation. The 3D mesh continues to accept pointer presses. */}
      {component.kind === 'pushbutton' && (
        <>
          <h4 className="inspectorBlock__subtitle">Pushbutton</h4>
          <div className="field">
            <label className="fieldLabel" htmlFor={`pb-${component.id}`}>Keyboard press</label>
            <div className="field__row">
              <button
                id={`pb-${component.id}`}
                type="button"
                className="btn"
                // Every termination path — pointer up (including outside the control),
                // cancel, lost capture, leave, blur, selection change and unmount — routes
                // through useMomentaryControl, which releases exactly once. See that file
                // for the two stranding cases this fixes.
                {...momentary}
              >
                Press and hold (Space/Enter)
              </button>
            </div>
            <div style={{ marginTop: 8 }}>
              <small>Tip: click to focus and use Space or Enter to operate the selected button without capturing global keyboard events.</small>
            </div>
          </div>
        </>
      )}

      {/* Potentiometer live control: accessible slider + readout */}
      {component.kind === 'potentiometer' && (
        <>
          <h4 className="inspectorBlock__subtitle">Potentiometer</h4>
          <div className="field">
            <label className="fieldLabel" htmlFor={`pot-${component.id}`}>Position</label>
            <div className="field__row">
              <input
                id={`pot-${component.id}`}
                className="rangeInput"
                type="range"
                min={0}
                max={100}
                step={1}
                value={sliderPercent}
                onChange={onSliderChange}
                onPointerDown={onSliderPointerDown}
                onPointerUp={onSliderPointerUp}
                onPointerCancel={onSliderPointerUp}
                onBlur={() => onSliderPointerUp()}
              />
              <span className="field__suffix">{sliderPercent}%</span>
            </div>
            <div style={{ marginTop: 8 }}>
              <small>
                Estimated ADC (wiper position): {Math.round((sliderPercent / 100) * 1023)} &nbsp;•&nbsp; Wiper voltage estimate: {(sliderPercent / 100 * 5).toFixed(2)} V
              </small>
            </div>
          </div>
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
