# Agent Workbench Core Specification

Status: Draft 0.3  
Format version: `0.3`

## 1. Product model

An Agent Workbench is one self-hosted repository. The repository is both:

1. the implementation and standard used to manage the Workbench; and
2. the user's working environment containing experience and related sources.

An agent harness opens the Workbench root. It does not open one source directly.

The Core is harness-neutral. A harness may create its native instruction file
at the root, but such files are not required canonical data.

## 2. Invariants

1. Canonical state lives beneath one Workbench root.
2. The root is identified by `.awb/workspace.json`.
3. Core implementation lives in `core/`, never in `src/`.
4. `src/` is reserved for sources managed or referenced by the user.
5. Roles, skills, and workflows are added directly by ID; no `custom/` layer
   exists.
6. A task owns its role, projects, audience, access scope, deliverables, and
   quality gates.
7. Every write scope resolves to a registered project; normal tasks cannot write
   Core code.
8. Context output returns metadata and references by default.
9. Full knowledge content requires an explicit read.
10. Agent-discovered learning remains a proposal until approved.
11. Task outputs are registered as artifacts and verified before task closure.
12. Credentials are runtime-only and must never enter canonical state.
13. Generated HTML is a view, never canonical data.
14. External providers are optional, explicit, bounded read-only recall sources.
15. Provider output remains derived data until it passes the memory proposal
    approval lifecycle.

## 3. Standard directories

| Purpose | Location |
| --- | --- |
| Workspace identity | `.awb/workspace.json` |
| Core implementation | `core/` |
| CLI | `bin/awb.js` |
| Schemas | `schemas/` |
| User profile | `user/PROFILE.md` |
| Roles | `roles/<role-id>/` |
| Skills | `skills/<skill-id>/` |
| Workflows | `workflows/<workflow-id>/` |
| Projects | `projects/index.json` |
| Relationships | `relationships/index.json` |
| Knowledge registry | `knowledge/index.json` |
| Knowledge bodies | `knowledge/items/<knowledge-id>.md` |
| Knowledge providers | `knowledge/providers.json` |
| Tasks | `work/tasks/<task-id>.json` |
| Artifacts | `work/artifacts/index.json` |
| Memory proposals | `work/proposals/<proposal-id>.json` |
| Generated profile | `profile/index.html` |
| User sources | `src/` |

## 4. Source model

Each project has one `sourceMode`.

### 4.1 Managed

`path` is a directory under `src/` tracked by the Workbench repository.

### 4.2 Submodule

`path` is a Git submodule under `src/`. Git owns submodule initialization;
Core records and resolves the project but does not run Git commands.

### 4.3 External

The portable descriptor is committed at:

```text
src/<project-id>.source.json
```

The absolute path is stored at:

```text
src/.external/<project-id>.local.json
```

The local file must be ignored by Git. The portable descriptor may include a
repository URL but must not contain the machine-local absolute path.

## 5. Task contract

A task must declare at least one registered project and one primary project.

Normative fields:

- `primaryRole`
- `supportingRoles`
- `primaryProject`
- `projects`
- `audience`
- `browserTargets`
- `readScopes`
- `writeScopes`
- `deliverables`
- `qualityGates`
- `constraints`
- `doneWhen`
- `secretPolicy`

Access scope syntax:

```text
project:<project-id>
project:<project-id>/<relative-subdirectory>
```

Defaults:

- every task project is readable;
- only the primary project is writable;
- secret policy is `runtime-only`.

## 6. Project relationships

Relationships are directed and typed. Core does not impose a fixed relation
vocabulary. Examples:

- `calls-api`
- `publishes-event`
- `consumes-event`
- `shares-database`
- `depends-on`
- `documents`
- `deploys-with`

Task context includes relationships touching its projects. A neighbouring
project remains outside task scope until explicitly added.

## 7. Artifact lifecycle

An artifact belongs to:

- one task;
- one project in that task;
- one project-relative path;
- one deliverable kind.

Artifact registration is rejected when:

- the project is not in the task;
- the path is outside the task write scope;
- the project source is unavailable;
- the file does not exist;
- the target is not a file.

A task verifies successfully only when:

- every declared deliverable has at least one artifact of the same kind;
- every artifact file still exists;
- every artifact is marked verified;
- every quality gate is passed.

Normal task closure requires successful verification.

## 8. Knowledge lifecycle

```text
observation -> candidate proposal -> user approval -> indexed knowledge
```

