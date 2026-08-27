# Onboarding and the Capability Catalog

Status: design, approved 2026-08-27. Targets Agent Workbench Core 0.4.0.

`formatVersion` stays `0.3`. Everything here is a backward-compatible addition:
new commands, and one optional property in `.awb/workspace.json` that older
Core ignores and newer Core reads as "incomplete" when absent. No migration
step is required, and `awb migrate` is unchanged.

## 1. Problem

A new workspace ships with an empty `user/PROFILE.md` and empty `roles/`,
`skills/`, and `workflows/` directories. Nothing requires the profile to be
filled in, nothing lists what capabilities exist, and nothing checks that a task
refers to a capability that is actually present:

```
$ awb task create --id T1 --role khong-co-that --skill cung-khong-co --project web
Task created: T1
$ awb validate
Workspace is valid.
```

Both commands succeed. `awb task context T1` then reports `Role:
khong-co-that` with no role files and no warning. An agent starting work in
this workspace has no way to discover which roles or skills exist, no signal
that the ones named are fictional, and no user profile to reason from, so it
guesses.

The default role is `developer`, which does not exist either. Every task created
with default options carries a dangling reference.

## 2. Goal

On first use of a workspace, the agent interviews the user about who they are
and what they work on, records the answers, and from then on routes work to
roles, skills, and workflows that demonstrably exist.

Non-goals: multi-user workspaces (one workspace per person), automatic skill
authoring, and any change to providers, artifacts, or migration.

## 3. Constraints

- **Core never prompts.** No command reads a TTY today; agent harnesses run the
  CLI with stdin closed, so an interactive wizard would hang or read EOF. The
  conversation belongs to the agent; Core supplies state, questions, and
  validation.
- **Harness-neutral.** The mechanism must work in any harness, so it cannot
  depend on one harness's instruction file.
- **Deterministic and testable.** Every new behaviour is reachable from the CLI
  with `--json` and asserted in `test/`.
- A protocol file alone is not enough. `START_HERE.md` is advisory; an agent
  that skips it must still be stopped. The gate has to live in Core.

## 4. Design

### 4.1 Capability catalog

Core ships a starter set so a fresh workspace has something to route to. These
are placeholders meant to be replaced, not a finished taxonomy.

```
roles/developer/{ROLE.md,DEFINITION_OF_DONE.md}
roles/reviewer/{ROLE.md,DEFINITION_OF_DONE.md}
roles/technical-writer/{ROLE.md,DEFINITION_OF_DONE.md}
skills/code-review/SKILL.md
skills/debugging/SKILL.md
skills/writing-user-guide/SKILL.md
workflows/feature-delivery/WORKFLOW.md
workflows/document-delivery/WORKFLOW.md
```

The content lives in `core/templates.js` beside `START_HERE` and `USER_PROFILE`,
and `initWorkspace` writes it with `overwrite: false`, matching how the existing
templates are handled. The files are also committed to this repository, because
the repository is itself an initialized workspace.

### 4.2 Discovery commands

```
awb role list|show <id>
awb skill list|show <id>
awb workflow list|show <id>
```

`list` returns the directory names; `show` returns the files inside one, using
the existing `listDirectDirectories` and `listFilesRecursively` helpers. With
`--json` the agent gets an exact catalog instead of guessing. The three groups
share one implementation parameterized by directory.

### 4.3 Reference validation

`createTask` rejects a `--role`, `--skill`, or `--workflow` whose directory does
not exist. The error names the available IDs rather than guessing at a
correction:

```
Error: Unknown role: khong-co-that. Available: developer, reviewer, technical-writer.
```

At most ten IDs are listed, followed by a count if more exist.

`validateWorkspace` reports dangling references on **active** tasks as errors
and on **closed** tasks as warnings. A capability deleted after a task closed is
a historical fact, not a defect to be fixed.

### 4.4 Onboarding state

`.awb/workspace.json` gains:

```json
"onboarding": { "complete": false, "completedAt": null }
```

A workspace without the key is treated as incomplete. `schemas/workspace.schema.json`
gains a matching optional property. `migrateWorkspace` does not backfill it:
absence already means incomplete, and the flag is set by completing onboarding,
never by migration.

### 4.5 `awb profile status`

Reports the gate and everything the agent needs to conduct the interview:

