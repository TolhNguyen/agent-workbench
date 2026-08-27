# Agent Workbench

This repository is both the Agent Workbench Core and the user's working
workspace. Open this repository root in the agent harness.

## First actions

1. Run the installed `awb profile status` command, or `node bin/awb.js profile
   status` from this repository root. If it reports that onboarding is not
   complete, interview the user with the questions it returns before starting
   any task, then record the answers with `node bin/awb.js profile complete`.
   Do not guess who the user is or which skills apply.
2. Identify or create the task being performed.
3. Use `node bin/awb.js task context <task-id>` only when structured context is
   needed.
4. Treat `core/`, `bin/`, `schemas/`, and `test/` as protected Core code unless
   the task explicitly targets Agent Workbench development.
5. User-managed code, documents, tests, and other assets belong under `src/` or
   are registered there as external source references.
6. Respect task read and write scopes. Do not write to a related project merely
   because it is readable.
7. Never store passwords, tokens, cookies, or other credentials in task,
   knowledge, memory, profile, artifacts, or logs.
8. Read full knowledge content only after selecting a relevant knowledge ID.
9. External provider recall is optional and explicit. Use only provider
   resources bound to a task project; provider output is not canonical.
10. Record reusable observations as memory proposals. Promote them only after
   user approval.
11. Register task outputs as artifacts and verify them before closing the task.
12. A harness may create its own native instruction file at the repository root.

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
