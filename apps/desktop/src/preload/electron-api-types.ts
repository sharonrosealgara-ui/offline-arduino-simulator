/**
 * Dependency-free type definitions for the preload bridge surface. This file imports
 * NOTHING from 'electron' or main/* — it exists specifically so the renderer's ambient
 * declaration (electron-api.d.ts) can describe `window.electronAPI` without pulling the
 * real preload implementation (and its Electron imports) into the renderer's TS
 * program. preload.ts implements this same interface.
 */
import type { CompileRequest, CompileResult } from '@offline-arduino/contracts/compiler';
import type { OfflineInstallGuide } from '@offline-arduino/contracts/help';

export interface ProjectFileDTO {
  /** 1 for legacy files, 2 for current. Main migrates v1 on read; the renderer emits v2. */
  schemaVersion: 1 | 2;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  boardId: 'uno';
  sources: Record<string, string>;
  circuit: unknown;
}

export interface ExampleIndexEntryDTO {
  id: string;
  title: string;
  summary: string;
  difficulty: 'beginner' | 'intermediate';
  estimatedMinutes: number;
  concepts: string[];
}

/**
 * How a save ended. Dismissing the dialog is a normal outcome and says so; only genuine
 * disk or serialization failures reject the call.
 */
export type SaveOutcomeDTO = { status: 'saved'; path: string } | { status: 'cancelled' };

export interface ElectronAPI {
  compile(request: CompileRequest): Promise<CompileResult>;
  cancelCompile(requestId: string): Promise<boolean>;
  /**
   * Ordinary Save. Writes straight to `sourcePath` when main granted that path this
   * session (an opened or previously saved project); otherwise asks where to put it.
   */
  saveProject(project: ProjectFileDTO, sourcePath: string | null): Promise<SaveOutcomeDTO>;
  /** Save As. Always asks for a destination, even when `sourcePath` is set. */
  saveProjectAs(project: ProjectFileDTO, sourcePath: string | null): Promise<SaveOutcomeDTO>;
  openProject(): Promise<{ path: string; project: ProjectFileDTO } | null>;
  listExamples(): Promise<ExampleIndexEntryDTO[]>;
  openExampleCopy(exampleId: string): Promise<ProjectFileDTO>;
  getInstallGuide(): Promise<OfflineInstallGuide>;
  /** Bundled universal user guide markdown (resources/docs/USER_GUIDE.md). */
  getUserGuide(): Promise<string>;
}
