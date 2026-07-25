/**
 * Runtime validation for IPC input. TypeScript types do NOT validate data crossing the
 * process boundary — the main process must parse every request with these schemas.
 * Source: OFFLINE_ARDUINO_SIMULATOR_SETUP_SPEC.md §6, §9.
 */
import { z } from 'zod';
import { BOARD_PROFILES, type BoardId } from './board-profiles';

const boardIds = Object.keys(BOARD_PROFILES) as [BoardId, ...BoardId[]];

/** Max source size before IPC: 1 MiB (setup spec §5.4). */
export const MAX_SOURCE_BYTES = 1_048_576;

/** RFC-4122-ish UUID; matches the pattern the compiler service enforces. */
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'requestId must be a UUID');

export const compileRequestSchema = z.object({
  requestId: uuid,
  boardId: z.enum(boardIds),
  source: z
    .string()
    .max(MAX_SOURCE_BYTES, 'source exceeds the 1 MiB limit'),
  sourceRevision: z.number().int().nonnegative(),
  sketchName: z.string().max(200).optional(),
});

export type CompileRequestInput = z.infer<typeof compileRequestSchema>;

export const cancelRequestSchema = z.string().max(64);
