/**
 * Registers every IPC handler behind sender validation + runtime schema parsing.
 * Source: setup spec §9.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { compileRequestSchema, cancelRequestSchema } from '@offline-arduino/contracts/compiler-schema';
import { CompilerService } from '../compiler/compiler-service';
import { validateSender } from './validate-sender';
import { IPC_CHANNELS } from './channels';
import { saveProject, saveProjectAs, openProjectDialog, listExamples, openExampleCopy } from '../projects/project-service';
import { saveProjectRequestSchema } from '../projects/project-schema';
import { getInstallGuideContent, getUserGuideContent } from '../help/install-guide';

const service = new CompilerService();

function requireValidSender(event: IpcMainInvokeEvent): void {
  if (!validateSender(event.senderFrame)) {
    throw new Error('Unauthorized IPC sender');
  }
}

export function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.compilerCompile, async (event, raw) => {
    try {
      requireValidSender(event);
    } catch (err) {
      console.warn('Rejected compilerCompile from sender:', (event && (event as any).senderFrame?.url) ?? '<unknown>', String(err));
      throw err;
    }
    console.log('IPC: compilerCompile invoked from', (event as any).senderFrame?.url ?? '<unknown>');
    const parsed = compileRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const maybeRequestId = (raw as { requestId?: unknown } | undefined)?.requestId;
      const maybeRevision = (raw as { sourceRevision?: unknown } | undefined)?.sourceRevision;
      return {
        ok: false,
        requestId: typeof maybeRequestId === 'string' ? maybeRequestId : 'invalid',
        sourceRevision: typeof maybeRevision === 'number' ? maybeRevision : 0,
        boardId: 'uno',
        errorCode: 'INVALID_REQUEST',
        message: 'The compilation request is invalid.',
        diagnostics: [],
        durationMs: 0,
      };
    }
    return await service.compile(parsed.data);
  });

  ipcMain.handle(IPC_CHANNELS.compilerCancel, (event, requestId: unknown) => {
    requireValidSender(event);
    const parsed = cancelRequestSchema.safeParse(requestId);
    if (!parsed.success) return false;
    return service.cancel(parsed.data);
  });

  // Save and Save As are genuinely different verbs, so they are genuinely different calls.
  // They used to be two handlers that did the same thing, which is why Save could only ever
  // ask for a destination it already knew.
  ipcMain.handle(IPC_CHANNELS.projectSave, async (event, request: unknown) => {
    requireValidSender(event);
    const parsed = saveProjectRequestSchema.parse(request);
    return await saveProject(parsed.project, parsed.sourcePath);
  });

  ipcMain.handle(IPC_CHANNELS.projectSaveAs, async (event, request: unknown) => {
    requireValidSender(event);
    const parsed = saveProjectRequestSchema.parse(request);
    return await saveProjectAs(parsed.project, parsed.sourcePath);
  });

  ipcMain.handle(IPC_CHANNELS.projectOpen, async (event) => {
    requireValidSender(event);
    return await openProjectDialog();
  });

  ipcMain.handle(IPC_CHANNELS.examplesList, async (event) => {
    requireValidSender(event);
    return await listExamples();
  });

  ipcMain.handle(IPC_CHANNELS.examplesOpenCopy, async (event, exampleId: unknown) => {
    requireValidSender(event);
    if (typeof exampleId !== 'string' || exampleId.length > 64) {
      throw new Error('Invalid example id.');
    }
    return await openExampleCopy(exampleId);
  });

  ipcMain.handle(IPC_CHANNELS.helpGetInstallGuide, async (event) => {
    requireValidSender(event);
    return await getInstallGuideContent();
  });

  ipcMain.handle(IPC_CHANNELS.helpGetUserGuide, async (event) => {
    requireValidSender(event);
    return await getUserGuideContent();
  });
}
