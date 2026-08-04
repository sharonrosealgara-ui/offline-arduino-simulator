/**
 * What a hole is joined to, and whether anything is already in it.
 *
 * Both answers are DERIVED. Group membership comes from the canonical model; occupancy comes
 * from the wire endpoints the project already holds. Neither is stored anywhere — a stored
 * copy is a second thing to keep in sync, and the moment it disagreed the board would refuse
 * a hole a student can see is empty, or accept one that is not.
 *
 * Every lookup is qualified by component id. `A1` is a hole on this board, the Uno's analog
 * pin 1, and a different hole on a second breadboard; nothing here matches on a bare
 * terminal id.
 *
 * C2A presents these. Enforcing them when a wire is actually started or finished is C2B.
 */
import { createBreadboardModel } from '@offline-arduino/contracts/breadboard';
import type { CircuitWire, TerminalRef } from '@offline-arduino/contracts/circuit';

let cachedGroupByHole: Map<string, string> | null = null;
let cachedHolesByGroup: Map<string, string[]> | null = null;

function indexes(): { groupByHole: Map<string, string>; holesByGroup: Map<string, string[]> } {
  if (!cachedGroupByHole || !cachedHolesByGroup) {
    const model = createBreadboardModel();
    cachedGroupByHole = new Map(model.holes.map((h) => [h.id, h.groupId]));
    cachedHolesByGroup = new Map(model.groups.map((g) => [g.id, [...g.holeIds]]));
  }
  return { groupByHole: cachedGroupByHole, holesByGroup: cachedHolesByGroup };
}

/** The stable semantic group id for a hole, or undefined if it is not a hole. */
export function groupIdForHole(holeId: string): string | undefined {
  return indexes().groupByHole.get(holeId);
}

/**
 * Every hole electrically joined to this one, including itself, in canonical order.
 *
 * Because it comes from the canonical groups, it can never reach across the centre
 * separation: the two banks are separate groups and there is no code path that merges them.
 */
export function holesInSameGroup(holeId: string): string[] {
  const groupId = groupIdForHole(holeId);
  if (!groupId) return [];
  return [...(indexes().holesByGroup.get(groupId) ?? [])];
}

/** Whether two holes on the SAME board are electrically common. */
export function holesAreConnected(a: string, b: string): boolean {
  const groupA = groupIdForHole(a);
  return Boolean(groupA) && groupA === groupIdForHole(b);
}

/**
 * A description a beginner can act on.
 *
 * A rail names its run instead of listing twenty-four other holes — that is what a student
 * would say out loud, and the list would not fit on screen anyway. A strip names its four
 * partners, because knowing exactly which ones is the whole lesson of a breadboard.
 */
export function connectedGroupDescription(holeId: string): string | undefined {
  const groupId = groupIdForHole(holeId);
  if (!groupId) return undefined;

  if (groupId.startsWith('rail:')) {
    const [, side, polarity] = groupId.split(':');
    return `${holeId} — connected along the ${side} ${polarity} rail`;
  }

  const others = holesInSameGroup(holeId).filter((id) => id !== holeId);
  if (others.length === 0) return `${holeId} — not connected to any other hole`;
  const last = others[others.length - 1];
  return `${holeId} — connected to ${others.slice(0, -1).join(', ')} and ${last}`;
}

// ---------------------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------------------

/**
 * Hole ids of ONE breadboard instance that currently hold a conductor.
 *
 * Both ends of every wire are examined, and both must match this component's id — a wire
 * from `uno1:A1` says nothing about `bb1:A1`, and a wire into `bb2:A1` says nothing about
 * `bb1:A1`.
 */
export function occupiedHoles(wires: readonly CircuitWire[], breadboardId: string): Set<string> {
  const taken = new Set<string>();
  for (const wire of wires) {
    for (const end of [wire.from, wire.to]) {
      if (end.componentId === breadboardId) taken.add(end.terminalId);
    }
  }
  return taken;
}

/** Whether this exact hole on this exact board holds a conductor. */
export function isHoleOccupied(
  wires: readonly CircuitWire[],
  ref: TerminalRef,
  pending?: TerminalRef | null,
): boolean {
  if (occupiedHoles(wires, ref.componentId).has(ref.terminalId)) return true;
  // A wire being drawn has already claimed its first hole even though no wire exists yet.
  return Boolean(pending && pending.componentId === ref.componentId && pending.terminalId === ref.terminalId);
}

/**
 * Free holes electrically equivalent to this one, in canonical order.
 *
 * The point of a suggestion is that it does the same thing: "that hole is taken, these do
 * the same job". A hole from another group would be a different circuit.
 */
export function freeHolesInSameGroup(
  wires: readonly CircuitWire[],
  ref: TerminalRef,
  pending?: TerminalRef | null,
  limit = 4,
): string[] {
  const taken = occupiedHoles(wires, ref.componentId);
  if (pending?.componentId === ref.componentId) taken.add(pending.terminalId);
  return holesInSameGroup(ref.terminalId)
    .filter((id) => id !== ref.terminalId && !taken.has(id))
    .slice(0, limit);
}

/** What a screen reader is told about the hole the student is on. */
export function holeAnnouncement(
  wires: readonly CircuitWire[],
  ref: TerminalRef,
  pending?: TerminalRef | null,
): string {
  const description = connectedGroupDescription(ref.terminalId) ?? ref.terminalId;
  const state = isHoleOccupied(wires, ref, pending) ? 'Occupied' : 'Available';
  return `${description}. ${state}.`;
}
