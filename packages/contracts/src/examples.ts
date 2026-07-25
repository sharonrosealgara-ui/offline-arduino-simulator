/**
 * Offline starter-library manifest contract.
 * Source: UI_CANVAS_AND_PACKAGING_SPEC.md §10.
 *
 * index.json holds only summarized records for fast card rendering. The application
 * validates a full manifest and circuit before opening an editable copy.
 */

export interface OfflineExampleManifest {
  schemaVersion: 1;
  id: string;
  title: string;
  summary: string;
  difficulty: 'beginner' | 'intermediate';
  estimatedMinutes: number;
  board: 'uno';
  concepts: string[];
  learningObjectives: string[];
  source: 'Sketch.ino';
  circuit: 'circuit.json';
  requiredLibraries: string[];
  expectedBehavior: string;
  wiringChecklist: string[];
  predictPrompt: string;
  observePrompt: string;
  tryNext: string[];
  supportedSince: string;
}

/** A compact card record from resources/examples/index.json. */
export interface OfflineExampleSummary {
  id: string;
  title: string;
  summary: string;
  difficulty: OfflineExampleManifest['difficulty'];
  estimatedMinutes: number;
  concepts: string[];
}
