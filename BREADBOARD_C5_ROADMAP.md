# Breadboard C5 — component-terminal attachment

## Purpose

Breadboard C5 covers one capability, taken through every layer it touches: **a component's
terminal plugged directly into a breadboard hole**, rather than reaching that hole through a
jumper wire.

That single idea spans the data model (how an attachment is recorded), validation (whether a
recorded attachment is legal), electrical compilation (what it means for connectivity),
authoring (how a student creates one), persistence (how it survives a save and reload),
physical placement (whether the geometry is possible), and rendering (how it is drawn in 2D
and 3D). The layers were deliberately separated so that no checkpoint could ship a capability
that was half-true — for example, a stored attachment the simulator ignores, which would not
be an incomplete circuit but a wrong one.

This file is the authoritative record of that series. It exists because the decomposition
previously lived only in review conversations, which cost three separate sessions of
rediscovery.

## Accepted checkpoints

| Slice | Scope | Commit |
| --- | --- | --- |
| C5.1 | Dormant attachment data model and schema groundwork | `ef7bb7869a2ebd0f95af32122d8ae71db611b82b` |
| C5.2 | Attachment validation | `71c11b8de98e414ecd09cdf117bbdd0d3aff91bc` |
| C5.3 | Netlist compilation of valid attachments | `4724bffe4ef0eab541a00fc2d51c7aa830400c7c` |
| C5.4 | Roadmap and status reconciliation (documentation only) | `81e79c01aeda3c79ad13ccfaf7637f90159cceb3` |

C5.4 carries the subject `docs(breadboard): reconcile C5 roadmap and status`. It changed no
type, schema, constant, export or runtime path; its purpose was to bring three drifted
documentation claims back into line with the code and to write this file. It is **completed,
accepted, and merged into `main`** — it is not in progress, and no part of this series is
currently executing.

Each of C5.1–C5.4 was independently audited and accepted. **They must not be rewritten,
amended or rebased merely to update documentation.** Correcting a stale comment is a new
commit, never an edit to an accepted one: the audit trail is worth more than a tidy history.
This document is itself maintained that way — the corrections below are a new commit, not an
edit to C5.4.

## Current capability

What exists today, precisely:

- Circuit and project schema support remains **v1/v2**. The current written version is **v2**
  for both: `CURRENT_PROJECT_SCHEMA_VERSION` and `CURRENT_CIRCUIT_SCHEMA_VERSION` are `2`, and
  `SUPPORTED_PROJECT_SCHEMA_VERSIONS` and `SUPPORTED_CIRCUIT_SCHEMA_VERSIONS` are `[1, 2]`.
- Schema-v3 **types and migrations remain dormant**. `TerminalAttachment`, the optional
  `CircuitComponent.terminalAttachments` record, `componentSchemaV3`,
  `projectCircuitSchemaV3`, `projectFileSchemaV3`, `ProjectFileV3`, `migrateProjectV2ToV3` and
  `migrateProjectToV3` are all defined and tested. None is reachable from a production path.
- Attachment **validation** exists. `validateBreadboardAttachments` decides referential and
  physical legality — that the terminal is real, the target is a breadboard, the hole exists,
  and no wire or other lead already occupies that exact opening.
- Valid attachments **compile into electrical nets**. The netlist compiler unions a valid
  attachment's terminal with its hole, alongside wires and the registry's permanently-common
  terminals.
- Invalid attachments produce `INVALID_ATTACHMENT` compiler diagnostics and **do not alter
  connectivity**. The rest of the circuit still compiles.
- Attachment **authoring does not exist**. No path in the renderer writes
  `terminalAttachments`; the field is admitted by the store's component type and written by
  nothing.
- Attachment **persistence does not exist**. The active IPC, preload, DTO, save and load paths
  are all v1/v2. `parseProjectFile` returns v2, `ProjectFile` resolves to the v2 type, and the
  IPC DTO declares `1 | 2`.
- **Direct component-lead placement remains unavailable** to users.
- **Breadboard circuits remain usable in 2D**, including jumper wiring, hole occupancy
  feedback and free-hole suggestions.
- **3D breadboard interaction remains gated.** A project containing a breadboard opens in 2D.

## How attachment data would be lost today

The hazard is real but its location was previously recorded imprecisely, so it is set out here
in full. This section describes **current behaviour only**. No guard against this loss exists
in the codebase today.

The sequence, in the order a save actually travels:

1. **Renderer snapshot passes component objects wholesale.** `snapshotProject` in
   `apps/desktop/src/renderer/app/project-bridge.ts` copies `state.circuit.components` by
   reference into the outgoing DTO. Any field a component carries — including
   `terminalAttachments` — travels with it.
2. **Preload passes the DTO through.** `apps/desktop/src/preload/preload.ts` forwards the
   object to `ipcRenderer.invoke` verbatim. It performs no validation.
3. **The type system does not protect this boundary.** `ProjectFileDTO.circuit` in
   `apps/desktop/src/preload/electron-api-types.ts` is typed `unknown`, so no compile error can
   arise from carrying a v3-shaped circuit across the process boundary.
4. **The first load-bearing strip happens at the IPC boundary.** In
   `apps/desktop/src/main/ipc/register-ipc.ts`, the raw save request is parsed through
   `saveProjectRequestSchema`, which validates the project against the active v1/v2 schema
   union. `componentSchemaV2` has no `terminalAttachments` key, and a zod object drops unknown
   keys rather than rejecting them — so the field is removed here, and the parse **succeeds**.
5. **A second strip can occur in the writer.** `writeProjectFile` in
   `apps/desktop/src/main/projects/project-service.ts` parses the project again through
   `projectFileSchemaV2` before serializing. Reached through IPC this is redundant, because
   step 4 has already removed the field.
