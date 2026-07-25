/**
 * Help & pinout slide-out drawer. Displays a schematic Uno pinout (offline SVG), common
 * C++ snippets with copy, and the keyboard-shortcuts guide. All pin-badge colors use
 * STATIC Tailwind classes (no dynamic `bg-${x}` interpolation), so no safelist is needed.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface HelpDrawerProps {
  open: boolean;
  onClose(): void;
}

/** Static badge class per pin category — literal strings so Tailwind's JIT keeps them. */
const BADGE = {
  digital: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
  analog: 'border-sky-500/30 bg-sky-500/15 text-sky-300',
  power: 'border-amber-500/30 bg-amber-500/15 text-amber-300',
  ground: 'border-zinc-600/40 bg-zinc-600/20 text-zinc-300',
} as const;

const DIGITAL_PINS = Array.from({ length: 14 }, (_, i) => ({ label: `D${i}`, pwm: [3, 5, 6, 9, 10, 11].includes(i) }));
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

const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: 'Ctrl / ⌘ + S', action: 'Save project' },
  { keys: 'Ctrl / ⌘ + Enter', action: 'Verify & Run' },
];

export function HelpDrawer({ open, onClose }: HelpDrawerProps): JSX.Element {
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

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Help and pinout"
        className={`fixed inset-y-0 right-0 z-50 w-[380px] max-w-[90vw] overflow-y-auto border-l border-zinc-800 bg-zinc-900 text-zinc-100 shadow-2xl outline-none transition-transform duration-200 motion-reduce:transition-none ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/95 px-4 py-3 backdrop-blur">
          <h2 className="font-semibold">Help &amp; Pinout</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-md hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            <X size={16} />
          </button>
        </header>

        <div className="space-y-6 p-4">
          <section>
            <SectionTitle>Arduino Uno Pinout</SectionTitle>
            <UnoBoardGraphic />
            <Legend />
            <PinGroup title="Digital (D0–D13, ~ = PWM)">
              {DIGITAL_PINS.map((p) => (
                <Badge key={p.label} cls={BADGE.digital} title={p.pwm ? `${p.label} · PWM` : p.label}>
                  {p.label}{p.pwm ? ' ~' : ''}
                </Badge>
              ))}
            </PinGroup>
            <PinGroup title="Analog In (A0–A5)">
              {ANALOG_PINS.map((p) => (
                <Badge key={p} cls={BADGE.analog}>{p}</Badge>
              ))}
            </PinGroup>
            <PinGroup title="Power &amp; Ground">
              {POWER_PINS.map((p, i) => (
                <Badge key={`${p.label}-${i}`} cls={p.kind === 'ground' ? BADGE.ground : BADGE.power}>{p.label}</Badge>
              ))}
            </PinGroup>
          </section>

          <section>
            <SectionTitle>Common C++ Snippets</SectionTitle>
            <div className="space-y-2">
              {SNIPPETS.map((s) => (
                <SnippetBlock key={s.label} label={s.label} code={s.code} />
              ))}
            </div>
          </section>

          <section>
            <SectionTitle>Keyboard Shortcuts</SectionTitle>
            <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
              {SHORTCUTS.map((s) => (
                <li key={s.action} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-zinc-300">{s.action}</span>
                  <kbd className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-mono text-xs">{s.keys}</kbd>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </aside>
    </>
  );
}

function SectionTitle({ children }: { children: ReactNode }): JSX.Element {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{children}</h3>;
}

function UnoBoardGraphic(): JSX.Element {
  return (
    <svg viewBox="0 0 300 120" className="mb-3 w-full rounded-md border border-zinc-800 bg-zinc-950" role="img" aria-label="Arduino Uno board outline">
      <rect x="6" y="10" width="288" height="100" rx="8" fill="#0f766e" />
      <rect x="0" y="34" width="26" height="30" rx="3" fill="#c0c4c8" />
      <circle cx="14" cy="86" r="9" fill="#111418" />
      <rect x="120" y="18" width="60" height="26" rx="3" fill="#0b0f14" />
      <text x="150" y="70" textAnchor="middle" fontFamily="monospace" fontSize="12" fill="#e6f7fb">ARDUINO UNO</text>
      {Array.from({ length: 14 }).map((_, i) => (
        <rect key={`t${i}`} x={40 + i * 16} y="12" width="6" height="6" fill="#1c2b2a" />
      ))}
      {Array.from({ length: 6 }).map((_, i) => (
        <rect key={`b${i}`} x={150 + i * 16} y="102" width="6" height="6" fill="#1c2b2a" />
      ))}
    </svg>
  );
}

function Legend(): JSX.Element {
  return (
    <div className="mb-3 flex flex-wrap gap-3 text-[11px] text-zinc-400">
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Digital</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-sky-500" />Analog</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" />Power</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-zinc-500" />Ground</span>
    </div>
  );
}

function PinGroup({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-[11px] text-zinc-500">{title}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Badge({ cls, children, title }: { cls: string; children: ReactNode; title?: string }): JSX.Element {
  return <span title={title} className={`rounded border px-2 py-0.5 font-mono text-xs ${cls}`}>{children}</span>;
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
    <div className="overflow-hidden rounded-lg border border-zinc-800">
      <div className="flex items-center justify-between bg-zinc-800/50 px-3 py-1.5">
        <span className="text-xs font-medium text-zinc-300">{label}</span>
        <button onClick={copy} className="text-xs text-sky-400 hover:text-sky-300 focus:outline-none focus-visible:underline">
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <pre className="whitespace-pre-wrap px-3 py-2 font-mono text-xs text-zinc-200">{code}</pre>
    </div>
  );
}
