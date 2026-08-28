# Research Records and Skill Contracts

Status: design, approved 2026-08-28. Targets Agent Workbench Core 0.5.0.

`formatVersion` stays `0.3`. Everything here is a backward-compatible addition:
one new command group, one new record type under `work/research/`, and one
optional file per skill. Older Core ignores all of it; `awb migrate` is
unchanged.

## 1. Problem

Two gaps, and they are the same gap seen from two ends.

**An agent cannot tell whether a skill fits.** Asked to build a Shopify order
sync, the agent reads the catalog and finds `code-review`, `debugging`,
`writing-user-guide`. Nothing says what any of them is *for*, so the agent
either guesses or invents an id and is refused:

```
$ awb task create ... --skill api-integration
Error: Unknown skill: api-integration. Available: code-review, debugging, writing-user-guide.
```

The refusal is correct. The problem is that the agent had no way to decide
before trying.

**Nothing survives the work that produced the skill.** Before you can write a
skill for Shopify integration you have to find out how Shopify works: read
docs, try an approach, watch it fail on rate limits, try another. Today that
has no home. `knowledge/` holds conclusions, `work/proposals/` holds candidate
lessons, `work/artifacts/` holds outputs — none of them holds *the attempts*.
So the next person repeats the failures, and the reason the final approach was
chosen is lost.

## 2. Goal

Give research a place to happen and a record that survives it, and give skills
a contract an agent can route on. A proven approach becomes a skill the person
approves, exactly as an approved lesson becomes knowledge today.

Non-goals: automatic promotion criteria, usage tracking, executing research,
scoring, and any form of runtime or graph engine. The person decides what is
proven.

## 3. Constraints

- Node.js >= 20, zero third-party packages. No YAML parser exists and none will
  be added, so structured data is JSON.
- Core never prompts and never calls a model. It records what the agent and the
  person did.
- Research must work **before** a project exists. `createTask` requires at least
  one project; research cannot, because it is what tells you whether the project
  is worth creating.
- Findings stay in the person's fork. A promoted skill reaches the shared
  catalog through a pull request the maintainer approves — the same route as
  every other shared change.

## 4. Design

### 4.1 Research records

`work/research/<ID>.json`, one file per question, id `RESEARCH-<stamp>-<rand>`
uppercase, matching how task and proposal ids already work:

```json
{
  "id": "RESEARCH-20260828-A1B2C3D4E5",
  "status": "open",
  "question": "Does Shopify push order webhooks, and what are the rate limits?",
  "plan": ["Read the Admin API webhook docs", "Try one polling call", "Try one webhook"],
  "attempts": [
    {
      "n": 1,
      "tried": "Poll GET /admin/api/orders.json every 30s",
      "result": "failed",
      "note": "HTTP 429 after roughly 40 requests per minute",
      "at": "2026-08-28T02:10:00.000Z"
    }
  ],
  "conclusion": null,
  "proposalId": null,
  "tags": ["shopify"],
  "createdAt": "...",
  "updatedAt": "..."
}
```

`status` is `open`, `concluded`, or `abandoned`. `result` on an attempt is
`passed`, `failed`, or `partial`.

The attempt log is the part with no home today, and it is the point of the
record. "Attempt 1 failed with 429" is what stops the next person from
repeating it.

### 4.2 Commands

```
awb research start [<id>] --question <text> [--plan <step>]... [--tag <tag>]...
awb research attempt <id> --tried <text> --result passed|failed|partial [--note <text>]
awb research conclude <id> --text <text> [--title <text>] [--scope <scope>]
awb research abandon <id> [--reason <text>]
awb research list [--status open|concluded|abandoned]
awb research show <id>
```

`conclude` does not write knowledge directly. It creates a memory proposal
through the existing `proposeMemory`, stores the returned id on the record as
`proposalId`, and sets `status` to `concluded`. The person then runs
`awb memory approve <proposal-id>` exactly as they do for any other lesson. One
approval path, not two.

`--scope` defaults to `user`, because a research question usually predates the
project it will serve. A non-default scope is validated by `validateScope`, so
`--scope project:x` fails when no such project is registered.

Rules the commands enforce, so that neither an agent nor a person has to
remember them:

- Omitting `<id>` on `start` generates one; supplying it uses it, subject to the
  same uppercase normalization as task and proposal ids.
- `--plan` is recorded at `start` and is not editable afterwards. A plan that
  changed is a finding for the attempt log, not a rewrite of the record.
- `attempt`, `conclude`, and `abandon` are refused on a record that is not
  `open`, and name the status they found.
- `conclude` does **not** require an attempt. A question answered by reading the
  documentation is answered.
- Every command reports the record id it acted on, and an unknown id is an error
  naming that id.

**Research is not gated on onboarding.** `task create` is, and that is the right
place for it: real work begins there. Research is the cheapest possible entry
point, and gating it would mean a person cannot look anything up until they have
sat through an interview. One gate, at the point where it matters.

### 4.3 Promotion is not a command

