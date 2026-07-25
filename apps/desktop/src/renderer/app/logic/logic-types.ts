/**
 * Logic Analyzer data model. A capture is a set of per-channel edge lists indexed by
 * board pin (D0–D13). Each edge is a cycle-accurate 0/1 transition sourced from the
 * worker's FRAME.pinEdges (see CircuitRuntime.emitPinChangeIfNeeded).
 */
export const F_CPU = 16_000_000;

export type ChannelId = string; // board pin, e.g. 'D0'..'D13'

export interface LogicEdge {
  cycle: number;
  level: 0 | 1;
}

export interface LogicChannel {
  id: ChannelId;
  edges: LogicEdge[];
}

export function cyclesToSeconds(cycles: number, fCpu = F_CPU): number {
  return cycles / fCpu;
}
export function cyclesToMicros(cycles: number, fCpu = F_CPU): number {
  return (cycles / fCpu) * 1e6;
}
export function microsToCycles(micros: number, fCpu = F_CPU): number {
  return (micros / 1e6) * fCpu;
}

/** Board pins available as logic-analyzer channels (D0–D13). */
export const LOGIC_CHANNELS: ChannelId[] = Array.from({ length: 14 }, (_, i) => `D${i}`);

/**
 * Level of a channel at an arbitrary cycle: the level of the last edge at or before it.
 * Edges MUST be sorted ascending by cycle. Returns `initial` before the first edge.
 */
export function levelAtCycle(edges: LogicEdge[], cycle: number, initial: 0 | 1 = 1): 0 | 1 {
  if (edges.length === 0) return initial;
  let lo = 0;
  let hi = edges.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (edges[mid].cycle <= cycle) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx < 0 ? initial : edges[idx].level;
}

/** Index of the first edge with cycle >= target (for windowed iteration). */
export function firstEdgeIndexAtOrAfter(edges: LogicEdge[], cycle: number): number {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (edges[mid].cycle < cycle) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
