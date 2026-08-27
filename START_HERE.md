# Agent Workbench

This repository is both the Agent Workbench Core and the user's working
workspace. Open this repository root in the agent harness.

## First actions

1. Identify or create the task being performed.
2. Use `node bin/awb.js task context <task-id>` only when structured context is
   needed.
3. Treat `core/`, `bin/`, `schemas/`, and `test/` as protected Core code unless
   the task explicitly targets Agent Workbench development.
4. User-managed code, documents, tests, and other assets belong under `src/` or
   are registered there as external source references.
5. Respect task read and write scopes. Do not write to a related project merely
   because it is readable.
6. Never store passwords, tokens, cookies, or other credentials in task,
   knowledge, memory, profile, artifacts, or logs.
7. Read full knowledge content only after selecting a relevant knowledge ID.
8. External provider recall is optional and explicit. Use only provider
   resources bound to a task project; provider output is not canonical.
9. Record reusable observations as memory proposals. Promote them only after
   user approval.
10. Register task outputs as artifacts and verify them before closing the task.
11. A harness may create its own native instruction file at the repository root.

## Standard directories

- `.awb/`: workspace identity and format version.
- `core/`: Agent Workbench implementation; protected for normal user tasks.
- `user/`: stable user profile and working principles.
- `roles/`: role definitions added directly by role ID.
- `skills/`: reusable skills added directly by skill ID.
- `workflows/`: reusable workflows added directly by workflow ID.
- `projects/`: project registry.
- `relationships/`: typed relationships between projects.
- `knowledge/`: approved knowledge and optional provider bindings.
- `work/`: tasks, artifact records, and memory proposals.
- `profile/`: generated HTML profile.
- `src/`: user-managed sources and portable external-source descriptors.
