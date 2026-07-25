/**
 * Virtual Serial Monitor. Source: FRONTEND_AND_SIMULATOR_WORKER_SPEC.md §13,
 * UI_CANVAS_AND_PACKAGING_SPEC.md §7.
 *
 * Bounded rendering: shows the tail of the ring buffer, reports discarded records,
 * offers UTF-8/hex view, line-ending selection, and Enter-to-send. Never blocks the
 * simulation worker on terminal rendering.
 */
import { useMemo, useRef, useState } from 'react';
import { useSerial, useAppStore } from '../state/store';
import { simulationClient } from '../simulation/simulation-client';

const VISIBLE_TAIL = 500;
const LINE_ENDINGS: Record<'none' | 'lf' | 'cr' | 'crlf', string> = { none: '', lf: '\n', cr: '\r', crlf: '\r\n' };

export function VirtualSerialMonitor(): JSX.Element {
  const serial = useSerial();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const text = useMemo(() => {
    const tail = serial.records.slice(-VISIBLE_TAIL);
    if (serial.viewMode === 'hex') {
      return tail
        .map((r) => Array.from(new TextEncoder().encode(r.text)).map((b) => b.toString(16).padStart(2, '0')).join(' '))
        .join('\n');
    }
    return tail.map((r) => r.text).join('');
  }, [serial.records, serial.viewMode]);

  const send = (): void => {
    if (!input) return;
    const payload = input + LINE_ENDINGS[serial.lineEnding];
    simulationClient.sendSerial(new TextEncoder().encode(payload));
    setInput('');
  };

  const setSerial = (partial: Partial<typeof serial>): void =>
    useAppStore.setState((state) => ({ serial: { ...state.serial, ...partial } }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="paneHeader" style={{ justifyContent: 'space-between' }}>
        <span>
          Serial Monitor <span style={{ fontWeight: 400, textTransform: 'none' }}>· {serial.baudRate} baud</span>
        </span>
        <div style={{ display: 'flex', gap: 8, textTransform: 'none' }}>
          <label>
            View{' '}
            <select value={serial.viewMode} onChange={(e) => setSerial({ viewMode: e.target.value as 'utf8' | 'hex' })}>
              <option value="utf8">UTF-8</option>
              <option value="hex">Hex</option>
            </select>
          </label>
          <button className="btn" onClick={() => useAppStore.getState().actions.clearSerial()}>
            Clear
          </button>
        </div>
      </div>

      {serial.truncatedCount > 0 && (
        <div style={{ padding: '4px 10px', fontSize: 12, color: 'var(--warning)' }}>
          Output truncated — {serial.truncatedCount.toLocaleString()} older lines discarded.
        </div>
      )}

      <div
        ref={scrollRef}
        className="scrollArea"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 13, whiteSpace: 'pre-wrap', padding: '8px 10px' }}
      >
        {text || <span style={{ color: 'var(--text-secondary)' }}>No serial output yet. Run a sketch that uses Serial.print().</span>}
      </div>

      <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid var(--border)' }}>
        <input
          style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-panel)' }}
          placeholder="Send to sketch…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
        />
        <select value={serial.lineEnding} onChange={(e) => setSerial({ lineEnding: e.target.value as typeof serial.lineEnding })}>
          <option value="none">No line ending</option>
          <option value="lf">Newline (LF)</option>
          <option value="cr">Carriage return (CR)</option>
          <option value="crlf">Both (CRLF)</option>
        </select>
        <button className="btn btn--primary" onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}
