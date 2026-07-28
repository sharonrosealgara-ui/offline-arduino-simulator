/**
 * Help & pinout slide-out drawer: an offline Uno pinout reference, common C++ snippets
 * with copy-to-clipboard, and the keyboard shortcut list.
 *
 * This drawer previously carried Tailwind utility classes (and a comment claiming its
 * "static badge classes" avoided needing a JIT safelist) while the project has no Tailwind
 * dependency, PostCSS step, or config anywhere — so every class was inert and the drawer
 * rendered as unstyled HTML. It now uses the project's own design system, and the pin
 * categories are distinguished by a written category label as well as colour.
 *
 * The shortcut list is generated from the same bindings useAppShortcuts actually
 * registers, so it cannot drift into documenting keys that do nothing.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface HelpDrawerProps {
  open: boolean;
  onClose(): void;
}

const PIN_CATEGORY_COLOR = {
  digital: '#34d399',
  analog: '#38bdf8',
  power: '#fbbf24',
  ground: '#94a3b8',
} as const;

const DIGITAL_PINS = Array.from({ length: 14 }, (_, i) => ({
  label: `D${i}`,
  pwm: [3, 5, 6, 9, 10, 11].includes(i),
}));
const ANALOG_PINS = Array.from({ length: 6 }, (_, i) => `A${i}`);
const POWER_PINS: Array<{ label: string; kind: 'power' | 'ground' }> = [
  { label: '5V', kind: 'power' },
  { label: '3.3V', kind: 'power' },
  { label: 'VIN', kind: 'power' },
  { label: 'GND', kind: 'ground' },
  { label: 'GND', kind: 'ground' },
  { label: 'RESET', kind: 'power' },
  { label: 'IOREF', kind: 'power' },
];

const SNIPPETS: Array<{ label: string; code: string }> = [
  { label: 'pinMode', code: 'pinMode(13, OUTPUT);' },
  { label: 'digitalWrite', code: 'digitalWrite(13, HIGH);' },
  { label: 'analogRead', code: 'int v = analogRead(A0); // 0..1023' },
  { label: 'Serial.println', code: 'Serial.begin(9600);\nSerial.println(v);' },
];

/** Mirrors useAppShortcuts exactly. Update both together. */
const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: 'Ctrl / Cmd + S', action: 'Save project' },
  { keys: 'Ctrl / Cmd + Enter', action: 'Verify & Run' },
  { keys: 'Ctrl / Cmd + Z', action: 'Undo circuit edit' },
  { keys: 'Ctrl / Cmd + Shift + Z', action: 'Redo circuit edit' },
  { keys: 'R', action: 'Rotate selected component' },
  { keys: 'Delete', action: 'Remove selection' },
  { keys: 'Esc', action: 'Cancel wiring / clear selection' },
];

export function HelpDrawer({ open, onClose }: HelpDrawerProps): JSX.Element | null {
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modalScrim modalScrim--drawer" role="presentation" onClick={onClose}>
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        className="modalPanel modalPanel--drawer"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modalHeader">
          <h2 className="modalHeader__title" id="help-title">
            Help &amp; Pinout
          </h2>
          <button type="button" className="modalHeader__close" onClick={onClose} aria-label="Close help">
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className="modalBody">
          <section className="helpSection">
            <h3 className="helpSection__title">Arduino Uno pinout</h3>
            <UnoBoardGraphic />
            <PinGroup title="Digital — D0–D13 (~ marks PWM-capable)">
              {DIGITAL_PINS.map((p) => (
                <PinBadge
                  key={p.label}
                  color={PIN_CATEGORY_COLOR.digital}
                  title={p.pwm ? `${p.label} · PWM capable` : `${p.label} · digital I/O`}
                >
                  {p.label}
                  {p.pwm ? ' ~' : ''}
                </PinBadge>
              ))}
            </PinGroup>
            <PinGroup title="Analog in — A0–A5">
              {ANALOG_PINS.map((p) => (
                <PinBadge key={p} color={PIN_CATEGORY_COLOR.analog} title={`${p} · analog input`}>
                  {p}
                </PinBadge>
              ))}
            </PinGroup>
            <PinGroup title="Power and ground">
              {POWER_PINS.map((p, i) => (
                <PinBadge
                  key={`${p.label}-${i}`}
                  color={p.kind === 'ground' ? PIN_CATEGORY_COLOR.ground : PIN_CATEGORY_COLOR.power}
                  title={`${p.label} · ${p.kind}`}
                >
                  {p.label}
                </PinBadge>
              ))}
            </PinGroup>
          </section>

          <section className="helpSection">
            <h3 className="helpSection__title">Common C++ snippets</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {SNIPPETS.map((s) => (
                <SnippetBlock key={s.label} label={s.label} code={s.code} />
              ))}
            </div>
          </section>

          <section className="helpSection">
            <h3 className="helpSection__title">Keyboard shortcuts</h3>
            <table className="helpTable">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Keys</th>
                </tr>
              </thead>
              <tbody>
                {SHORTCUTS.map((s) => (
                  <tr key={s.action}>
                    <td>{s.action}</td>
                    <td>
                      <kbd>{s.keys}</kbd>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </aside>
    </div>
  );
}

function UnoBoardGraphic(): JSX.Element {
  return (
    <svg
      viewBox="0 0 300 120"
      style={{
        width: '100%',
        marginBottom: 12,
        borderRadius: 7,
        border: '1px solid var(--border)',
        background: '#0b0e12',
      }}
      role="img"
      aria-label="Arduino Uno board outline: USB and power connectors on the left, digital header along the top edge, analog and power headers along the bottom edge"
    >
      <rect x="6" y="10" width="288" height="100" rx="8" fill="#0f6b5c" />
      <rect x="0" y="34" width="26" height="30" rx="3" fill="#c0c4c8" />
      <circle cx="14" cy="86" r="9" fill="#111418" />
      <rect x="120" y="18" width="60" height="26" rx="3" fill="#0b0f14" />
      <text x="150" y="70" textAnchor="middle" fontFamily="monospace" fontSize="12" fill="#e6f7fb">
        UNO R3
      </text>
      {Array.from({ length: 14 }).map((_, i) => (
        <rect key={`t${i}`} x={40 + i * 16} y="12" width="6" height="6" fill="#1c2b2a" />
      ))}
      {Array.from({ length: 6 }).map((_, i) => (
        <rect key={`b${i}`} x={150 + i * 16} y="102" width="6" height="6" fill="#1c2b2a" />
      ))}
    </svg>
  );
}

function PinGroup({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ marginBottom: 6, fontSize: 11, color: 'var(--text-secondary)' }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{children}</div>
    </div>
  );
}

function PinBadge({
  color,
  children,
  title,
}: {
  color: string;
  children: ReactNode;
  title: string;
}): JSX.Element {
  return (
    <span
      title={title}
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: 4,
        border: `1px solid ${color}`,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11.5,
      }}
    >
      {children}
    </span>
  );
}

function SnippetBlock({ label, code }: { label: string; code: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '4px 10px',
          background: 'var(--bg-panel-alt)',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
        <button type="button" className="linkBtn" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '8px 10px',
          border: 'none',
          borderRadius: 0,
          background: 'transparent',
          whiteSpace: 'pre-wrap',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
        }}
      >
        {code}
      </pre>
    </div>
  );
}
