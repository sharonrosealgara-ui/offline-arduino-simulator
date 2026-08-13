/**
 * What has to be true before a project may replace the workspace.
 *
 * C1B used this to refuse every project containing a breadboard, because nothing could draw
 * one. C2B can: the 2D renderer, the wiring integration and the 3D safety gate all exist, so
 * that blanket refusal is gone. What is left is the validation that was always needed and
 * still is — a project whose terminals exceed the compiler's limit can never be simulated,
 * so opening it would replace a working workspace with one that cannot run.
 *
 * A breadboard project is still kept out of the 3D view, but that is a *view* decision made
 * by the workspace (see `breadboardCount` below and `CircuitPane`), not a reason to refuse
 * the file. Loading it into 2D is correct and now supported.
 *
 * Nothing here mutates state. Callers check the verdict first and only then load.
 */
import type { ProjectFileDTO } from '../../preload/electron-api-types';
import type { ComponentKind } from '@offline-arduino/contracts/circuit';
import { checkLoadedTerminalBudget } from '@offline-arduino/simulator';

export type ProjectLoadVerdict = { ok: true } | { ok: false; reason: string };

/** Components carried by a project DTO, whatever version it is. */
export function componentsOf(project: ProjectFileDTO): { kind?: unknown; id?: unknown }[] {
  const circuit = project.circuit as { components?: unknown } | null | undefined;
  return Array.isArray(circuit?.components) ? (circuit.components as { kind?: unknown }[]) : [];
}

/** How many breadboards a project contains — what the 3D gate keys off. */
export function breadboardCount(project: ProjectFileDTO): number {
  return componentsOf(project).filter((c) => c.kind === 'breadboard').length;
}

/**
 * Whether this build can open the project.
 *
 * Pure. Returns a verdict and never touches the store, so a refusal cannot leave a
 * half-loaded project behind.
 */
export function canLoadProject(project: ProjectFileDTO): ProjectLoadVerdict {
  const kinds = componentsOf(project)
    .map((c) => c.kind)
    .filter((k): k is ComponentKind => typeof k === 'string')
    .map((kind) => ({ kind }));

  const budget = checkLoadedTerminalBudget(kinds);
  if (!budget.withinLimit) return { ok: false, reason: budget.message ?? 'This project is too large to open.' };

  return { ok: true };
}
