/**
 * How many terminals a circuit would have, and whether that is allowed.
 *
 * The compiler has always enforced `NETLIST_LIMITS.maxTerminals`, but only after the fact:
 * you could add a component, mutate the project, and only then be told the circuit was too
 * big to compile. That was tolerable when the largest part had 25 terminals. A breadboard
 * has 400, so a project can go from fine to unbuildable in a single drop, and the refusal
 * has to happen *before* anything is mutated.
 *
 * This is the one calculation both paths use — the authoring guard in the renderer and the
 * check applied to a loaded file — so a project that could not be created also cannot be
 * opened, and the two can never disagree about the arithmetic.
 *
 * The limit itself is not raised. It is a real constraint on how much the worker is asked
 * to hold, and four breadboards do not fit inside it. That is the honest answer rather than
 * a number moved to make a feature fit.
 */
import type { ComponentKind } from '@offline-arduino/contracts/circuit';
import { NETLIST_LIMITS } from '../netlist-compiler';
import { getComponentDefinition } from './component-registry';

/** Terminals a single instance of `kind` contributes, or 0 for an unknown kind. */
export function terminalCountForKind(kind: ComponentKind): number {
  return getComponentDefinition(kind)?.terminals.length ?? 0;
}

/** Terminals contributed by a set of placed components. */
export function terminalCountFor(components: readonly { kind: ComponentKind }[]): number {
  return components.reduce((total, c) => total + terminalCountForKind(c.kind), 0);
}

export interface TerminalBudget {
  /** Terminals the circuit has now. */
  current: number;
  /** Terminals it would have after the proposed addition. */
  proposed: number;
  limit: number;
  withinLimit: boolean;
  /** Beginner-readable refusal, or null when the addition fits. */
  message: string | null;
}

/**
 * Whether `kind` can be added to `components` without exceeding the terminal limit.
 *
 * Returns the arithmetic as well as the verdict so the message can show a student the three
 * numbers that matter rather than an opaque "too big".
 */
export function checkTerminalBudget(
  components: readonly { kind: ComponentKind }[],
  kind: ComponentKind,
): TerminalBudget {
  const current = terminalCountFor(components);
  const added = terminalCountForKind(kind);
  const proposed = current + added;
  const limit = NETLIST_LIMITS.maxTerminals;
  const withinLimit = proposed <= limit;

  return {
    current,
    proposed,
    limit,
    withinLimit,
    message: withinLimit
      ? null
      : `Adding this would need ${proposed} connection points, and a circuit can have at most ${limit}. ` +
        `This circuit already uses ${current}. Remove something first, or use a smaller circuit.`,
  };
}

/** Whether an already-assembled circuit is inside the limit — used when loading a file. */
export function checkLoadedTerminalBudget(
  components: readonly { kind: ComponentKind }[],
): TerminalBudget {
  const current = terminalCountFor(components);
  const limit = NETLIST_LIMITS.maxTerminals;
  const withinLimit = current <= limit;

  return {
    current,
    proposed: current,
    limit,
    withinLimit,
    message: withinLimit
      ? null
      : `This project needs ${current} connection points and the limit is ${limit}. ` +
        `It cannot be opened without removing components.`,
  };
}
