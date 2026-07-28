/**
 * Status bar: board target, toolchain state, simulation state, offline indicator, and
 * save state.
 *
 * Every field is derived from real state. In particular the toolchain indicator reports
 * what the app actually knows — it starts at "not verified" and only claims "verified"
 * once a compile has genuinely round-tripped through the bundled AVR-GCC. It never asserts
 * a healthy toolchain it has not exercised.
 */
import { CircuitBoard, Cpu, WifiOff, HardDriveDownload, Activity } from 'lucide-react';
import { useCompiler, useProject, useSimulation } from '../state/store';
import { useCompilerStore } from './state/compiler-store';

type Tone = 'neutral' | 'good' | 'busy' | 'warn' | 'bad';

function Item({
  icon,
  label,
  value,
  tone = 'neutral',
  title,
}: {
  icon?: JSX.Element;
  label: string;
  value: string;
  tone?: Tone;
  title?: string;
}): JSX.Element {
  return (
    <div className={`statusItem statusItem--${tone}`} title={title ?? `${label}: ${value}`}>
      {icon}
      <span className="statusItem__label">{label}</span>
      <span className="statusItem__value">{value}</span>
    </div>
  );
}

const SIM_TONE: Record<string, Tone> = {
  empty: 'neutral',
  ready: 'neutral',
  running: 'good',
  paused: 'warn',
  stopped: 'neutral',
  faulted: 'bad',
};

export function StatusBar(): JSX.Element {
  const project = useProject();
  const compiler = useCompiler();
  const simulation = useSimulation();
  const verifyStatus = useCompilerStore((s) => s.status);

  // Toolchain health is inferred from compile outcomes, which is the only evidence the
  // renderer has. A compile that produced valid HEX proves the bundled toolchain ran.
  const toolchain: { text: string; tone: Tone } =
    verifyStatus === 'compiling'
      ? { text: 'compiling…', tone: 'busy' }
      : compiler.lastValidHex
        ? { text: 'AVR-GCC 7.3.0 verified', tone: 'good' }
        : compiler.phase === 'error'
          ? { text: 'AVR-GCC 7.3.0 — last compile failed', tone: 'bad' }
          : { text: 'AVR-GCC 7.3.0 bundled (not yet run)', tone: 'neutral' };

  const flashPercent = compiler.flashMaxBytes > 0
    ? Math.round((compiler.flashBytes / compiler.flashMaxBytes) * 100)
    : 0;

  return (
    <div className="statusBar" role="status" aria-live="polite">
      <Item
        icon={<CircuitBoard size={13} aria-hidden />}
        label="Board"
        value="Arduino Uno R3 · ATmega328P · 16 MHz"
      />

      <Item icon={<Cpu size={13} aria-hidden />} label="Toolchain" value={toolchain.text} tone={toolchain.tone} />

      <Item
        icon={<Activity size={13} aria-hidden />}
        label="Simulation"
        value={simulation.phase}
        tone={SIM_TONE[simulation.phase] ?? 'neutral'}
      />

      {compiler.lastValidHex && (
        <Item
          label="Flash"
          value={`${compiler.flashBytes} / ${compiler.flashMaxBytes} B (${flashPercent}%)`}
          tone={flashPercent > 90 ? 'warn' : 'neutral'}
          title={`Program memory used. SRAM: ${compiler.sramBytes} / ${compiler.sramMaxBytes} B`}
        />
      )}

      <div className="statusBar__spacer" />

      <Item
        icon={<HardDriveDownload size={13} aria-hidden />}
        label="Project"
        value={project.dirty ? 'Unsaved changes' : 'Saved'}
        tone={project.dirty ? 'warn' : 'good'}
        title={project.dirty ? 'Press Ctrl+S to save' : 'All changes written to disk'}
      />

      {/* This app makes no network requests at runtime; the indicator is a statement of
          design, not a live connectivity probe, and is worded accordingly. */}
      <Item
        icon={<WifiOff size={13} aria-hidden />}
        label=""
        value="Offline — no network use"
        tone="good"
        title="Compilation, simulation, examples, and help all run from bundled resources. The app never contacts the internet."
      />
    </div>
  );
}