Turning a concluded research record into a skill is writing a file. The
`research-to-skill` workflow (§4.6) tells the agent to draft
`skills/<id>/SKILL.md` and `skills/<id>/skill.json` from the record's conclusion
and attempt log, and the person reviews it — in their fork, and through a pull
request if it should become shared.

A command that scaffolds the file would save one file write and would imply the
promotion is mechanical. It is a judgement, and it stays one.

### 4.4 Skill contracts

A skill may carry `skills/<id>/skill.json` beside its `SKILL.md`:

```json
{
  "id": "api-integration",
  "title": "API Integration",
  "useWhen": "Connecting our system to a third-party API.",
  "inputs": ["API documentation", "authentication method"],
  "outputs": ["a working client", "recorded rate limits and pagination rules"],
  "verify": ["one real read call succeeds", "no credential was written into the workspace"]
}
```

`id`, `title`, and `useWhen` are required; `inputs`, `outputs`, and `verify` are
optional arrays of strings. `id` must equal the directory name — a contract that
names a different skill is an error, not a rename.

`useWhen` is the field that solves the routing problem. `verify` is what the
person checks before believing the skill worked; it is prose, not an executable
assertion, and Core does not run it.

JSON rather than front-matter, because the repository has no YAML parser and
adding a dependency to read a six-field file is a bad trade.

**The contract is optional and its absence is a warning, not an error.**
Existing skills have none, and a workspace must not become invalid because a
person wrote a skill in prose. `awb validate` warns per skill that lacks one;
if the file exists it must satisfy `schemas/skill.schema.json` or that is an
error.

### 4.5 Making the contract reachable

- `awb skill list --json` includes `title` and `useWhen` for every skill that has
  a contract. This is the call an agent makes to route, and one call must be
  enough — a list of bare ids sends it back for six more.
- `awb skill show <id>` renders the contract above the file listing, and still
  works for a skill that has none — it simply shows the files.
- `awb task context <task-id>` includes each attached skill's `useWhen`, so the
  agent sees why a skill is on the task rather than inferring from its name.

### 4.6 Shipped content

Two additions to the starter catalog, written like the existing entries:

- `skills/research/{SKILL.md,skill.json}` — the method: bound the question
  before searching, record every attempt including the failures, stop when the
  question is answered rather than when something works.
- `workflows/research-to-skill/WORKFLOW.md` — the loop end to end: `research
  start` → attempts → `conclude` → `memory approve` → draft the skill → pull
  request.

Every shipped skill gains a `skill.json`, so the catalog demonstrates the
contract rather than only describing it.

## 5. Files touched

| File | Change |
|---|---|
| `core/core.js` | Research record CRUD, `conclude` bridging to `proposeMemory`, contract loading, validation |
| `core/cli.js` | `research` group, `skill list/show` contract output, `COMMAND_OPTIONS` |
| `core/templates.js` | `skills/research/*`, `workflows/research-to-skill/*`, `skill.json` for each shipped skill |
| `schemas/research.schema.json` | New |
| `schemas/skill.schema.json` | New |
| `test/cli.test.js` | §6 cases |
| `README.md`, `CHANGELOG.md`, `docs/CORE_SPEC.md` | Document the loop and the contract |

Not touched: providers, artifacts, relationships, migration, the onboarding
gate.

## 6. Testing

1. `research start` works with no project registered and no onboarding completed.
2. `research attempt` appends in order and `n` increments; `show --json` returns
   the attempts.
3. `research conclude` creates a memory proposal, records its id on the record,
   and sets status `concluded`; `memory approve` then produces the knowledge item.
4. `research conclude` on an already concluded record is refused.
5. `research list --status open` filters.
6. An unknown research id reports the id and exits non-zero.
7. `skill list --json` carries `useWhen` for a skill with a contract and omits it
   for one without.
8. `awb validate` warns for a skill with no `skill.json` and errors for one whose
   `skill.json` fails the schema.
9. `task context` shows `useWhen` for attached skills.
10. Every shipped skill has a `skill.json` that satisfies the schema, and the
    committed files match the templates — the pin that already covers the
    catalog, extended.
11. `work/research/` records survive `awb migrate` untouched.

## 7. Rejected alternatives

**Research as a task.** Reusing `createTask` would inherit artifacts, gates, and
verification for free, but a task requires a project and a write scope, and
research exists to decide whether that project should exist. Forcing the answer
before the question defeats it.

**A `research promote` command.** See §4.3. It would save one file write and
imply a judgement is mechanical.

**YAML front-matter for contracts.** Every other structured file in this
repository is JSON, read with `JSON.parse` and validated by `core/schema.js`. A
YAML parser is a dependency, and the constraint against dependencies has held
since 0.1.

**Automatic promotion after N successful reuses.** Considered and rejected with
the person choosing manual approval: it needs usage tracking, a threshold nobody
can justify, and it would promote whatever happened to be reused rather than
whatever is worth teaching.

**A graph runtime with evaluator and retry nodes.** The harness already routes,
calls tools, retries, and asks the person. A second runtime inside Core would
duplicate it and would require Core to call a model, which contradicts its
purpose. The retry idea survives here as the attempt log — a record of what was
tried, not an engine that tries.
