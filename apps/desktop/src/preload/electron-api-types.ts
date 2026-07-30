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
  schemaVersion: 1;
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

export interface ElectronAPI {
  compile(request: CompileRequest): Promise<CompileResult>;
  cancelCompile(requestId: string): Promise<boolean>;
  /** Resolves with the written path, or null if the student dismissed the save dialog. */
  saveProject(project: ProjectFileDTO): Promise<{ path: string } | null>;
  saveProjectAs(project: ProjectFileDTO): Promise<{ path: string } | null>;
  openProject(): Promise<{ path: string; project: ProjectFileDTO } | null>;
  listExamples(): Promise<ExampleIndexEntryDTO[]>;
  openExampleCopy(exampleId: string): Promise<ProjectFileDTO>;
  getInstallGuide(): Promise<OfflineInstallGuide>;
  /** Bundled universal user guide markdown (resources/docs/USER_GUIDE.md). */
  getUserGuide(): Promise<string>;
}
