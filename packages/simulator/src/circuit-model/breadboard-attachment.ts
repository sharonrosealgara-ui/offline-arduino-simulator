/**
 * Whether a circuit's breadboard attachments are legal — referentially and physically.
 *
 * C5.1 gave a component terminal a way to say "I am plugged into that hole"
 * (`CircuitComponent.terminalAttachments`). It validates the *shape* of that claim: the kind
 * literal, non-empty ids, one entry per terminal. What a per-field schema cannot see is
 * whether the board exists, whether the terminal is real, or whether something else is
 * already in the hole. Those are facts about a whole circuit, and this is where they are
 * decided.
 *
 * DORMANT. Nothing calls this yet. It exists so the invariants are written and proven before
 * anything can author an attachment, rather than improvised alongside the UI that creates
 * them — an attachment that reaches live state without these checks is a wrong circuit, not
 * merely an untidy one.
 *
 * WHY IT LIVES HERE. Terminal validation needs the trusted component registry, which lives in
 * this package; hole identity needs the breadboard model, which lives in contracts. Simulator
 * depends on contracts, never the reverse, so this is the lowest layer that can legally reach
 * both. `terminal-budget.ts` sits beside it for exactly the same reason.
 *
 * PHYSICAL, NOT ELECTRICAL. A hole is a hole. `A1` and `B1` are on one strip and are
 * electrically common, but they are two openings and both can hold a lead. `breadboardGroupIdForHole`
 * is deliberately never consulted here: what shares a net is the compiler's business, what
 * shares an opening is this file's.
 */
import type { CircuitComponent, CircuitWire } from '@offline-arduino/contracts/circuit';
import { breadboardHoleIds } from '@offline-arduino/contracts/breadboard';
import { getComponentDefinition } from './component-registry';

export type AttachmentIssueCode =
  /** The record key names a terminal the source component's definition does not declare. */
  | 'SOURCE_TERMINAL_UNKNOWN'
  /** A breadboard's 400 holes exist so wires can land in them; a board has no lead of its own. */
  | 'SOURCE_MAY_NOT_BE_BREADBOARD'
  /** A component plugged into itself. */
  | 'SELF_ATTACHMENT'
  /** No component in the circuit carries the recorded `breadboardId`. */
  | 'TARGET_COMPONENT_MISSING'
  /** The target resolves, but it is some other kind of part. */
  | 'TARGET_NOT_A_BREADBOARD'
  /** The recorded hole is not one of the board's real openings. */
  | 'TARGET_HOLE_UNKNOWN'
  /** A wire endpoint already occupies that exact opening. */
  | 'HOLE_TAKEN_BY_WIRE'
  /** Another component's lead already occupies that exact opening. */
  | 'HOLE_TAKEN_BY_LEAD';

export interface AttachmentIssue {
  code: AttachmentIssueCode;
  /** The component that owns the attachment record. Always resolvable — see below. */
  componentId: string;
  /** The attachment record's key. */
  terminalId: string;
  /** Reported as recorded, even when it resolves to nothing. */
  breadboardId: string;
  /** Reported as recorded, even when it is not a real hole. */
  holeId: string;
  /** What was already in the hole. Present only on the two occupancy codes. */
  conflictsWith?:
    | { kind: 'wire'; wireId: string }
    | { kind: 'lead'; componentId: string; terminalId: string };
}

export interface AttachmentValidation {
  ok: boolean;
  issues: readonly AttachmentIssue[];
}

/**
 * What this does NOT re-check, because the C5.1 contract already guarantees it.
 *
 *  - The source component exists. The record is a property *of* that component, so reaching
 *    it proves it. Deleting the source deletes its records with it; there is no such thing as
 *    a dangling source. Only `breadboardId` is an outward reference, and only it can dangle.
 *  - The kind is registered. `REGISTRY` is declared `Record<ComponentKind, ComponentDefinition>`
 *    and `componentSchemaV3` parses `kind` through `z.enum(PROJECT_KINDS_V3)`, so an
 *    unrecognised kind cannot arrive without a deliberate cast.
 *  - A terminal appears once per component. A `Record` cannot hold one key twice; JavaScript
 *    resolves that before this function is ever called.
 *
 * Adding codes for those would be validating the type system rather than the circuit.
 */

/** Locale-independent, byte-stable. `localeCompare` would order differently per machine. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** One terminal's claim on one opening, after every referential check has passed. */
interface LeadClaim {
  componentId: string;
  terminalId: string;
  breadboardId: string;
  holeId: string;
}

/**
 * The 400 legal hole ids, built once.
 *
 * `breadboardHoleIds()` rebuilds the whole model per call, and this is asked once per
 * attachment. Lazy rather than eager so importing the module costs nothing.
 */
let holeIdCache: Set<string> | null = null;
function isRealHole(holeId: string): boolean {
  if (holeIdCache === null) holeIdCache = new Set(breadboardHoleIds());
  return holeIdCache.has(holeId);
}

/**
 * Wire endpoints indexed by the opening they occupy.
 *
 * Nested rather than a `boardId + separator + holeId` string key: no schema forbids a
 * separator character inside an id, so a flat key could collide two different openings into
 * one and silently invent — or hide — a conflict.
 *
 * A `Set` of wire ids, not a count: a wire whose two endpoints name the same opening occupies
 * it once, and must be reported once.
 */
