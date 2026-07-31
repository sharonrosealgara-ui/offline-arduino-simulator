/**
 * On-disk project file schema. Persists source + component placement/properties + wire
 * endpoints/colors/waypoints + explicit junctions ONLY — never registers, runtime
 * voltages, frames, compiled HEX, LCD/servo transient state, or terminal output.
 * Source: FRONTEND_AND_SIMULATOR_WORKER_SPEC.md §16.
 */
import { z } from 'zod';

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

const terminalRefSchema = z.object({
  componentId: z.string().min(1).max(128),
  terminalId: z.string().min(1).max(64),
});

const componentSchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.enum(['uno-r3', 'led', 'resistor', 'pushbutton', 'potentiometer', 'lcd1602', 'servo']),
  x: z.number().finite(),
  y: z.number().finite(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  label: z.string().max(64),
  properties: z.record(z.union([z.string().max(200), z.number().finite(), z.boolean()])),
});

const wireSchema = z.object({
  id: z.string().min(1).max(128),
  from: terminalRefSchema,
  to: terminalRefSchema,
  colorRole: z.enum(['vcc-red', 'ground-black', 'signal-yellow', 'signal-blue', 'signal-green', 'signal-orange', 'signal-purple']),
  waypoints: z.array(pointSchema).max(64),
});

const junctionSchema = z.object({
  id: z.string().min(1).max(128),
  wireIds: z.array(z.string().min(1).max(128)).max(16),
  point: pointSchema,
});

export const projectCircuitSchema = z.object({
  schemaVersion: z.literal(1),
  components: z.array(componentSchema).max(250),
  wires: z.array(wireSchema).max(500),
  junctions: z.array(junctionSchema).max(250),
});

export const projectFileSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string().min(1).max(128),
  name: z.string().max(200),
  createdAt: z.string(),
  updatedAt: z.string(),
  boardId: z.literal('uno'),
  sources: z.record(z.string().max(1_048_576)), // relative filename -> text, e.g. "Sketch.ino"
  circuit: projectCircuitSchema,
});

export type ProjectFile = z.infer<typeof projectFileSchema>;

/**
 * The payload of a save request.
 *
 * `sourcePath` is the file the renderer believes the project already lives in — a hint, not
 * an authority: project-service only writes to it without a dialog when it is a path main
 * itself granted this session. Validated here so a malformed or oversized value is rejected
 * at the IPC boundary rather than reaching the filesystem.
 */
export const saveProjectRequestSchema = z.object({
  project: projectFileSchema,
  sourcePath: z.string().min(1).max(4096).nullable().default(null),
});

export type SaveProjectRequest = z.infer<typeof saveProjectRequestSchema>;
