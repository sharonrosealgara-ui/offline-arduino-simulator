/**
 * On-disk project file schema. Persists source + component placement/properties + wire
 * endpoints/colors/waypoints + explicit junctions ONLY — never registers, runtime
 * voltages, frames, compiled HEX, LCD/servo transient state, or terminal output.
 * Source: FRONTEND_AND_SIMULATOR_WORKER_SPEC.md §16.
 *
 * TWO VERSIONS, TWO REAL READERS
 * ------------------------------
 * Version 2 exists for exactly one reason: a project may now contain a `breadboard`, and a
 * build that predates it would silently drop or mis-handle that component. The version bump
 * is what makes an older reader refuse the file instead of guessing.
 *
 * The v1 reader is preserved and still rejects `breadboard`. That matters: if both versions
 * shared one permissive kind list the bump would be decoration — a v1 file could carry a v2
 * component and nothing would notice. The two readers are built from two separate frozen
 * kind lists, and the only difference between them is that one entry.
 *
 * Nothing else changes across the version. No lead-insertion field, no occupancy field, no
 * 3D placeholder: unused structure in a file format is a promise the code has not made.
 */
import { z } from 'zod';
import { PROJECT_KINDS_V1, PROJECT_KINDS_V2 } from '@offline-arduino/contracts/circuit';

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

const terminalRefSchema = z.object({
  componentId: z.string().min(1).max(128),
  terminalId: z.string().min(1).max(64),
});

/** Everything about a component except which kinds are legal — that part is version-specific. */
const componentShape = {
  id: z.string().min(1).max(128),
  x: z.number().finite(),
  y: z.number().finite(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  label: z.string().max(64),
  properties: z.record(z.union([z.string().max(200), z.number().finite(), z.boolean()])),
};

const componentSchemaV1 = z.object({ ...componentShape, kind: z.enum(PROJECT_KINDS_V1) });
const componentSchemaV2 = z.object({ ...componentShape, kind: z.enum(PROJECT_KINDS_V2) });

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

const circuitShape = {
  wires: z.array(wireSchema).max(500),
  junctions: z.array(junctionSchema).max(250),
};

export const projectCircuitSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  components: z.array(componentSchemaV1).max(250),
  ...circuitShape,
});

export const projectCircuitSchemaV2 = z.object({
  schemaVersion: z.literal(2),
  components: z.array(componentSchemaV2).max(250),
  ...circuitShape,
});

const projectFileShape = {
  projectId: z.string().min(1).max(128),
  name: z.string().max(200),
  createdAt: z.string(),
  updatedAt: z.string(),
  boardId: z.literal('uno'),
  sources: z.record(z.string().max(1_048_576)), // relative filename -> text, e.g. "Sketch.ino"
};

export const projectFileSchemaV1 = z.object({
  ...projectFileShape,
  schemaVersion: z.literal(1),
  circuit: projectCircuitSchemaV1,
});

export const projectFileSchemaV2 = z.object({
  ...projectFileShape,
  schemaVersion: z.literal(2),
  circuit: projectCircuitSchemaV2,
});

export type ProjectFileV1 = z.infer<typeof projectFileSchemaV1>;
export type ProjectFileV2 = z.infer<typeof projectFileSchemaV2>;

/** The current on-disk shape. New saves are always this. */
export type ProjectFile = ProjectFileV2;

/**
 * Accepts either version, discriminating on the file-level `schemaVersion`.
 *
 * Discriminated rather than a plain union so a malformed v2 file reports *its own* errors
 * instead of the confusing "and it did not match v1 either" pair a bare union produces.
 */
export const projectFileSchema = z.discriminatedUnion('schemaVersion', [
  projectFileSchemaV1,
  projectFileSchemaV2,
]);

/** Versions this build can read. Anything else is refused rather than guessed at. */
export const SUPPORTED_PROJECT_SCHEMA_VERSIONS = [1, 2] as const;
export const CURRENT_PROJECT_SCHEMA_VERSION = 2;

/**
 * Raises a v1 project to v2.
 *
 * Pure and deterministic: same input, identical output, no clock and no id generation. It
 * changes the two version numbers and nothing else — components, wires, junctions, sources
 * and metadata are carried across by value, so a migrated project is the same project.
 *
 * A v1 file cannot contain a breadboard, because its reader rejects one, so there is nothing
 * to translate and nothing to default. When a future version genuinely changes what a
 * component means, that migration gets written then, against that change.
 */
export function migrateProjectV1ToV2(project: ProjectFileV1): ProjectFileV2 {
  return {
    ...project,
    schemaVersion: 2,
    circuit: { ...project.circuit, schemaVersion: 2 },
  };
}

export type ProjectParseResult =
  | { ok: true; project: ProjectFileV2; migratedFrom: 1 | null }
  | { ok: false; error: string };

/**
 * Reads a project file of any supported version and hands back a v2 one.
 *
 * The single entry point for loading, so "v1 files still work" is a property of one function
 * rather than of every call site remembering to migrate.
 */
export function parseProjectFile(input: unknown): ProjectParseResult {
  const version = (input as { schemaVersion?: unknown } | null)?.schemaVersion;

  if (typeof version === 'number' && !SUPPORTED_PROJECT_SCHEMA_VERSIONS.includes(version as 1 | 2)) {
    return {
      ok: false,
      error:
        `This project was saved in format version ${version}, which this version of the app cannot open. ` +
        `It reads versions ${SUPPORTED_PROJECT_SCHEMA_VERSIONS.join(' and ')}. Update the app and try again.`,
    };
  }

  const parsed = projectFileSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` at ${issue.path.join('.')}` : '';
    return { ok: false, error: `This project file is not valid${where}: ${issue?.message ?? 'unknown error'}` };
  }

  if (parsed.data.schemaVersion === 1) {
    return { ok: true, project: migrateProjectV1ToV2(parsed.data), migratedFrom: 1 };
  }
  return { ok: true, project: parsed.data, migratedFrom: null };
}

/**
 * The payload of a save request.
 *
 * `sourcePath` is the file the renderer believes the project already lives in — a hint, not
 * an authority: project-service only writes to it without a dialog when it is a path main
 * itself granted this session. Validated here so a malformed or oversized value is rejected
 * at the IPC boundary rather than reaching the filesystem.
 *
 * Either version is accepted at the boundary; the renderer always produces v2.
 */
export const saveProjectRequestSchema = z.object({
  project: projectFileSchema,
  sourcePath: z.string().min(1).max(4096).nullable().default(null),
});

export type SaveProjectRequest = z.infer<typeof saveProjectRequestSchema>;
