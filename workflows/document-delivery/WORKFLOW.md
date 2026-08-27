# Workflow: Document Delivery

1. `awb task create` with the technical-writer role and an explicit
   `--audience`.
2. `awb task context <task-id>` and read the project knowledge it names.
3. Perform the documented task in the real system before writing about it.
4. Write the document into the task write scope.
5. `awb artifact add` with `--kind` matching the declared deliverable.
6. `awb task gate-pass` for review and sensitive-data checks.
7. `awb task verify`, then `awb task close`.
