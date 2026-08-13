/**
 * Bridges a ProjectFile DTO (from the main process) into the Zustand store, and back.
 * Keeps the store the single source of truth for serializable project state.
 */
import type { ProjectFileDTO } from '../../preload/electron-api-types';
import { CURRENT_CIRCUIT_SCHEMA_VERSION, type ProjectCircuit } from '@offline-arduino/contracts/circuit';
import { useAppStore } from '../state/store';
import { breadboardCount, canLoadProject, type ProjectLoadVerdict } from './project-load-guard';

const MAIN_SOURCE = 'Sketch.ino';

/**
 * Replaces the workspace with `project`.
 *
 * `sourcePath` must be the file the project was read from, or null when it did not come
 * from a file — an example copy or a starter template exists only in memory until the
 * student saves it. It is passed explicitly rather than carried over from the previous
 * project because the status bar reads it as proof a file exists: leaving the outgoing
 * project's path in place would make an unsaved example claim to be "Saved" at the path of
 * whatever was open before it.
 */
export function loadProjectIntoStore(
  project: ProjectFileDTO,
  sourcePath: string | null = null,
): ProjectLoadVerdict & { switchedTo2D?: boolean } {
  // Checked before the first setState, so a refused project leaves the workspace exactly as
  // it was — no components, no sketch, no half-replaced document.
  const verdict = canLoadProject(project);
  if (!verdict.ok) return verdict;

  // A breadboard has no 3D geometry yet, so a project containing one goes into 2D. Decided
  // here, before the project is applied, so it is never transiently rendered in 3D.
  const breadboards = breadboardCount(project);

  const sketch = project.sources[MAIN_SOURCE] ?? Object.values(project.sources)[0] ?? '';
  const circuit = (project.circuit as ProjectCircuit) ?? { schemaVersion: CURRENT_CIRCUIT_SCHEMA_VERSION, components: [], wires: [], junctions: [] };

  useAppStore.setState((state) => ({
    project: {
      ...state.project,
      projectId: project.projectId,
      name: project.name,
      sourcePath,
      sketch,
      sourceRevision: state.project.sourceRevision + 1,
      dirty: false,
    },
    circuit: {
      components: circuit.components ?? [],
      wires: circuit.wires ?? [],
      junctions: circuit.junctions ?? [],
      selectedIds: [],
      pendingWireFrom: null,
      placementKind: null,
    },
    // Opening a project starts a fresh document; undo must not step back into the
    // previous project's topology.
    history: { past: [], future: [] },
    layout: breadboards > 0 ? { ...state.layout, viewportMode: '2d' as const } : state.layout,
  }));

  return { ok: true, switchedTo2D: breadboards > 0 };
}

export function snapshotProject(): ProjectFileDTO {
  const state = useAppStore.getState();
  const now = new Date().toISOString();
  return {
    schemaVersion: CURRENT_CIRCUIT_SCHEMA_VERSION,
    projectId: state.project.projectId === 'draft' ? crypto.randomUUID() : state.project.projectId,
    name: state.project.name,
    createdAt: now,
    updatedAt: now,
    boardId: 'uno',
    sources: { [MAIN_SOURCE]: state.project.sketch },
    circuit: {
      schemaVersion: CURRENT_CIRCUIT_SCHEMA_VERSION,
      components: state.circuit.components,
      wires: state.circuit.wires,
      junctions: state.circuit.junctions,
    },
  };
}
