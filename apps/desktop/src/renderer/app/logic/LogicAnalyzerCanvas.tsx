/**
 * 8-channel virtual logic analyzer view. Renders cycle-accurate digital waveforms for
 * selectable Arduino pins (D0–D13) captured from the worker's FRAME.pinEdges, with
 * interactive zoom/pan/cursor, live UART/I2C/SPI protocol overlays, and VCD export.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Trash2, ZoomIn, ZoomOut, Maximize, Play, Square, AlertTriangle } from 'lucide-react';
import { useLogic, useActions, useSerial, useSimulation } from '../../state/store';
import { simulationClient } from '../../simulation/simulation-client';
import {
  F_CPU,
  LOGIC_CHANNELS,
  cyclesToMicros,
  levelAtCycle,
  microsToCycles,
  type LogicEdge,
} from './logic-types';
import { decodeUART, decodeI2C, decodeSPI, type Annotation, type ProtocolKind } from './protocolDecoders';
import { downloadVCD, captureFileName } from './exportVCD';

const LANE_H = 30;
const LANE_GAP = 6;
const TOP_PAD = 10;
const LEFT_PAD = 46;
const ANNOTATION_H = 22;

const ANNOT_COLOR: Record<Annotation['kind'], string> = {
  frame: '#38bdf8',
  data: '#34d399',
  control: '#a78bfa',
  error: '#f87171',
};

export function LogicAnalyzerCanvas(): JSX.Element {
  const logic = useLogic();
  const actions = useActions();
  const defaultBaud = useSerial().baudRate;
  const phase = useSimulation().phase;

  const recordedPins = useMemo(
    () => Object.keys(logic.edgesByPin).sort((a, b) => LOGIC_CHANNELS.indexOf(a) - LOGIC_CHANNELS.indexOf(b)),
    [logic.edgesByPin],
  );

  const [channels, setChannels] = useState<string[]>([]);
  const [windowStart, setWindowStart] = useState(0);
  const [windowCycles, setWindowCycles] = useState(microsToCycles(2000)); // 2 ms default
  const [cursorCycle, setCursorCycle] = useState<number | null>(null);
  const [followTail, setFollowTail] = useState(true);

  const [protocol, setProtocol] = useState<'none' | ProtocolKind>('none');
  const [baud, setBaud] = useState(defaultBaud);
  const [uartPin, setUartPin] = useState('D1');
  const [sdaPin, setSdaPin] = useState('A4');
  const [sclPin, setSclPin] = useState('A5');
  const [sckPin, setSckPin] = useState('D13');
  const [mosiPin, setMosiPin] = useState('D11');
  const [misoPin, setMisoPin] = useState('D12');
  const [csPin, setCsPin] = useState('D10');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ x: number; start: number } | null>(null);

  // Default channel selection: whatever pins have been driven (max 8), else D13.
  useEffect(() => {
    if (channels.length === 0 && recordedPins.length > 0) {
      setChannels(recordedPins.slice(0, 8));
    }
  }, [recordedPins, channels.length]);

  // Follow the live tail while capturing (until the user pans/zooms manually).
  useEffect(() => {
    if (followTail && logic.lastCycle > 0) {
      setWindowStart(Math.max(logic.firstCycle, logic.lastCycle - windowCycles));
    }
  }, [logic.lastCycle, followTail, windowCycles, logic.firstCycle]);

  const shownChannels = channels.length > 0 ? channels : recordedPins.slice(0, 8);

  // ---- protocol decode (memoized over the relevant channels) --------------------------
  const annotations = useMemo<Annotation[]>(() => {
    const e = (pin: string): LogicEdge[] => logic.edgesByPin[pin] ?? [];
    try {
      if (protocol === 'uart') return decodeUART(e(uartPin), { baud, fCpu: F_CPU });
      if (protocol === 'i2c') return decodeI2C(e(sdaPin), e(sclPin));
      if (protocol === 'spi') return decodeSPI(e(sckPin), e(mosiPin), e(misoPin), e(csPin));
    } catch {
      /* decoders are best-effort over partial captures */
    }
    return [];
  }, [protocol, baud, uartPin, sdaPin, sclPin, sckPin, mosiPin, misoPin, csPin, logic.edgesByPin]);

  // ---- rendering ----------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = rect.width;
    const H = rect.height;
    const plotW = W - LEFT_PAD;
    const cssColor = (v: string, fb: string) =>
      getComputedStyle(canvas).getPropertyValue(v).trim() || fb;
    const fg = cssColor('--text-primary', '#e5e7eb');
    const dim = cssColor('--text-secondary', '#9ca3af');

    ctx.clearRect(0, 0, W, H);
    const winEnd = windowStart + windowCycles;
    const xOf = (cycle: number) => LEFT_PAD + ((cycle - windowStart) / windowCycles) * plotW;

    // Vertical time gridlines (~8 divisions).
    ctx.strokeStyle = 'rgba(120,130,150,0.14)';
    ctx.fillStyle = dim;
    ctx.font = '10px monospace';
    ctx.lineWidth = 1;
    const divs = 8;
    for (let i = 0; i <= divs; i += 1) {
      const c = windowStart + (windowCycles * i) / divs;
      const x = xOf(c);
      ctx.beginPath();
      ctx.moveTo(x, TOP_PAD);
      ctx.lineTo(x, H);
      ctx.stroke();
      const us = cyclesToMicros(c - windowStart);
      const label = us >= 1000 ? `${(us / 1000).toFixed(2)}ms` : `${us.toFixed(0)}µs`;
      if (i < divs) ctx.fillText(label, x + 2, TOP_PAD - 1);
    }

    // Channel lanes.
    shownChannels.forEach((pin, idx) => {
      const laneTop = TOP_PAD + idx * (LANE_H + LANE_GAP) + 4;
      const hi = laneTop;
      const lo = laneTop + LANE_H - 6;
      const edges = logic.edgesByPin[pin] ?? [];

      ctx.fillStyle = fg;
      ctx.font = '11px monospace';
      ctx.fillText(pin, 6, laneTop + LANE_H / 2);

      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let level = levelAtCycle(edges, windowStart, 1);
      let x = LEFT_PAD;
      let y = level ? hi : lo;
      ctx.moveTo(x, y);
      for (const e of edges) {
        if (e.cycle < windowStart) continue;
        if (e.cycle > winEnd) break;
        const ex = xOf(e.cycle);
        ctx.lineTo(ex, y); // horizontal to edge
        const ny = e.level ? hi : lo;
        ctx.lineTo(ex, ny); // vertical transition
        y = ny;
        level = e.level;
      }
      ctx.lineTo(LEFT_PAD + plotW, y);
      ctx.stroke();
      void x;
    });

    // Annotation strip (protocol packets), aligned by time under the lanes.
    if (annotations.length > 0) {
      const stripTop = TOP_PAD + shownChannels.length * (LANE_H + LANE_GAP) + 4;
      ctx.font = '10px monospace';
      for (const a of annotations) {
        if (a.endCycle < windowStart || a.startCycle > winEnd) continue;
        const ax = xOf(a.startCycle);
        const aw = Math.max(2, xOf(Math.max(a.endCycle, a.startCycle + windowCycles * 0.002)) - ax);
        ctx.fillStyle = ANNOT_COLOR[a.kind];
        ctx.globalAlpha = 0.22;
        ctx.fillRect(ax, stripTop, aw, ANNOTATION_H);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = ANNOT_COLOR[a.kind];
        ctx.strokeRect(ax, stripTop, aw, ANNOTATION_H);
        if (aw > 24) {
          ctx.fillStyle = fg;
          ctx.fillText(a.text, ax + 3, stripTop + ANNOTATION_H / 2 + 3);
        }
      }
    }

    // Time cursor.
    if (cursorCycle !== null && cursorCycle >= windowStart && cursorCycle <= winEnd) {
      const cx = xOf(cursorCycle);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, TOP_PAD);
      ctx.lineTo(cx, H);
      ctx.stroke();
      ctx.fillStyle = '#fbbf24';
      ctx.font = '10px monospace';
      ctx.fillText(`${cyclesToMicros(cursorCycle).toFixed(1)}µs`, cx + 3, H - 3);
    }
  }, [logic.edgesByPin, shownChannels, windowStart, windowCycles, cursorCycle, annotations]);

  // ---- interactions -------------------------------------------------------------------
  const onWheel = (ev: React.WheelEvent<HTMLCanvasElement>): void => {
    ev.preventDefault();
    const rect = ev.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, (ev.clientX - rect.left - LEFT_PAD) / (rect.width - LEFT_PAD));
    const focusCycle = windowStart + windowCycles * frac;
    const factor = ev.deltaY > 0 ? 1.2 : 1 / 1.2;
    const next = Math.max(16, Math.min(microsToCycles(60_000), windowCycles * factor));
    setWindowStart(focusCycle - next * frac);
    setWindowCycles(next);
    setFollowTail(false);
  };
  const onPointerDown = (ev: React.PointerEvent<HTMLCanvasElement>): void => {
    ev.currentTarget.setPointerCapture(ev.pointerId);
    dragRef.current = { x: ev.clientX, start: windowStart };
    setFollowTail(false);
  };
  const onPointerMove = (ev: React.PointerEvent<HTMLCanvasElement>): void => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const frac = (ev.clientX - rect.left - LEFT_PAD) / (rect.width - LEFT_PAD);
    setCursorCycle(windowStart + windowCycles * frac);
    const drag = dragRef.current;
    if (drag) {
      const dxFrac = (ev.clientX - drag.x) / (rect.width - LEFT_PAD);
      setWindowStart(drag.start - windowCycles * dxFrac);
    }
  };
  const onPointerUp = (ev: React.PointerEvent<HTMLCanvasElement>): void => {
    ev.currentTarget.releasePointerCapture(ev.pointerId);
    dragRef.current = null;
  };

  const zoom = (factor: number): void => {
    setFollowTail(false);
    setWindowCycles((w) => Math.max(16, Math.min(microsToCycles(60_000), w * factor)));
  };
  const fitAll = (): void => {
    setFollowTail(false);
    const span = Math.max(16, logic.lastCycle - logic.firstCycle);
    setWindowStart(logic.firstCycle);
    setWindowCycles(span * 1.05);
  };

  const exportVcd = (): void => {
    const vcdChannels = shownChannels.map((pin) => ({
      id: pin,
      edges: logic.edgesByPin[pin] ?? [],
      initialLevel: 1 as const,
    }));
    downloadVCD(vcdChannels, { fCpu: F_CPU, truncated: logic.truncated }, captureFileName());
  };

  const toggleCapture = (): void => simulationClient.setLogicCapture(!logic.capturing);

  const toggleChannel = (pin: string): void =>
    setChannels((cur) => (cur.includes(pin) ? cur.filter((p) => p !== pin) : [...cur, pin].slice(0, 8)));

  // Student-friendly diagnostics (informational, never presented as hardware faults).
  const diagnostics = useMemo<string[]>(() => {
    const notes: string[] = [];
    if (protocol === 'uart' && (!Number.isFinite(baud) || baud <= 0)) {
      notes.push('Enter a valid UART baud rate (e.g. 9600) to decode frames.');
    }
    const decoderChannels =
      protocol === 'uart' ? [uartPin] : protocol === 'i2c' ? [sdaPin, sclPin] : protocol === 'spi' ? [sckPin, mosiPin] : [];
    for (const ch of decoderChannels) {
      if ((logic.edgesByPin[ch]?.length ?? 0) === 0) notes.push(`Channel ${ch} shows no transitions in this capture — check the wiring/pin.`);
    }
    if (protocol === 'i2c' && (logic.edgesByPin[sdaPin]?.length ?? 0) > 0) {
      const first = annotations[0];
      if (first && first.text !== 'START') notes.push('I²C capture appears to begin mid-transaction; the first bytes may be incomplete.');
    }
    return notes;
  }, [protocol, baud, uartPin, sdaPin, sclPin, sckPin, mosiPin, logic.edgesByPin, annotations]);

  const usPerDiv = cyclesToMicros(windowCycles / 8);
  const pinOptions = recordedPins.length > 0 ? recordedPins : LOGIC_CHANNELS;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Controls */}
      <div style={ctrlBar}>
        <button
          className={logic.capturing ? 'btn btn--primary' : 'btn'}
          style={iconBtn}
          onClick={toggleCapture}
          aria-pressed={logic.capturing}
          title={logic.capturing ? 'Stop capturing pin transitions' : 'Start capturing pin transitions'}
        >
          {logic.capturing ? <Square size={14} /> : <Play size={14} />}
          {logic.capturing ? 'Stop Capture' : 'Start Capture'}
        </button>
        <span
          role="status"
          style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}
        >
          {logic.capturing ? '● capturing' : '○ stopped'} · {phase} ·{' '}
          {(logic.edgesByPin && Object.values(logic.edgesByPin).reduce((n, l) => n + l.length, 0)).toLocaleString()} edges
        </span>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {LOGIC_CHANNELS.map((pin) => {
            const active = shownChannels.includes(pin);
            const has = (logic.edgesByPin[pin]?.length ?? 0) > 0;
            return (
              <button
                key={pin}
                className="btn"
                onClick={() => toggleChannel(pin)}
                title={has ? `${pin} (captured)` : `${pin} (no activity)`}
                style={{
                  minHeight: 0,
                  minWidth: 0,
                  padding: '2px 6px',
                  fontSize: 11,
                  opacity: active ? 1 : 0.45,
                  borderColor: active ? 'var(--accent)' : undefined,
                  fontWeight: has ? 700 : 400,
                }}
              >
                {pin}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
          <button className="btn" style={iconBtn} title="Zoom in" onClick={() => zoom(1 / 1.5)}><ZoomIn size={14} /></button>
          <button className="btn" style={iconBtn} title="Zoom out" onClick={() => zoom(1.5)}><ZoomOut size={14} /></button>
          <button className="btn" style={iconBtn} title="Fit all" onClick={fitAll}><Maximize size={14} /></button>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
            {usPerDiv >= 1000 ? `${(usPerDiv / 1000).toFixed(2)} ms/div` : `${usPerDiv.toFixed(1)} µs/div`}
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <input type="checkbox" checked={followTail} onChange={(e) => setFollowTail(e.target.checked)} /> Follow
          </label>

          <select value={protocol} onChange={(e) => setProtocol(e.target.value as 'none' | ProtocolKind)} style={selStyle}>
            <option value="none">No decoder</option>
            <option value="uart">UART</option>
            <option value="i2c">I²C</option>
            <option value="spi">SPI</option>
          </select>

          {protocol === 'uart' && (
            <>
              <ChannelSelect label="TX" value={uartPin} onChange={setUartPin} options={pinOptions} />
              <input type="number" value={baud} onChange={(e) => setBaud(Number(e.target.value) || 9600)} style={{ ...selStyle, width: 74 }} title="Baud rate" />
            </>
          )}
          {protocol === 'i2c' && (
            <>
              <ChannelSelect label="SDA" value={sdaPin} onChange={setSdaPin} options={pinOptions} />
              <ChannelSelect label="SCL" value={sclPin} onChange={setSclPin} options={pinOptions} />
            </>
          )}
          {protocol === 'spi' && (
            <>
              <ChannelSelect label="SCK" value={sckPin} onChange={setSckPin} options={pinOptions} />
              <ChannelSelect label="MOSI" value={mosiPin} onChange={setMosiPin} options={pinOptions} />
              <ChannelSelect label="MISO" value={misoPin} onChange={setMisoPin} options={pinOptions} />
              <ChannelSelect label="CS" value={csPin} onChange={setCsPin} options={pinOptions} />
            </>
          )}

          <button className="btn" style={iconBtn} title="Export .vcd (Saleae / PulseView)" onClick={exportVcd}>
            <Download size={14} /> .vcd
          </button>
          <button className="btn" style={iconBtn} title="Clear capture" onClick={() => actions.clearLogic()}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Overflow warning + student diagnostics */}
      {logic.truncated && (
        <div role="alert" style={{ ...noteStrip, color: 'var(--warning, #d97706)', borderColor: 'var(--warning, #d97706)' }}>
          <AlertTriangle size={13} /> Capture truncated: the edge-budget limit was reached. Later transitions were not recorded — Clear and re-run a shorter capture.
        </div>
      )}
      {diagnostics.map((note, i) => (
        <div key={i} style={noteStrip}>
          {note}
        </div>
      ))}

      {/* Waveform canvas */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {recordedPins.length === 0 ? (
          <div style={emptyMsg}>
            {logic.capturing
              ? 'Run a sketch that toggles pins (Blink, Serial, SPI, I²C…) to capture waveforms.'
              : 'Capture is stopped. Press Start Capture, then run a sketch to record pin transitions.'}
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair', touchAction: 'none' }}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setCursorCycle(null)}
          />
        )}
      </div>
    </div>
  );
}

function ChannelSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  options: string[];
}): JSX.Element {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--text-secondary)' }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={selStyle}>
        {!options.includes(value) && <option value={value}>{value}</option>}
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

const ctrlBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  borderBottom: '1px solid var(--border)',
  flexWrap: 'wrap',
  flexShrink: 0,
};
const iconBtn: React.CSSProperties = {
  minHeight: 0,
  minWidth: 0,
  padding: '3px 7px',
  fontSize: 11,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};
const selStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 4px',
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'var(--bg-panel)',
  color: 'var(--text-primary)',
};
const noteStrip: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  fontSize: 12,
  color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border)',
  flexShrink: 0,
};
const emptyMsg: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  textAlign: 'center',
  color: 'var(--text-secondary)',
  fontSize: 13,
};
