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
| C5.4 | Roadmap and status reconciliation | this documentation-only slice |

Each of C5.1–C5.3 was independently audited and accepted. **They must not be rewritten,
amended or rebased merely to update documentation.** Correcting a stale comment is a new
commit, never an edit to an accepted one: the audit trail is worth more than a tidy history.

## Current capability

What exists today, precisely:

- Attachment structures exist **only** as dormant schema-v3 groundwork. `TerminalAttachment`
  and the optional `CircuitComponent.terminalAttachments` record are defined, and
  `componentSchemaV3` / `projectCircuitSchemaV3` / `projectFileSchemaV3` can validate and
  migrate a v3 file.
- Attachment **validation** exists. `validateBreadboardAttachments` decides referential and
  physical legality — that the terminal is real, the target is a breadboard, the hole exists,
  and no wire or other lead already occupies that exact opening.
- Valid attachments **compile into electrical nets**. The netlist compiler unions a valid
  attachment's terminal with its hole, alongside wires and the registry's permanently-common
  terminals.
- Invalid attachments produce `INVALID_ATTACHMENT` compiler diagnostics and **do not alter
  connectivity**. The rest of the circuit still compiles.
- Active project files, persistence, IPC and authoring remain on **schema v2**.
  `parseProjectFile` returns v2, `ProjectFile` resolves to the v2 type, the IPC DTO declares
  `1 | 2`, and both `CURRENT_PROJECT_SCHEMA_VERSION` and `CURRENT_CIRCUIT_SCHEMA_VERSION` are
  `2`.
- **Users cannot currently create or persist a terminal attachment.** No authoring path
  writes one, and the v2 writer would strip the field if one appeared.
- **3D breadboard interaction remains gated.** A project containing a breadboard opens in 2D.
- **Jumper-wire breadboard workflows remain fully available in 2D**, including hole occupancy
  feedback and free-hole suggestions.

## Remaining capability boundaries

These are the capabilities still outstanding, in dependency order. Listing them here records
what is *known to remain*; it does not schedule them, assign slice numbers, or imply that any
implementation authorization exists.

1. **Direct lead-placement authoring and physical-spacing rules** — creating an attachment
   through the interface, and deciding whether a part's lead spacing can physically reach the
   holes it claims.
2. **Schema-v3 activation with lossless project persistence and IPC** — writing, reading,
   migrating and transmitting attachments without loss.
3. **2D attachment visualisation and editing** — drawing a lead in its hole, and removing or
   moving it.
4. **3D attachment rendering and removal of the breadboard 3D gate.**

**Authoring and persistence must be scoped together**, or otherwise designed so that
attachment data cannot be silently stripped. The hazard is concrete: the save path validates
with the v2 schema, and a zod object drops unknown keys rather than rejecting them, so an
attachment held in memory under a v2 writer would vanish on save with no error shown.

The precise sub-slice decomposition, file allowlists and acceptance criteria for all of the
above require **separate owner authorization**.

## Protected boundaries

Future work in this series must protect:

- The accepted C5.1–C5.3 commits.
- Existing wire routing and its regression coverage, including the clearance fallback.
- Terminal-budget accounting. An attachment is a connection, not a terminal; it must not
  change the terminal count or the `maxTerminals` limit.
- Production-gate behaviour, until the slice that explicitly removes it.
- Package manifests, lockfiles and version files, unless separately authorized.
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