`knowledge list` and `knowledge search` return compact metadata and snippets.
`knowledge read` returns the full Markdown body.

### 8.1 Knowledge Provider Interface

The canonical provider registry is `knowledge/providers.json`. Version 0.3
supports `tencentdb-agent-memory` as the first provider type.

A provider record may contain:

- non-secret HTTP endpoints;
- a service ID;
- an environment-variable name for runtime authentication;
- timeout and enabled state;
- project-to-knowledge-resource bindings.

A provider record must never contain the value of a credential. Endpoint URLs
must use HTTP or HTTPS and must not contain embedded credentials.

Provider bindings make retrieval scope explicit. `task context` returns compact
references for bindings whose projects are part of the task, but it performs no
network calls. Network retrieval requires an explicit `provider` command.

The TencentDB implementation calls MemoryKnowledge directly using:

- header `x-tdai-service-id`;
- `POST /v3/tools/list` with `knowledge_id`;
- `POST /v3/tools/call` with `knowledge_id`, `tool_name`, and `params`.

It may call MemoryCore directly using `POST /recall` with `query` and
`session_key`. MemoryKnowledge and MemoryCore credentials are separate runtime
environment variables; the Core credential is sent as a Bearer token.

Only the upstream read-only tool surface is used. Workbench does not require
MemoryProxy and does not alter a harness model provider, base URL, or routing.
Responses are bounded by timeout and size limits.

Version 0.3 performs no automatic conversation capture. This is intentional:
no user or source content leaves the Workbench merely because a provider is
registered.

Provider content that should become durable must follow:

```text
provider result -> candidate proposal with provenance -> user approval -> indexed knowledge
```

TencentDB Agent Memory is optional derived infrastructure. Provider failure must
not make Git-backed profile, roles, skills, workflows, tasks, projects, or
approved knowledge unavailable.

## 9. Security

Canonical or generated Workbench data must not contain:

- passwords;
- API tokens;
- cookies;
- private keys;
- session secrets;
- connection strings containing credentials.

Credentials supplied for a task exist only in the active harness context and
must not be copied into tasks, knowledge, proposals, artifacts, profile output,
or logs.

Provider registries may store an environment-variable name, but never the
variable's value. CLI output and generated profiles must not resolve or render
secret values.

Task access scope is a behavioral contract, not an operating-system sandbox.
High-risk systems must also use read-only accounts and native permission
controls.

Project-relative and workspace-relative paths are normalized with a single
separator convention before they are checked, and the resolved result must be
confirmed to sit inside its root. A path that leaves its root is rejected on
every platform, whichever separator was used to express it.

A provider that declares a credential environment variable and finds it unset
must fail before the request is issued, rather than send an unauthenticated one.

## 9a. Concurrency

Registry writes are atomic per file: content is written to a temporary file and
renamed into place, so a reader never sees a partial record.

Registry updates are not atomic as a whole. Every registry command reads,
modifies, and writes the file, so two Core commands running against one
workspace at the same time can lose one another's changes. Core is a
single-operator tool and does not lock; run its commands one at a time.

## 10. Git contract

The root Workbench is the primary Git repository.

Portable, durable state may be committed. Machine-local references, sessions,
temporary data, logs, generated views, and secrets must be ignored.

Project sources are not committed to the root repository. The only durable
state for a project is its registry entry and, for external sources, the
portable descriptor `src/<id>.source.json`, which names a project without
naming where its code lives on any one machine.

This has a consequence worth stating plainly: a managed source is a working
directory under `src/` that the root repository does not version. Anything that
needs history must be a submodule source, which keeps its own Git history, or
an external source living in its own repository. External sources are never
copied into the root repository.

## 11. Compatibility

`formatVersion` follows semantic compatibility:

- patch: clarification or validation correction;
- minor: backward-compatible fields or commands;
- major: incompatible layout or behavior.

Registries should preserve unknown properties during rewrites where practical.
Major migration must never occur silently.

Migration from format 0.2 to 0.3 is explicit through `awb migrate`. It adds the
empty provider registry, updates format markers, backfills defaults that later
versions require, and canonicalizes task and proposal identifiers to uppercase,
repointing artifacts, knowledge scopes, and proposal sources at the new names.
Knowledge bodies, roles, skills, workflows, project data, and artifact contents
are not transformed. Migration is idempotent.

The portable contracts in `schemas/` are enforced by `awb validate`, not merely
published alongside the data.