function indexWireEndpoints(wires: readonly CircuitWire[]): Map<string, Map<string, Set<string>>> {
  const index = new Map<string, Map<string, Set<string>>>();
  for (const wire of wires) {
    for (const endpoint of [wire.from, wire.to]) {
      let byHole = index.get(endpoint.componentId);
      if (!byHole) {
        byHole = new Map<string, Set<string>>();
        index.set(endpoint.componentId, byHole);
      }
      let wireIds = byHole.get(endpoint.terminalId);
      if (!wireIds) {
        wireIds = new Set<string>();
        byHole.set(endpoint.terminalId, wireIds);
      }
      wireIds.add(wire.id);
    }
  }
  return index;
}

/** Total order over issues, so a shuffled circuit yields a byte-identical array. */
function compareIssues(a: AttachmentIssue, b: AttachmentIssue): number {
  return (
    cmp(a.componentId, b.componentId) ||
    cmp(a.terminalId, b.terminalId) ||
    cmp(a.code, b.code) ||
    cmp(a.breadboardId, b.breadboardId) ||
    cmp(a.holeId, b.holeId) ||
    // Absent sorts first: '' precedes both 'lead' and 'wire'.
    cmp(a.conflictsWith?.kind ?? '', b.conflictsWith?.kind ?? '') ||
    cmp(
      a.conflictsWith?.kind === 'wire' ? a.conflictsWith.wireId : (a.conflictsWith?.componentId ?? ''),
      b.conflictsWith?.kind === 'wire' ? b.conflictsWith.wireId : (b.conflictsWith?.componentId ?? ''),
    ) ||
    cmp(
      a.conflictsWith?.kind === 'lead' ? a.conflictsWith.terminalId : '',
      b.conflictsWith?.kind === 'lead' ? b.conflictsWith.terminalId : '',
    )
  );
}

/**
 * Every way this circuit's attachments are illegal.
 *
 * Pure: nothing here writes to a component, a wire, an attachment or a nested object, and
 * nothing throws for an ordinary bad reference — a project naming a deleted board is invalid
 * data, not a programming error, and the caller needs to be told which claim is wrong rather
 * than handed an exception.
 *
 * Independent problems are all reported. Dependent ones are not: a claim whose target does
 * not exist gets `TARGET_COMPONENT_MISSING` alone, because "and the hole is unknown" is an
 * artefact of the first failure and would send a reader after the wrong thing. Each
 * attachment therefore contributes at most one pre-occupancy issue.
 */
export function validateBreadboardAttachments(circuit: {
  components: readonly CircuitComponent[];
  wires: readonly CircuitWire[];
}): AttachmentValidation {
  const issues: AttachmentIssue[] = [];
  const byId = new Map(circuit.components.map((c) => [c.id, c]));
  const claims: LeadClaim[] = [];

  for (const component of circuit.components) {
    const attachments = component.terminalAttachments;
    if (!attachments) continue;

    for (const [terminalId, attachment] of Object.entries(attachments)) {
      const at = {
        componentId: component.id,
        terminalId,
        breadboardId: attachment.breadboardId,
        holeId: attachment.holeId,
      };

      if (component.kind === 'breadboard') {
        issues.push({ code: 'SOURCE_MAY_NOT_BE_BREADBOARD', ...at });
        continue;
      }
      const definition = getComponentDefinition(component.kind);
      if (!definition?.terminals.some((t) => t.id === terminalId)) {
        issues.push({ code: 'SOURCE_TERMINAL_UNKNOWN', ...at });
        continue;
      }
      if (attachment.breadboardId === component.id) {
        issues.push({ code: 'SELF_ATTACHMENT', ...at });
        continue;
      }
      const target = byId.get(attachment.breadboardId);
      if (!target) {
        issues.push({ code: 'TARGET_COMPONENT_MISSING', ...at });
        continue;
      }
      if (target.kind !== 'breadboard') {
        issues.push({ code: 'TARGET_NOT_A_BREADBOARD', ...at });
        continue;
      }
      if (!isRealHole(attachment.holeId)) {
        issues.push({ code: 'TARGET_HOLE_UNKNOWN', ...at });
        continue;
      }
      claims.push(at);
    }
  }

  // Occupancy runs only over claims that survived every referential check above.
  //
  // Claims are ordered before ownership is assigned, so which lead is treated as the one
  // already in the hole is a property of the circuit and not of the order the components
  // happened to arrive in.
  const wireIndex = indexWireEndpoints(circuit.wires);
  const ordered = [...claims].sort(
    (a, b) =>
      cmp(a.componentId, b.componentId) ||
      cmp(a.terminalId, b.terminalId) ||
      cmp(a.breadboardId, b.breadboardId) ||
      cmp(a.holeId, b.holeId),
  );
  const canonical = new Map<string, Map<string, LeadClaim>>();

  for (const claim of ordered) {
    const wireIds = wireIndex.get(claim.breadboardId)?.get(claim.holeId);
    if (wireIds) {
      for (const wireId of [...wireIds].sort(cmp)) {
        issues.push({ code: 'HOLE_TAKEN_BY_WIRE', ...claim, conflictsWith: { kind: 'wire', wireId } });
      }
    }

    let byHole = canonical.get(claim.breadboardId);
    if (!byHole) {
      byHole = new Map<string, LeadClaim>();
      canonical.set(claim.breadboardId, byHole);
    }
    const first = byHole.get(claim.holeId);
    if (!first) {
      byHole.set(claim.holeId, claim);
      continue;
    }
    issues.push({
      code: 'HOLE_TAKEN_BY_LEAD',
      ...claim,
      conflictsWith: { kind: 'lead', componentId: first.componentId, terminalId: first.terminalId },
    });
  }

  issues.sort(compareIssues);
  return { ok: issues.length === 0, issues };
}
