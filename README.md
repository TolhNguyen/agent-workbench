# Agent Workbench 0.3

Agent Workbench is one self-hosted Git repository that represents the user's
working point of view. Open this repository root in Codex, Claude Code,
Antigravity, or another filesystem-capable agent harness.

The same root contains:

- the small deterministic Workbench Core;
- the user's profile, roles, skills, workflows, and approved knowledge;
- task contracts and verified output records;
- every managed source, Git submodule, or portable external-source reference.

Core itself has no server, database, semantic index, MCP server, or harness
adapter. Version 0.3 adds a small Knowledge Provider Interface so an optional
external read-only recall service can be called explicitly without becoming
canonical state.

## Ready after unzip or clone

This repository is already an initialized workspace. Do not create a second
workspace outside it.

```bash
cd Agent-Workbench
node bin/awb.js validate
node bin/awb.js profile build
```

To publish an extracted copy as a new repository:

```bash
git init
git add .
git commit -m "Initialize Agent Workbench"
git branch -M main
git remote add origin <agent-workbench-repository-url>
git push -u origin main
```

Add existing development repositories as submodules after this initial commit.

Requirements:

- Node.js 20 or newer
- no third-party packages

## Repository layout

```text
Agent-Workbench/
├── .awb/                    workspace identity
├── core/                    Workbench implementation
├── bin/                     CLI entry point
├── schemas/                 portable JSON contracts
├── docs/                    Core specification
├── user/                    user profile and principles
├── roles/                   roles added directly by ID
├── skills/                  skills added directly by ID
├── workflows/               workflows added directly by ID
├── projects/                project registry
├── relationships/           project relationships
├── knowledge/               approved knowledge and optional providers
├── work/                    tasks, artifacts, proposals
├── profile/                 generated HTML profile
└── src/                     user-managed sources only (not committed)
```

Normal user tasks must not modify `core/`, `bin/`, `schemas/`, or `test/`.

## Source modes

### Managed source

Use for documentation projects or source that belongs to this Git repository:

```bash
node bin/awb.js project add hvh-user-guides \
  --name "HVH User Guides" \
  --path src/hvh-user-guides \
  --mode managed \
  --create
```

### Git submodule

Use when a development source already has its own Git repository:

```bash
git submodule add <frontend-repository-url> src/HVH_FRONTEND_REACT

node bin/awb.js project add hvh-frontend-react \
  --name "HVH Frontend React" \
  --path src/HVH_FRONTEND_REACT \
  --mode submodule \
  --repo <frontend-repository-url>
```

Clone a Workbench with its source repositories using:

```bash
git clone --recurse-submodules <agent-workbench-repository-url>
```

### External source

Use when a source must remain outside the Workbench directory:

```bash
node bin/awb.js project add legacy-app \
  --name "Legacy App" \
  --external-path "D:\\Projects\\LegacyApp" \
  --repo <legacy-repository-url>
```

The command creates:

```text
src/legacy-app.source.json                 portable and committed
src/.external/legacy-app.local.json        machine-local and ignored by Git
src/<any-other-source>/                    working directory, ignored by Git
```

Resolve the effective source location with:

```bash
node bin/awb.js project resolve legacy-app
```

## Project relationships

```bash
node bin/awb.js relation add \
  hvh-user-guides documents hvh-frontend-react \
  --description "The user guide documents the marketing account UI"
```

Relationships are directed, typed, and returned with task context. Related
projects are not silently added to a task's write scope.

## Create a constrained CS documentation task

```bash
node bin/awb.js task create \
  --id TASK-CS-GUIDE-001 \
  --title "Advertising account end-user guide" \
  --objective "Create a Word guide with real screenshots" \
  --audience end-user \
  --role cs \
  --primary hvh-user-guides \
  --project hvh-user-guides \
  --project hvh-frontend-react \
  --browser https://dev.hvh.hvnet.vn \
  --read project:hvh-user-guides \
  --read project:hvh-frontend-react \
  --write project:hvh-user-guides/marketing-accounts \
  --deliverable docx \
  --deliverable markdown \
  --quality-gate render-docx \
  --quality-gate check-sensitive-data \
  --constraint "Do not modify DEV source" \
  --constraint "Do not persist login credentials"
```

Get compact context without loading full knowledge bodies:

```bash
node bin/awb.js task context TASK-CS-GUIDE-001
```

Task access scopes use:

```text
project:<project-id>
project:<project-id>/<allowed-subdirectory>
```

Core code cannot be added as a task write scope because it is not a registered
project under `src/`.

## Register and verify outputs

After generating and visually checking the document:

```bash
node bin/awb.js artifact add TASK-CS-GUIDE-001 \
  --project hvh-user-guides \
  --path marketing-accounts/docs/guide.docx \
  --kind docx \
  --verified \
  --verification-note "Rendered pages inspected"

node bin/awb.js artifact add TASK-CS-GUIDE-001 \
  --project hvh-user-guides \
  --path marketing-accounts/docs/guide.md \
  --kind markdown \
  --verified

node bin/awb.js task gate-pass TASK-CS-GUIDE-001 render-docx
node bin/awb.js task gate-pass TASK-CS-GUIDE-001 check-sensitive-data
node bin/awb.js task verify TASK-CS-GUIDE-001
node bin/awb.js task close TASK-CS-GUIDE-001
```

A task cannot close normally while a deliverable, artifact file, artifact
verification, or quality gate is missing.

