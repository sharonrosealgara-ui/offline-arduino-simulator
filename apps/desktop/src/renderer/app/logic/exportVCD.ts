/**
 * Value Change Dump (VCD) exporter — compatible with Saleae Logic & sigrok/PulseView.
 *
 * Timescale is picoseconds so a 16 MHz clock (62,500 ps/cycle) is represented exactly:
 *   time_ps = round(cycle * 1e12 / fCpu)
 *
 * Guarantees: deterministic channel identifiers, sanitized signal names, initial values,
 * monotonically increasing timestamps, de-duplicated value changes, and a clear marker
 * when the capture was truncated by the edge-budget limit.
 */
import { F_CPU, type LogicEdge } from './logic-types';

export interface VcdChannel {
  id: string; // human name, e.g. 'D13'
  edges: LogicEdge[];
  initialLevel?: 0 | 1;
}

export interface VcdOptions {
  fCpu?: number;
  truncated?: boolean;
}

/** VCD identifier codes are printable ASCII 33..126. Deterministic by channel index. */
function vcdSymbol(index: number): string {
  return String.fromCharCode(33 + (index % 94));
}

/** VCD $var names must not contain whitespace; keep only identifier-safe chars. */
function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_');
  return cleaned.length > 0 ? cleaned : 'chan';
}

export function buildVCD(channels: VcdChannel[], options: VcdOptions = {}): string {
  const fCpu = options.fCpu ?? F_CPU;
  const psPerCycle = 1e12 / fCpu;
  const now = new Date().toISOString();

  const header: string[] = [
    `$date ${now} $end`,
    '$version Offline Arduino Simulator Logic Analyzer $end',
    `$comment 8-channel virtual logic analyzer capture; source clock ${fCpu} Hz $end`,
  ];
  if (options.truncated) {
    header.push('$comment WARNING: capture TRUNCATED at the edge-budget limit — not all transitions are present $end');
  }
  header.push('$timescale 1ps $end', '$scope module arduino_uno $end');
  channels.forEach((ch, i) => header.push(`$var wire 1 ${vcdSymbol(i)} ${sanitizeName(ch.id)} $end`));
  header.push('$upscope $end', '$enddefinitions $end');

  // Merge all edges into one time-ordered change list. Stable ordering for same-cycle
  // events (by channel symbol) makes the output deterministic.
  interface Change {
    ps: number;
    sym: string;
    level: 0 | 1;
  }
  const changes: Change[] = [];
  channels.forEach((ch, i) => {
    const sym = vcdSymbol(i);
    for (const e of ch.edges) changes.push({ ps: Math.round(e.cycle * psPerCycle), sym, level: e.level });
  });
  changes.sort((a, b) => a.ps - b.ps || a.sym.localeCompare(b.sym));

  // Initial dump at t=0.
  const body: string[] = ['$dumpvars'];
  const lastLevel = new Map<string, 0 | 1>();
  channels.forEach((ch, i) => {
    const sym = vcdSymbol(i);
    const initial = ch.initialLevel ?? 1;
    body.push(`${initial}${sym}`);
    lastLevel.set(sym, initial);
  });
  body.push('$end');

  let lastPs = -1;
  for (const c of changes) {
    // De-duplicate: skip a value change equal to the symbol's current level.
    if (lastLevel.get(c.sym) === c.level) continue;
    if (c.ps !== lastPs) {
      body.push(`#${c.ps}`);
      lastPs = c.ps;
    }
    body.push(`${c.level}${c.sym}`);
    lastLevel.set(c.sym, c.level);
  }

  return `${header.join('\n')}\n${body.join('\n')}\n`;
}

/** offline-arduino-capture-YYYYMMDD-HHMMSS.vcd */
export function captureFileName(date = new Date()): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  const stamp =
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `offline-arduino-capture-${stamp}.vcd`;
}

/**
 * Triggers a client-side download of the VCD. Offline-safe: Blob URL only, no network,
 * no filesystem paths or Electron APIs exposed — compliant with the renderer CSP
 * (`connect-src 'self' blob: data:`).
 */
export function downloadVCD(channels: VcdChannel[], options: VcdOptions = {}, fileName = captureFileName()): void {
  const text = buildVCD(channels, options);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
