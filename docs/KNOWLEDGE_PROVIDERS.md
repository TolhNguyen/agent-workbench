# Knowledge Providers

Agent Workbench 0.3 separates canonical knowledge from optional recall engines.

## State model

| State | Owner | Git canonical | Loaded by task context |
| --- | --- | --- | --- |
| Approved Markdown | Workbench | Yes | Metadata only |
| Provider configuration | Workbench | Yes, without secrets | Matching binding only |
| Provider index/memory | External service | No | Never automatically |
| Imported candidate | Workbench proposal | Yes | No |

This model keeps the workspace portable while allowing a local or shared
retrieval engine to accelerate recall.

## Token and request behavior

- `task context` performs no provider request and returns only compact binding
  references.
- `provider list`, `bind`, `enable`, and `disable` consume no model token and
  make no provider request.
- `provider recall`, `search`, `tools`, `call`, and `memory-recall` make an HTTP
  request only when explicitly invoked.
- The CLI does not generate temporary read/write code. The agent calls the
  stable `awb` command and receives structured JSON.
- Search defaults to 10 results and is capped at 50. Provider responses have a
  2 MiB safety ceiling and a 10-second default timeout.
- A provider response costs model context only if the harness chooses to read
  that command output.

## TencentDB Agent Memory mapping

| Workbench operation | Tencent component | HTTP contract |
| --- | --- | --- |
| `provider tools` | MemoryKnowledge | `POST /v3/tools/list` |
| `provider call` | MemoryKnowledge | `POST /v3/tools/call` |
| `provider search` | MemoryKnowledge | Calls the read-only `search` tool |
| `provider recall` | MemoryKnowledge | Searches project-bound knowledge IDs |
| `provider memory-recall` | MemoryCore | `POST /recall` |
| `provider status` | Both configured services | `GET /health` |

MemoryProxy is deliberately outside this integration. Codex, Claude Code, and
Antigravity continue to use their own model configuration.

## Credential boundary

The registry can contain `knowledgeEnv` and `coreEnv`, which are names of
environment variables. Their values are resolved only during the request.

- MemoryKnowledge user key: `x-tdai-user-key`.
- MemoryCore gateway key: `Authorization: Bearer ...`.
- Both services receive `x-tdai-service-id`.

Never place actual keys in `knowledge/providers.json`, task files, proposals,
logs, source descriptors, or command arguments that will be recorded.

## Promotion boundary

Recall does not write approved knowledge. A reviewed result follows:

```text
provider output
  -> awb provider propose
  -> work/proposals/<id>.json (candidate + provenance)
  -> awb memory approve
  -> knowledge/items/<id>.md + knowledge/index.json
```

Reject the proposal when the external result is stale, project-specific in the
wrong scope, sensitive, or not verified.

## Provider implementation contract

`core/providers.js` is the provider boundary. A future provider type should
implement the same operations where applicable:

- normalize and validate non-secret configuration;
- health probe;
- discover read-only tools;
- call a read-only tool;
- bounded search or recall;
- runtime-only authentication;
- normalized JSON result or a safe error.

Adding another provider type is a Core change. Adding projects, roles, skills,
workflows, knowledge items, or provider bindings is ordinary horizontal
workspace growth and requires no `custom/` directory.
