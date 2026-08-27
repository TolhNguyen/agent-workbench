# Migration to Agent Workbench 0.3

Version 0.3 adds an optional Knowledge Provider Interface. Git-backed Workbench
data remains canonical and the directory model is unchanged.

## Upgrade

From the Workbench root, replace the Core files with version 0.3 and run:

```bash
node bin/awb.js migrate
node bin/awb.js validate
node bin/awb.js profile build
```

The migration accepts format `0.2` and is safe to run again on format `0.3`.

## Files changed by migration

- `.awb/workspace.json`: `formatVersion` becomes `0.3`.
- `projects/index.json`: only the format marker changes.
- `relationships/index.json`: only the format marker changes.
- `knowledge/index.json`: only the format marker changes.
- `work/artifacts/index.json`: only the format marker changes.
- `knowledge/providers.json`: created with an empty provider list if missing.
- `work/tasks/*.json` and `work/proposals/*.json`: renamed to uppercase where
  needed, with `id` and missing defaults repaired.

Knowledge Markdown, roles, skills, workflows, source files, project data, and
artifact contents are not rewritten.

## Upgrading to 0.3.1

Task and memory-proposal identifiers are canonical uppercase. A workspace built
earlier may hold lowercase task files, which resolve on a case-insensitive
filesystem and disappear on a case-sensitive one. `awb migrate` repairs this:
it renames the files, rewrites each record's `id`, and repoints artifact
`taskId` values, `task:<id>` knowledge scopes, and proposal `sourceTask` values
at the new names. It also backfills `secretPolicy` on tasks and `sourceMode` on
projects. Running it again is a no-op.

If two files differ only by case -- possible only on a case-sensitive
filesystem -- migration stops and names both, because merging them is a
content decision rather than a rename.

`awb validate` now checks records against the contracts in `schemas/` in
addition to its own rules, so a workspace hand-edited into an invalid shape is
reported rather than accepted.

## Optional TencentDB provider

No provider is added automatically. Register one only when a MemoryKnowledge
service is available:

```bash
node bin/awb.js provider add tencent-local \
  --knowledge-url http://127.0.0.1:8424/v3 \
  --core-url http://127.0.0.1:8420 \
  --service-id default
```

Workbench communicates with MemoryKnowledge directly. MemoryProxy and harness
model-routing changes are not required.

For authenticated deployments, use `--knowledge-auth-env` and
`--core-auth-env`. Only those variable names are stored; their values remain in
the runtime environment.
