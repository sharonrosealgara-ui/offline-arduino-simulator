/**
 * The temporary refusal that keeps an unrenderable breadboard out of the workspace.
 *
 * The v2 schema and its parser can validate a project containing a breadboard, and they
 * should: the format is frozen and the compiler and registry are already correct about it.
 * What does not exist yet is any way to SEE one. C2 has not built the 2D rendering or the
 * interaction, and C3 has not built the 3D geometry — so a breadboard loaded today would be
 * an invisible component that the student cannot select, cannot wire and cannot delete,
 * whose holes would silently reach a 3D renderer that has no geometry for them.
 *
 * An invisible component that changes a circuit's electrical behaviour is worse than a
 * refusal, so this refuses. It lives at the application's load boundary rather than inside
 * the schema, because the schema's job is "is this file valid" and this is "can this build
 * show it to you" — two different questions with two different lifetimes. When C2 lands,
 * this file is deleted; the schema is untouched by that.
 *
 * Nothing here mutates state. Callers check the verdict first and only then load.
 */
import type { ProjectFileDTO } from '../../preload/electron-api-types';

export type ProjectLoadVerdict = { ok: true } | { ok: false; reason: string };

/** Components carried by a project DTO, whatever version it is. */
function componentsOf(project: ProjectFileDTO): { kind?: unknown }[] {
  const circuit = project.circuit as { components?: unknown } | null | undefined;
  return Array.isArray(circuit?.components) ? (circuit.components as { kind?: unknown }[]) : [];
}

/**
 * Whether this build can actually open the project.
 *
 * Pure. Returns a verdict; it never touches the store, so a refusal cannot leave a
 * half-loaded project behind.
 */
export function canLoadProject(project: ProjectFileDTO): ProjectLoadVerdict {
  const breadboards = componentsOf(project).filter((c) => c.kind === 'breadboard').length;
  if (breadboards > 0) {
    return {
      ok: false,
      reason:
        `This project contains ${breadboards === 1 ? 'a breadboard' : `${breadboards} breadboards`}, ` +
        'which this version cannot display yet. Breadboard authoring arrives in the next update. ' +
        'Your file has not been changed — open it again once the update is installed.',
    };
  }
  return { ok: true };
}