6. **A guard placed only inside the writer would be insufficient for IPC saves.** By the time
   `writeProjectFile` runs, the evidence may already have been stripped, so such a guard could
   never fire on the path that matters. Any future loss-prevention check must inspect the raw
   request before the active schema union parses it.
7. **The dangerous case is a v3-shaped circuit labelled v2.** That combination passes every
   active check, loses the attachment data, and reports a successful save — no error, no
   warning, no diagnostic.
8. **A correctly versioned v3 project is refused loudly.** The active schema union contains
   only v1 and v2, so a file or request declaring `schemaVersion: 3` fails to parse, and
   `parseProjectFile` returns an explaining message rather than a partially understood project.
   Honest refusal is the current behaviour for a correctly labelled v3 file; silent loss is the
   current behaviour for a mislabelled one.

## Remaining capability boundaries

These are the capabilities still outstanding, in dependency order. Listing them here records
what is *known to remain*; it does not schedule them, assign slice numbers, or imply that any
implementation authorization exists.

The previous revision of this list presented authoring ahead of persistence, which contradicted
its own warning that the two must not be separated in that direction. The order below is
corrected against the code, and the rules are stated explicitly rather than left implied.

1. **Loss prevention must come before authoring.** Before any attachment authoring can be
   enabled, the application must prevent attachment-bearing data from being silently saved
   through a format that cannot represent it. As set out above, such a check has to act on the
   raw save request at the IPC boundary; a writer-only check would not fire. This prerequisite
   is deliberately left unnumbered and unnamed here: recording that it is required is not the
   same as authorizing it, and no such guard is implemented.
2. **Direct component-lead authoring and schema-v3 persistence/IPC activation form one
   coordinated capability boundary.** They must be planned together — contracts, the active
   schema union, the version constants, the writer, the parser, the main project service, the
   IPC DTO, the preload surface, the renderer store and the compiler's supported-version guard.
   **Authoring must never become active while persistence remains incapable of lossless round
   trips.** Physical lead-spacing rules belong to this boundary, since a claim the geometry
   cannot support must not be storable.
3. **2D attachment visualisation and editing** — drawing a lead in its hole, and removing or
   moving it. This comes after safe authoring and persistence exist, not alongside them.
4. **3D attachment rendering, and reconsideration of the breadboard 3D production gate.** Only
   after the dependencies above pass. The gate is removed by the checkpoint that can honestly
   replace it, and not before.

The precise sub-slice decomposition, file allowlists and acceptance criteria for all of the
above require **separate owner authorization**.

## Unresolved maintenance decisions

Two packaged artifacts sit outside the layers above and are recorded here so that a future
activation boundary does not discover them late. Neither is changed by this document.

- `resources/schemas/circuit.schema.json` currently describes **schema v1**, uses restrictive
  additional-property handling, is packaged with the application, and appears to be
  unreferenced by active application code. It therefore already does not describe v2.
- The bundled example circuits under `resources/examples/` currently use **schema v1** and are
  migrated through the supported readers when opened, which is why they continue to work.

Whether the packaged JSON schema is maintained, replaced, or removed **requires a separate
owner decision**. This document does not make it.

## Protected boundaries

Future work in this series must protect:

- The accepted C5.1–C5.4 commits.
- Existing wire routing and its regression coverage, including the clearance fallback.
- Terminal-budget accounting. An attachment is a connection, not a terminal; it must not
  change the terminal count or the `maxTerminals` limit.
- Production-gate behaviour, until the slice that explicitly removes it.
- The coupled `BREADBOARD_3D_NOTICE` tests described below.
- Package manifests, lockfiles, configuration and version files, unless separately authorized.
- Component Library and other concurrently reserved workstreams.

### The 3D gate notice is coupled to two test files

`BREADBOARD_3D_NOTICE` is asserted in both `apps/desktop/tests/breadboard-3d-integration.test.tsx`
and `apps/desktop/tests/breadboard-authoring.test.tsx`. Each file checks it twice: that the
rendered text equals the constant, and that the explanation names why 3D is unavailable.

That coupling is intentional — it is what stops the notice drifting into a claim that is no
longer true, which is exactly what happened when it promised delivery "in the next milestone"
and stayed on screen across four of them. A future change to that copy must preserve both
kinds of check: the exact constant/rendered-text equality, and a tested explanation of the
reason. It does not follow that every copy change requires a behavioural change; the wording
may be revised freely so long as both assertions continue to hold.

## Naming clarification

**Breadboard C5 is not `RENDER-C5`.** `implementation_plan.md` contains an unrelated entry —
`C5. On-demand rendering — audit F19` — belonging to the visual-fidelity plan, concerning
`frameloop="demand"` and `invalidate()`. The two series were numbered independently and share
nothing but a letter and a digit.

Refer to breadboard work as **BREADBOARD-C5** and to the render-loop work as **RENDER-C5**;
never as bare "C5". The implementation plan is not edited by this slice.

## Status of this document

This file documents dependencies, boundaries and risks. It is a record, not a mandate.
Explicitly, it:

- **does not authorize implementation** of any capability described in it;
- **does not schedule or assign the next slice**, and assigns no slice number to the
  loss-prevention prerequisite;
- **does not activate schema v3**, and moves no version constant;
- **does not enable** attachment authoring, attachment persistence, 2D attachment editing, or
  3D breadboard interaction;
- **requires a separate owner-approved implementation contract and file allowlist** before any
  of the remaining work begins.

Nothing recorded here should be read as permission. A capability becomes real when a checkpoint
implements it, is validated, and is accepted — not when this file describes what it would take.
