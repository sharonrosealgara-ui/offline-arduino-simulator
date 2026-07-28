/**
 * Bridges a ProjectFile DTO (from the main process) into the Zustand store, and back.
 * Keeps the store the single source of truth for serializable project state.
 */
import type { ProjectFileDTO } from '../../preload/electron-api-types';
import type { ProjectCircuit } from '@offline-arduino/contracts/circuit';
import { useAppStore } from '../state/store';

const MAIN_SOURCE = 'Sketch.ino';

export function loadProjectIntoStore(project: ProjectFileDTO): void {
  const sketch = project.sources[MAIN_SOURCE] ?? Object.values(project.sources)[0] ?? '';
  const circuit = (project.circuit as ProjectCircuit) ?? { schemaVersion: 1, components: [], wires: [], junctions: [] };

  useAppStore.setState((state) => ({
    project: {
      ...state.project,
      projectId: project.projectId,
      name: project.name,
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
  }));
}

export function snapshotProject(): ProjectFileDTO {
  const state = useAppStore.getState();
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    projectId: state.project.projectId === 'draft' ? crypto.randomUUID() : state.project.projectId,
    name: state.project.name,
    createdAt: now,
    updatedAt: now,
    boardId: 'uno',
    sources: { [MAIN_SOURCE]: state.project.sketch },
    circuit: {
      schemaVersion: 1,
      components: state.circuit.components,
      wires: state.circuit.wires,
      junctions: state.circuit.junctions,
    },
  };
}
