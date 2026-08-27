# Workflow: Feature Delivery

1. `awb task create` with the role, projects, deliverables, and quality gates.
2. `awb task context <task-id>` to load scoped context.
3. Build the change inside the task write scope.
4. Verify: run the tests and read the output.
5. `awb artifact add` for each deliverable, with `--verified` once checked.
6. `awb task gate-pass` for each quality gate.
7. `awb task verify`, then `awb task close`.
8. `awb memory propose` for anything reusable that was learned.