## Knowledge and learning

Search returns compact metadata and snippets:

```bash
node bin/awb.js knowledge search "advertising account"
```

Full content requires an explicit read:

```bash
node bin/awb.js knowledge read <knowledge-id>
```

Agent-discovered experience enters as a proposal:

```bash
node bin/awb.js memory propose \
  --task TASK-CS-GUIDE-001 \
  --scope project:hvh-user-guides \
  --title "End-user documentation audience" \
  --text "Confirm the audience before choosing internal or end-user content."

node bin/awb.js memory approve <proposal-id> \
  --knowledge-id hvh-guides.confirm-audience
```

## Optional TencentDB Agent Memory provider

Workbench remains the source of truth in Git. TencentDB Agent Memory can be an
optional derived recall/index layer; Workbench calls MemoryKnowledge directly
and does not use MemoryProxy or change the model settings of Codex, Claude Code,
or Antigravity.

Register a local MemoryKnowledge v3 endpoint:

```bash
node bin/awb.js provider add tencent-local \
  --type tencentdb-agent-memory \
  --knowledge-url http://127.0.0.1:8424/v3 \
  --core-url http://127.0.0.1:8420 \
  --service-id default
```

If the deployment needs a user key, store only its environment-variable name:

```bash
node bin/awb.js provider add tencent-secure \
  --knowledge-url https://memory.example.com/v3 \
  --core-url https://memory-core.example.com \
  --service-id my-team \
  --knowledge-auth-env AWB_TENCENT_USER_KEY \
  --core-auth-env AWB_TENCENT_CORE_KEY
```

The values of these variables are read at runtime and are never written to
Workbench. MemoryKnowledge receives the user key; MemoryCore receives its API
key as a Bearer token. URLs containing usernames or passwords are rejected.

Bind a Tencent wiki or code-graph knowledge resource to a registered project:

```bash
node bin/awb.js provider bind tencent-local \
  --project hvh-frontend-react \
  --knowledge-id <tencent-knowledge-id>
```

The binding appears as a compact reference in task context; no network call is
made by `task context`. Recall is explicit and bounded:

```bash
node bin/awb.js provider recall "advertising account validation" \
  --project hvh-frontend-react \
  --limit 8
```

Discover and call MemoryKnowledge's read-only tools directly when needed:

```bash
node bin/awb.js provider tools tencent-local \
  --knowledge-id <tencent-knowledge-id>

node bin/awb.js provider call tencent-local read_page \
  --knowledge-id <tencent-knowledge-id> \
  --params '{"refs":["page-ref"]}'
```

When MemoryCore is configured, recall its bounded L1/L2/L3 context explicitly:

```bash
node bin/awb.js provider memory-recall tencent-local \
  "What did we decide about account validation?" \
  --session-key TASK-CS-GUIDE-001 \
  --user-id <memory-user-id>
```

Workbench does not capture conversations into MemoryCore automatically in 0.3.
This avoids silently exporting user or source content; capture can be added as
an explicit reviewed workflow later.

Provider output is not trusted durable knowledge. To retain a useful result,
create a candidate with source provenance and use the existing approval flow:

```bash
node bin/awb.js provider propose tencent-local \
  --scope project:hvh-frontend-react \
  --title "Advertising account validation behavior" \
  --source-ref <tencent-knowledge-id> \
  --source-tool search \
  --text "Reviewed observation to retain"

node bin/awb.js memory approve <proposal-id> \
  --knowledge-id hvh-frontend.account-validation
```

The provider integration follows the TencentDB Agent Memory v2
MemoryKnowledge `/v3/tools/list` and `/v3/tools/call` contract. It is optional;
all Workbench commands continue to work without TencentDB Agent Memory.

## Upgrade from 0.2

Run once from an existing Workbench 0.2 root:

```bash
node bin/awb.js migrate
node bin/awb.js validate
```

The migration adds `knowledge/providers.json` and updates registry format
markers without rewriting knowledge bodies, projects, tasks, or artifacts.

## Git policy

Commit:

- Core, schemas, and documentation;
- profile, role, skill, workflow, and approved knowledge changes;
- project and relationship registries;
- managed sources;
- `.gitmodules` and submodule commit pointers;
- portable external-source descriptors;
- task and artifact records when they are useful history.

Do not commit:

- machine-local external paths;
- sessions, temporary files, and logs;
- passwords, tokens, cookies, or credentials;
- generated profile HTML unless it is intentionally deployed.

For large Word documents and screenshots, Git LFS can be enabled by the user;
it is not required by Core.

## Commands

```text
awb validate
awb migrate
awb project add|list|relations|resolve
awb relation add|list
awb task create|list|context|gate-pass|verify|close
awb artifact add|list
awb knowledge add|list|read|search
awb memory propose|list|approve|reject
awb provider add|list|bind|enable|disable|status|tools|call|search|recall|memory-recall|propose
awb profile build
```

Every command supports `--json` for machine-readable output.

## Development

```bash
node --test
npm run check
```

See [docs/CORE_SPEC.md](docs/CORE_SPEC.md) for the normative Core contract and
[docs/MIGRATION_0.3.md](docs/MIGRATION_0.3.md) for upgrade details. Provider
behavior and token boundaries are described in
[docs/KNOWLEDGE_PROVIDERS.md](docs/KNOWLEDGE_PROVIDERS.md).