```json
{
  "complete": false,
  "profilePath": "user/PROFILE.md",
  "questions": [
    { "id": "name", "kind": "text", "required": true,
      "prompt": "What should I call you?" },
    { "id": "role", "kind": "choice", "required": true, "catalog": "roles",
      "prompt": "Which role best describes your main work here?" },
    { "id": "language", "kind": "text", "required": true,
      "prompt": "Which language should I write and talk to you in?" },
    { "id": "responsibilities", "kind": "list", "required": true,
      "prompt": "What are you responsible for day to day?" },
    { "id": "systems", "kind": "list", "required": false,
      "prompt": "Which systems, products, or codebases do you own or touch most?" },
    { "id": "skills", "kind": "list", "required": false, "catalog": "skills",
      "prompt": "Which of these skills do you expect to need regularly?" },
    { "id": "principles", "kind": "list", "required": false,
      "prompt": "How do you prefer work to be done? Anything I should always do?" },
    { "id": "constraints", "kind": "list", "required": false,
      "prompt": "Anything I must never do, or must ask you before doing?" }
  ],
  "catalog": { "roles": [...], "skills": [...], "workflows": [...] }
}
```

Question text lives in `core/templates.js` in English and is versioned with
Core. The agent asks in whatever language the user speaks; only the answers are
stored.

`kind` is `text`, `list`, or `choice`. A question carrying `catalog` must be
answered with IDs from that catalog.

`profile status` never fails on a missing or unreadable `user/PROFILE.md`: it is
the command the agent runs to find out whether the workspace is usable, so it
reports `complete: false` and continues.

### 4.6 `awb profile complete`

Core owns the write, so a half-filled profile cannot be recorded:

```
awb profile complete --name "..." --role developer --language vi
                     [--responsibility <text>]... [--system <text>]...
                     [--skill <id>]... [--principle <text>]... [--constraint <text>]...
                     [--replace]
```

`--name`, `--role`, and `--language` are required. `--role` and `--skill` are
validated against the catalog. The command writes `user/PROFILE.md` from the
answers in a stable structure and sets the onboarding flag.

It refuses to run, and names the reason, when either onboarding is already
complete or `user/PROFILE.md` no longer matches the shipped template. `--replace`
overrides both. The rule being enforced is "do not overwrite content Core did
not write", which covers the re-run case and the case where the user filled the
profile in by hand before the interview happened.

The recorded skills are advisory: they describe what this user usually
needs, and the agent uses them to pick sensible defaults. They are not applied
to tasks automatically; `awb task create --skill <id>` remains explicit.

### 4.7 The gate

`awb task create` fails while onboarding is incomplete:

```
Error: This workspace has no user profile yet. Run `awb profile status` and
complete the interview, or pass --skip-onboarding for a one-off task.
```

`--skip-onboarding` is the escape hatch for automation and for the Core
developers' own tests. No other command is gated: reading, validating, and
listing must keep working before onboarding.

### 4.8 Protocol

`START_HERE.md` and the `START_HERE` template both gain a first step:

> 1. Run `awb profile status`. If it reports `complete: false`, interview the
>    user with the questions it returns before starting any task, then record
>    the answers with `awb profile complete`.

The repository root file and the template have drifted apart and say different
things; both are updated.

## 5. Files touched

| File | Change |
|---|---|
| `core/templates.js` | Catalog content, interview questions, `START_HERE` step |
| `core/core.js` | Catalog listing, reference validation, onboarding state, `completeProfile` |
| `core/cli.js` | `role`/`skill`/`workflow` groups, `profile status\|complete`, gate, `COMMAND_OPTIONS`, help |
| `schemas/workspace.schema.json` | Optional `onboarding` property |
| `START_HERE.md` | First step |
| `roles/`, `skills/`, `workflows/` | Starter content committed |
| `test/cli.test.js` | Cases in section 6 |
| `README.md`, `CHANGELOG.md` | Document the flow |

Not touched: providers, artifacts, relationships, knowledge, migration.

## 6. Testing

1. `profile status` on a fresh workspace reports `complete: false`, a non-empty
   question set, and a catalog listing the shipped roles.
2. `task create` before onboarding fails with the gate message; the workspace
   gains no task file.
3. `task create --skip-onboarding` succeeds.
4. `profile complete --role nonexistent` is rejected and the message names the
   available roles.
5. `profile complete` with valid answers writes `user/PROFILE.md`, flips the
   flag, and `task create` then succeeds.
6. `profile complete` a second time is refused without `--replace` and accepted
   with it.
7. `task create --skill nonexistent` is rejected.
8. `validate` reports a dangling role on an active task as an error, and the
   same reference on a closed task as a warning.
9. `role list --json` / `skill list --json` return the shipped IDs.
10. A workspace initialized by `awb init` contains the starter catalog.

## 7. Rejected alternatives

**Interactive CLI wizard.** `awb onboard` prompting on the terminal would work
even if the agent ignores `START_HERE.md`, but Core has no interactive prompt
anywhere, and agent harnesses run it with stdin closed, so it would hang or read
EOF immediately. It also cannot adapt its questions to the answers, which is the
one thing a conversational agent is good at.

**Documentation only.** Writing the questions into `START_HERE.md` and shipping
a starter catalog needs no code and would be fastest, but nothing would validate
that a named skill exists and nothing would list the catalog. The failure this
design exists to prevent — an agent inventing a skill ID — would survive intact.
