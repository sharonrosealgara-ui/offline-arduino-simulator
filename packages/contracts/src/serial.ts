/**
 * Virtual Serial Monitor / Plotter contracts.
 * Source: FRONTEND_AND_SIMULATOR_WORKER_SPEC.md §13.
 */

export type SerialLineEnding = 'none' | 'lf' | 'cr' | 'crlf';

export type SerialViewMode = 'utf8' | 'hex';

export interface SerialConfig {
  baudRate: number;
  bitsPerChar: number;
  stopBits: number;
  parity: 'none' | 'even' | 'odd';
}

/** One decoded terminal record. Bounded per §13.3 (max 4096 chars before segmentation). */
export interface SerialRecord {
  /** Monotonic id within a serial epoch. */
  seq: number;
  /** Simulated cycle of the first byte in this record (cycles / 16_000_000 = seconds). */
  cycle: number;
  text: string;
  /** True when this record was force-segmented at the per-line character cap. */
  segmented: boolean;
}

/** A single parsed plotter sample line. Numbers only — never eval/expressions/JSON. */
export interface PlotterSample {
  /** X value: simulated time (seconds) from the TX cycle unless an explicit time: field overrides. */
  x: number;
  /** Ordered series values. Labeled tokens map by name; unlabeled become value, value2, … */
  values: Array<{ label: string; value: number }>;
}

export const SERIAL_LIMITS = {
  /** Raw terminal ring buffer cap. */
  maxDecodedBytes: 2 * 1024 * 1024,
  maxLogicalLines: 20_000,
  maxLineChars: 4096,
  /** Renderer commit batching. */
  maxReactCommitsPerSecond: 30,
  /** Plotter defaults. */
  maxPlotSeries: 8,
  maxPlotSamplesPerSeries: 2000,
  /** Worker RX/TX bounds mirrored from the worker for the client. */
  maxSerialRxMessageBytes: 4 * 1024,
  maxSerialRxQueueBytes: 64 * 1024,
  maxSerialTxBufferBytes: 64 * 1024,
} as const;
