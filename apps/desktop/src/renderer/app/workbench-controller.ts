/**
 * Orchestrates Verify / Run / Pause / Step / Reset / Stop across the compiler (IPC) and
 * the simulation worker. Implements the revision-safe Run sequence from
 * UI_CANVAS_AND_PACKAGING_SPEC.md §4.2.
 */
import type { CompileRequest } from '@offline-arduino/contracts/compiler';
import { compileNetlist } from '@offline-arduino/simulator';
import { useAppStore } from '../state/store';
import { useCompilerStore } from './state/compiler-store';
import { simulationClient } from '../simulation/simulation-client';
import { snapshotProject } from './project-bridge';

function currentCompileRequest(): CompileRequest {
  const state = useAppStore.getState();
  return {
    requestId: crypto.randomUUID(),
    boardId: 'uno',
    source: state.project.sketch,
    sourceRevision: state.project.sourceRevision,
    sketchName: 'Sketch.ino',
  };
}

/**
 * Compile the current sketch at its exact revision and record diagnostics. Returns ok.
 *
 * Routed through useCompilerStore.verify(source): the compiler-store drives the
 * idle -> compiling -> success | error status machine plus the output line and
 * error/warning counts, while a shared CompileFn tees every result into the central
 * app store (Monaco markers, Problems view, last valid HEX) exactly as before.
 * All failure paths resolve to `false` — never an unhandled rejection.
 */
export async function verify(): Promise<boolean> {
  const state = useAppStore.getState();
  const request = currentCompileRequest();

  return useCompilerStore.getState().verify(state.project.sketch, {
    boardId: request.boardId,
    sourceRevision: request.sourceRevision,
    compile: async (storeRequest) => {
      // Use the store-issued requestId so staleness checks agree in both stores.
      useAppStore.getState().actions.markCompileQueued(storeRequest.requestId);
      if (!window.electronAPI?.compile) {
        const failure = {
          ok: false as const,
          requestId: storeRequest.requestId,
          sourceRevision: storeRequest.sourceRevision,
          boardId: storeRequest.boardId,
          errorCode: 'INTERNAL_ERROR' as const,
          message: 'electronAPI.compile is not available',
          diagnostics: [],
          durationMs: 0,
        };
        console.error('electronAPI.compile is not available');
        useAppStore.getState().actions.applyCompileResult(failure);
        return failure;
      }
      try {
        console.log('Renderer: invoking electronAPI.compile', storeRequest.requestId);
        const result = await window.electronAPI.compile(storeRequest);
        console.log('Renderer: compile result', result.requestId, result.ok, result.ok ? null : result.errorCode);
        useAppStore.getState().actions.applyCompileResult(result);
        return result;
      } catch (err) {
        const failure = {
          ok: false as const,
          requestId: storeRequest.requestId,
          sourceRevision: storeRequest.sourceRevision,
          boardId: storeRequest.boardId,
          errorCode: 'INTERNAL_ERROR' as const,
          message: err instanceof Error ? err.message : String(err),
          diagnostics: [],
          durationMs: 0,
        };
        console.error('compile IPC failed', err);
        useAppStore.getState().actions.applyCompileResult(failure);
        return failure;
      }
    },
  });
}

/** Full Run sequence (spec §4.2). */
export async function run(): Promise<void> {
  const state = useAppStore.getState();

  // 1-2. Compile the exact current revision (unless we already have valid HEX for it).
  let hex = state.compiler.lastValidHex;
  if (state.compiler.lastValidRevision !== state.project.sourceRevision || !hex) {
    const request = currentCompileRequest();
    useAppStore.getState().actions.markCompileQueued(request.requestId);
    if (!window.electronAPI?.compile) {
      console.error('electronAPI.compile is not available');
      useAppStore.getState().actions.applyCompileResult({
        ok: false,
        requestId: request.requestId,
        sourceRevision: request.sourceRevision,
        diagnostics: [],
      });
      return;
    }
    let result;
    try {
      console.log('Renderer: invoking electronAPI.compile (run)', request.requestId);
      result = await window.electronAPI.compile(request);
      console.log('Renderer: compile result (run)', result.requestId, result.ok, result.ok ? null : result.errorCode);
    } catch (err) {
      console.error('compile IPC failed', err);
      useAppStore.getState().actions.applyCompileResult({
        ok: false,
        requestId: request.requestId,
        sourceRevision: request.sourceRevision,
        diagnostics: [],
      });
      return;
    }
    useAppStore.getState().actions.applyCompileResult(result);
    if (!result.ok) return; // a compile failure leaves the previous firmware stopped (spec §11)
    hex = result.hex;
  }
  if (!hex) return;

  // 3. Validate circuit topology.
  const project = snapshotProject();
  const netlist = compileNetlist({
    schemaVersion: 1,
    components: state.circuit.components,
    wires: state.circuit.wires,
    junctions: state.circuit.junctions,
  });
  useAppStore.getState().actions.setCircuitDiagnostics(netlist.diagnostics);
  if (netlist.diagnostics.some((d) => d.severity === 'fatal')) return;
  void project;

  // 4-6. Dispose the previous worker, create a fresh one, send netlist + HEX, start on READY.
  const performance = useAppStore.getState().simulation.performance;
  await simulationClient.initialize(netlist, performance);
  simulationClient.loadHex(hex, state.project.sourceRevision);
  simulationClient.start();
}

export function pause(): void {
  simulationClient.pause();
}
export function step(): void {
  simulationClient.step();
}
export function reset(): void {
  simulationClient.reset();
}
export function stop(): void {
  simulationClient.terminate();
  useAppStore.getState().actions.setSimulationPhase(null, 'empty', 0);
}

export async function saveProject(): Promise<void> {
  await window.electronAPI.saveProject(snapshotProject());
}
export async function openProject(): Promise<void> {
  const opened = await window.electronAPI.openProject();
  if (opened) {
    const { loadProjectIntoStore } = await import('./project-bridge');
    loadProjectIntoStore(opened.project);
  }
}
