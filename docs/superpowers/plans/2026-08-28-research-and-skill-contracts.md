# Research Records and Skill Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give research a place to happen with an attempt log that survives it, and give skills a contract an agent can route on instead of guessing.

**Architecture:** Research records are a new record type under `work/research/`, managed by a new `core/research.js` module so that `core/core.js` (already 1514 lines) does not grow further. Concluding a research record creates a memory proposal through the existing `proposeMemory`, so approval keeps flowing through one path. Skill contracts are optional `skills/<id>/skill.json` files, validated by the existing `core/schema.js` and surfaced through `skill list`, `skill show`, and `task context`.

**Tech Stack:** Node.js >= 20, ES modules, zero third-party dependencies. Tests are `node --test`: `test/cli.test.js` drives the real CLI via `spawnSync`, `test/onboarding.test.js` holds direct-import unit tests.

**Spec:** `docs/RESEARCH.md`

## Global Constraints

- Node.js >= 20. No third-party packages, ever. No YAML parser exists and none will be added — structured data is JSON.
- `PACKAGE_VERSION` in `core/core.js` and `version` in `package.json` both become `0.5.0`. `FORMAT_VERSION` stays `"0.3"`.
- `awb migrate` is not modified by this plan and must leave `work/research/` untouched.
- Every new command must work with `--json` and be asserted in `test/cli.test.js`.
- Every new command group/action pair needs an entry in `COMMAND_OPTIONS` in `core/cli.js`; `dispatch` looks up `COMMAND_OPTIONS["<group> <action>"]` and an unlisted pair silently skips option validation. Every new boolean flag needs an entry in `BOOLEAN_OPTIONS`.
- Research is **not** gated on onboarding. `task create` remains the only gated command.
- A missing skill contract is a **warning**; a malformed one is an **error**.
- Run `npm run check && npm test` before every commit. All tests must pass.
- Commit after each task.

## File Structure

| File | Responsibility |
|---|---|
| `core/research.js` (new) | Research record lifecycle: start, attempt, conclude, abandon, get, list. Imports helpers from `core/core.js`; `core/core.js` never imports it. |
| `core/core.js` | Gains `unique` as an export, skill-contract reading, and validation of contracts and research records. |
| `core/cli.js` | Gains the `research` command group and contract output in `skill list` / `skill show`. |
| `schemas/research.schema.json` (new) | The research record contract. |
| `schemas/skill.schema.json` (new) | The skill contract contract. |
| `core/templates.js` | Gains the shipped `research` skill, the `research-to-skill` workflow, and a `skill.json` for every shipped skill. |

**Deviation from the spec's file table:** the spec lists research CRUD under `core/core.js`. It goes in `core/research.js` instead, because `core/core.js` is already the largest file in the repository and this is a self-contained record type, matching how `providers.js`, `profile.js`, and `schema.js` are already split out.

---

### Task 1: Research records

**Files:**
- Create: `core/research.js`
- Create: `schemas/research.schema.json`
- Modify: `core/core.js` (export `unique`)
- Modify: `package.json` (add `core/research.js` to the `check` script)
- Test: `test/onboarding.test.js`

**Interfaces:**
- Consumes: `exists`, `makeId`, `nowIso`, `normalizeId`, `readJson`, `touchWorkspace`, `writeJson`, `unique` from `core/core.js`.
- Produces, all used by Tasks 2 and 3:
  - `startResearch(root, {id?, question, plan?, tags?}) → Promise<record>`
  - `getResearch(root, id) → Promise<record>`
  - `listResearch(root, {status?}) → Promise<record[]>`
  - `addResearchAttempt(root, id, {tried, result, note?}) → Promise<{research, attempt}>`
  - `abandonResearch(root, id, {reason?}) → Promise<record>`
  - `RESEARCH_DIRECTORY = "work/research"`

- [ ] **Step 1: Write the failing test**

Append to `test/onboarding.test.js`, before the existing catalog pin test:

```javascript
test("a research record tracks its question, plan, and attempt log", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "awb-research-"));
  try {
    await mkdir(path.join(root, ".awb"), { recursive: true });
    await writeFile(
      path.join(root, ".awb", "workspace.json"),
      JSON.stringify({ formatVersion: "0.3", name: "T", createdAt: "2026-01-01T00:00:00.000Z" }),
      "utf8"
    );

    const started = await startResearch(root, {
      question: "Does Shopify push order webhooks?",
      plan: ["Read the webhook docs"],
      tags: ["shopify"]
    });
    assert.match(started.id, /^RESEARCH-/);
    assert.equal(started.status, "open");
    assert.deepEqual(started.attempts, []);
    assert.equal(started.conclusion, null);

    const first = await addResearchAttempt(root, started.id, {
      tried: "Poll the orders endpoint",
      result: "failed",
      note: "429 after 40 requests"
    });
    assert.equal(first.attempt.n, 1);
    const second = await addResearchAttempt(root, started.id, {
      tried: "Subscribe to orders/create",
      result: "passed"
    });
    assert.equal(second.attempt.n, 2);
    assert.equal(second.attempt.note, null);

    const reloaded = await getResearch(root, started.id.toLowerCase());
    assert.equal(reloaded.attempts.length, 2);
    assert.equal(reloaded.attempts[0].result, "failed");

    await assert.rejects(
      () => addResearchAttempt(root, started.id, { tried: "x", result: "maybe" }),
      /Attempt result must be passed, failed, or partial/
    );
    await assert.rejects(() => startResearch(root, {}), /Research question is required/);
    await assert.rejects(() => getResearch(root, "RESEARCH-NOPE"), /Unknown research record: RESEARCH-NOPE/);

    const abandoned = await abandonResearch(root, started.id, { reason: "Answered elsewhere" });
    assert.equal(abandoned.status, "abandoned");
    await assert.rejects(
      () => addResearchAttempt(root, started.id, { tried: "x", result: "passed" }),
      /it is abandoned/
    );

    assert.equal((await listResearch(root)).length, 1);
    assert.equal((await listResearch(root, { status: "open" })).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

Add to that file's imports at the top:

```javascript
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  abandonResearch,
  addResearchAttempt,
  getResearch,
  listResearch,
  startResearch
} from "../core/research.js";
```

Keep the file's existing imports; add only what is missing.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../core/research.js'`.

- [ ] **Step 3: Export `unique` from `core/core.js`**

Find `function unique(values) {` near the bottom of `core/core.js` and change it to:

```javascript
export function unique(values) {
```

- [ ] **Step 4: Create `core/research.js`**

```javascript
import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  exists,
  makeId,
  normalizeId,
  nowIso,
  readJson,
  touchWorkspace,
  unique,
  writeJson
} from "./core.js";

export const RESEARCH_DIRECTORY = "work/research";

const ATTEMPT_RESULTS = ["passed", "failed", "partial"];

// Research exists to answer a question before a project is worth creating, so
// unlike a task it needs no project, no scope, and no onboarding.
export async function startResearch(root, input = {}) {
  const id = normalizeId(input.id || makeId("RESEARCH", { uppercase: true }), "Research ID", {
    uppercase: true
  });
  const target = `${RESEARCH_DIRECTORY}/${id}.json`;
  if (await exists(path.join(root, target))) throw new Error(`Research already exists: ${id}`);
  const timestamp = nowIso();
  const record = {
    id,
    status: "open",
    question: requiredText(input.question, "Research question"),
    plan: unique(input.plan ?? []),
    attempts: [],
    conclusion: null,
    proposalId: null,
    tags: unique(input.tags ?? []),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await writeJson(root, target, record);
  await touchWorkspace(root);
  return record;
}

export async function getResearch(root, id) {
  const safeId = normalizeId(id, "Research ID", { uppercase: true });
  const target = `${RESEARCH_DIRECTORY}/${safeId}.json`;
  if (!(await exists(path.join(root, target)))) {
    throw new Error(`Unknown research record: ${safeId}`);
  }
  return readJson(root, target);
}

export async function listResearch(root, { status } = {}) {
  const directory = path.join(root, "work", "research");
  if (!(await exists(directory))) return [];
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  const records = [];
  for (const file of files) {
    const record = await readJson(root, `${RESEARCH_DIRECTORY}/${file}`);
    if (!status || record.status === status) records.push(record);
  }
  return records;
}

// The attempt log is the point of the record: "attempt 1 failed with 429" is
// what stops the next person repeating it.
export async function addResearchAttempt(root, id, input = {}) {
  const record = await requireOpenResearch(root, id, "record an attempt on");
  const result = String(input.result ?? "").trim();
  if (!ATTEMPT_RESULTS.includes(result)) {
    throw new Error(`Attempt result must be ${ATTEMPT_RESULTS.join(", ")}.`);
  }
  const attempt = {
    n: record.attempts.length + 1,
    tried: requiredText(input.tried, "What was tried"),
    result,
    note: input.note || null,
    at: nowIso()
  };
  record.attempts.push(attempt);
  record.updatedAt = attempt.at;
  await saveResearch(root, record);
  return { research: record, attempt };
}

export async function abandonResearch(root, id, { reason = "" } = {}) {
  const record = await requireOpenResearch(root, id, "abandon");
  record.status = "abandoned";
  record.abandonReason = reason || null;
  record.updatedAt = nowIso();
  await saveResearch(root, record);
  return record;
}

export async function saveResearch(root, record) {
  await writeJson(root, `${RESEARCH_DIRECTORY}/${record.id}.json`, record);
  await touchWorkspace(root);
  return record;
}

export async function requireOpenResearch(root, id, verb) {
  const record = await getResearch(root, id);
  if (record.status !== "open") {
    throw new Error(`Cannot ${verb} research ${record.id}: it is ${record.status}.`);
  }
  return record;
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}
```

- [ ] **Step 5: Create `schemas/research.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://agent-workbench.local/schemas/research.schema.json",
  "title": "Agent Workbench Research Record",
  "type": "object",
  "required": ["id", "status", "question", "attempts"],
  "properties": {
    "id": { "type": "string", "pattern": "^[A-Z0-9][A-Z0-9._-]*$" },
    "status": { "enum": ["open", "concluded", "abandoned"] },
    "question": { "type": "string", "minLength": 1 },
    "plan": { "type": "array", "items": { "type": "string" } },
    "attempts": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["n", "tried", "result"],
        "properties": {
          "n": { "type": "integer", "minimum": 1 },
          "tried": { "type": "string", "minLength": 1 },
          "result": { "enum": ["passed", "failed", "partial"] },
          "note": { "type": ["string", "null"] },
          "at": { "type": "string", "format": "date-time" }
        },
        "additionalProperties": true
      }
    },
    "conclusion": { "type": ["string", "null"] },
    "proposalId": { "type": ["string", "null"] },
    "abandonReason": { "type": ["string", "null"] },
    "tags": { "type": "array", "items": { "type": "string" } }
  },
  "additionalProperties": true
}
```

- [ ] **Step 6: Add the new file to the check script**

In `package.json`, append to the `check` script's `&&` chain, keeping the existing style:

```
&& node --check core/research.js
```

- [ ] **Step 7: Run the tests**

Run: `npm run check && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add core/research.js core/core.js schemas/research.schema.json package.json test/onboarding.test.js
git commit -m "feat: add research records with an attempt log"
```

---

### Task 2: The `awb research` command group

**Files:**
- Modify: `core/cli.js`
- Test: `test/cli.test.js`

**Interfaces:**
- Consumes: `startResearch`, `getResearch`, `listResearch`, `addResearchAttempt`, `abandonResearch` from `core/research.js` (Task 1).
- Produces: the `research` command group. Task 3 adds `conclude` to the same group and the same `researchCommand` function.

- [ ] **Step 1: Write the failing test**

Append to `test/cli.test.js`, before the `function awb(args) {` helper:

```javascript
test("research runs before any project exists and before onboarding", async () => {
  const root = await initializedWorkspace();

  // Deliberately not onboarded and with no project registered: research is what
  // tells you whether a project is worth creating.
  const started = awb([
    "--root", root, "--json", "research", "start",
    "--question", "Does Shopify push order webhooks?",
    "--plan", "Read the webhook docs",
    "--tag", "shopify"
  ]);
  assertSuccess(started);
  const record = JSON.parse(started.stdout);
  assert.match(record.id, /^RESEARCH-/);
  assert.equal(record.status, "open");
  assert.deepEqual(record.plan, ["Read the webhook docs"]);

  assertSuccess(
    awb([
      "--root", root, "research", "attempt", record.id,
      "--tried", "Poll the orders endpoint", "--result", "failed",
      "--note", "429 after 40 requests"
    ])
  );
  assertSuccess(
    awb([
      "--root", root, "research", "attempt", record.id,
      "--tried", "Subscribe to orders/create", "--result", "passed"
    ])
  );

  const shown = JSON.parse(awb(["--root", root, "--json", "research", "show", record.id]).stdout);
  assert.equal(shown.attempts.length, 2);
  assert.equal(shown.attempts[0].n, 1);
  assert.equal(shown.attempts[0].result, "failed");
  assert.match(shown.attempts[0].note, /429/);

  const text = awb(["--root", root, "research", "show", record.id]);
  assertSuccess(text);
  assert.match(text.stdout, /429 after 40 requests/, "the attempt log must be visible without --json");

  assert.equal(JSON.parse(awb(["--root", root, "--json", "research", "list"]).stdout).length, 1);
  assert.equal(
    JSON.parse(awb(["--root", root, "--json", "research", "list", "--status", "abandoned"]).stdout).length,
    0
  );

  assertSuccess(awb(["--root", root, "research", "abandon", record.id, "--reason", "Answered by docs"]));
  const closed = awb([
    "--root", root, "research", "attempt", record.id, "--tried", "x", "--result", "passed"
  ]);
  assert.equal(closed.status, 1);
  assert.match(closed.stderr, /it is abandoned/);

  const missing = awb(["--root", root, "research", "show", "RESEARCH-NOPE"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Unknown research record: RESEARCH-NOPE/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL with `Unknown command: research. Run \`awb help\`.`

- [ ] **Step 3: Wire the command group in `core/cli.js`**

Add the import, after the `./core.js` import block:

```javascript
import {
  abandonResearch,
  addResearchAttempt,
  getResearch,
  listResearch,
  startResearch
} from "./research.js";
```

Add to `COMMAND_OPTIONS`, after the `"relation list"` entry:

```javascript
  "research start": ["id", "question", "plan", "tag"],
  "research attempt": ["tried", "result", "note"],
  "research abandon": ["reason"],
  "research list": ["status"],
  "research show": [],
```

Add a case to the `switch (group)` in `dispatch`, after `case "relation":`:

```javascript
    case "research":
      command = await researchCommand(root, action, positionals, parsed);
      break;
```

Add the handler next to `relationCommand`:

```javascript
async function researchCommand(root, action, positionals, parsed) {
  if (action === "start") {
    const record = await startResearch(root, {
      id: positionals[0] || value(parsed, "id"),
      question: value(parsed, "question"),
      plan: values(parsed, "plan"),
      tags: values(parsed, "tag")
    });
    return {
      data: record,
      text: () => `Research started: ${record.id}\nQuestion: ${record.question}`
    };
  }
  if (action === "attempt") {
    const id = positionals[0];
    if (!id) throw new Error("Usage: awb research attempt <research-id> --tried <text> --result passed|failed|partial");
    const result = await addResearchAttempt(root, id, {
      tried: value(parsed, "tried"),
      result: value(parsed, "result"),
      note: value(parsed, "note")
    });
    return {
      data: result,
      text: () =>
        `Attempt ${result.attempt.n} recorded on ${result.research.id}: ${result.attempt.result}`
    };
  }
  if (action === "abandon") {
    const id = positionals[0];
    if (!id) throw new Error("Usage: awb research abandon <research-id> [--reason <text>]");
    const record = await abandonResearch(root, id, { reason: value(parsed, "reason") });
    return { data: record, text: () => `Research abandoned: ${record.id}` };
  }
  if (action === "list") {
    const records = await listResearch(root, { status: value(parsed, "status") });
    return {
      data: records,
      text: () =>
        records.length
          ? records
              .map((item) => `- ${item.id} [${item.status}] ${item.question} · ${item.attempts.length} attempts`)
              .join("\n")
          : "No research records found."
    };
  }
  if (action === "show") {
    const id = positionals[0];
    if (!id) throw new Error("Usage: awb research show <research-id>");
    const record = await getResearch(root, id);
    return { data: record, text: () => formatResearch(record) };
  }
  throw new Error("Usage: awb research start|attempt|conclude|abandon|list|show");
}
```

Add the formatter next to `formatValidation`:

```javascript
function formatResearch(record) {
  const lines = [
    `Research: ${record.id} [${record.status}]`,
    `Question: ${record.question}`
  ];
  if ((record.plan ?? []).length) lines.push("Plan:", ...record.plan.map((step) => `- ${step}`));
  if ((record.attempts ?? []).length) {
    lines.push(
      "Attempts:",
      ...record.attempts.map(
        (attempt) =>
          `- ${attempt.n}. [${attempt.result}] ${attempt.tried}` +
          (attempt.note ? `\n     ${attempt.note}` : "")
      )
    );
  } else {
    lines.push("Attempts: none recorded");
  }
  if (record.conclusion) lines.push("Conclusion:", record.conclusion);
  if (record.proposalId) lines.push(`Proposal awaiting approval: ${record.proposalId}`);
  if (record.abandonReason) lines.push(`Abandoned because: ${record.abandonReason}`);
  return lines.join("\n");
}
```

Add to the `Commands:` block of `helpFor`'s `common` string, after the `relation add|list` line:

```
  research start|attempt|conclude|abandon|list|show
                               Answer a question before committing to a project
```

Add a `research` entry to the `details` map in `helpFor`:

```javascript
    research: `Research commands:
  awb research start [<id>] --question <text> [--plan <step>] [--tag <tag>]
  awb research attempt <id> --tried <text> --result passed|failed|partial [--note <text>]
  awb research conclude <id> --text <text> [--title <text>] [--scope <scope>]
  awb research abandon <id> [--reason <text>]
  awb research list [--status open|concluded|abandoned]
  awb research show <id>

Research needs no project and is not gated on onboarding: it is what tells you
whether a project is worth creating.`,
```

- [ ] **Step 4: Run the tests**

Run: `npm run check && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/cli.js test/cli.test.js
git commit -m "feat: add the awb research command group"
```

---

### Task 3: `research conclude` bridges to the memory proposal

**Files:**
- Modify: `core/research.js`
- Modify: `core/cli.js`
- Test: `test/cli.test.js`

**Interfaces:**
- Consumes: `proposeMemory(root, input)` from `core/core.js`, plus `requireOpenResearch` and `saveResearch` from Task 1.
- Produces: `concludeResearch(root, id, {text, title?, scope?}) → Promise<{research, proposal}>`.

- [ ] **Step 1: Write the failing test**

Append to `test/cli.test.js`, before the `function awb(args) {` helper:

```javascript
test("concluding research routes through the existing memory approval path", async () => {
  const root = await initializedWorkspace();
  const record = JSON.parse(
    awb([
      "--root", root, "--json", "research", "start",
      "--question", "Does Shopify push order webhooks?", "--tag", "shopify"
    ]).stdout
  );
  assertSuccess(
    awb([
      "--root", root, "research", "attempt", record.id,
      "--tried", "Subscribe to orders/create", "--result", "passed"
    ])
  );

  const concluded = awb([
    "--root", root, "--json", "research", "conclude", record.id,
    "--text", "Use the orders/create webhook; polling hits 429 at 40 req/min."
  ]);
  assertSuccess(concluded);
  const outcome = JSON.parse(concluded.stdout);
  assert.equal(outcome.research.status, "concluded");
  assert.match(outcome.proposal.id, /^LEARN-/);
  assert.equal(outcome.research.proposalId, outcome.proposal.id);
  assert.equal(outcome.proposal.sourceRef, record.id);
  assert.equal(outcome.proposal.scope, "user");

  // The conclusion is a candidate until the person approves it, exactly like
  // any other lesson. No second approval path.
  const pending = JSON.parse(awb(["--root", root, "--json", "memory", "list", "--status", "candidate"]).stdout);
  assert.equal(pending.length, 1);
  assert.equal(JSON.parse(awb(["--root", root, "--json", "knowledge", "list"]).stdout).length, 0);

  assertSuccess(awb(["--root", root, "memory", "approve", outcome.proposal.id, "--knowledge-id", "shopify.webhooks"]));
  const knowledge = JSON.parse(awb(["--root", root, "--json", "knowledge", "list"]).stdout);
  assert.equal(knowledge.length, 1);
  assert.equal(knowledge[0].id, "shopify.webhooks");

  const again = awb(["--root", root, "research", "conclude", record.id, "--text", "Something else"]);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /it is concluded/);

  assertSuccess(awb(["--root", root, "validate"]));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL with `Usage: awb research start|attempt|conclude|abandon|list|show` — the action is documented but not implemented.

- [ ] **Step 3: Implement `concludeResearch` in `core/research.js`**

Extend the `./core.js` import to include `proposeMemory`:

```javascript
import {
  exists,
  makeId,
  normalizeId,
  nowIso,
  proposeMemory,
  readJson,
  touchWorkspace,
  unique,
  writeJson
} from "./core.js";
```

Add after `addResearchAttempt`:

```javascript
// A conclusion is a candidate lesson, not yet knowledge. Routing it through
// proposeMemory keeps one approval path rather than growing a second one.
export async function concludeResearch(root, id, input = {}) {
  const record = await requireOpenResearch(root, id, "conclude");
  const conclusion = requiredText(input.text, "Conclusion text");
  const proposal = await proposeMemory(root, {
    kind: "finding",
    title: input.title || record.question,
    scope: input.scope || "user",
    text: conclusion,
    tags: record.tags,
    sourceRef: record.id
  });
  record.status = "concluded";
  record.conclusion = conclusion;
  record.proposalId = proposal.id;
  record.updatedAt = nowIso();
  await saveResearch(root, record);
  return { research: record, proposal };
}
```

- [ ] **Step 4: Wire the action in `core/cli.js`**

Add `concludeResearch` to the `./research.js` import list, in alphabetical position (before `getResearch`).

Add to `COMMAND_OPTIONS`, beside the other research entries:

```javascript
  "research conclude": ["text", "title", "scope"],
```

Add to `researchCommand`, after the `attempt` branch:

```javascript
  if (action === "conclude") {
    const id = positionals[0];
    if (!id) throw new Error("Usage: awb research conclude <research-id> --text <conclusion>");
    const outcome = await concludeResearch(root, id, {
      text: value(parsed, "text"),
      title: value(parsed, "title"),
      scope: value(parsed, "scope")
    });
    return {
      data: outcome,
      text: () =>
        `Research concluded: ${outcome.research.id}\nProposal created: ${outcome.proposal.id}\nApprove it with \`awb memory approve ${outcome.proposal.id}\`.`
    };
  }
```

- [ ] **Step 5: Run the tests**

Run: `npm run check && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/research.js core/cli.js test/cli.test.js
git commit -m "feat: conclude research into a memory proposal"
```

---

### Task 4: Skill contracts

**Files:**
- Create: `schemas/skill.schema.json`
- Modify: `core/core.js` (`readSkillContract`, `listCapabilityEntries`, `taskContext`, `validateWorkspace`)
- Modify: `core/cli.js` (`capabilityCommand`, `formatTaskContext`)
- Test: `test/cli.test.js`

**Interfaces:**
- Consumes: `listCapabilities`, `capabilityDirectory`, `exists`, `readJson`, `validateAgainstSchema`, `loadSchemas` — all already in `core/core.js`.
- Produces:
  - `readSkillContract(root, id) → Promise<contract|null>`
  - `listCapabilityEntries(root, kind) → Promise<Array<{id, title?, useWhen?}>>`
  - `taskContext` gains a `skillContracts: Array<{id, useWhen}>` field.

**Breaking output change:** `role|skill|workflow list --json` currently returns an array of id strings. It now returns an array of objects so a single call carries what an agent needs to route. Three existing assertions in `test/cli.test.js` must be updated — they are named in Step 5.

- [ ] **Step 1: Write the failing test**

Append to `test/cli.test.js`, before the `function awb(args) {` helper:

```javascript
test("a skill contract tells an agent when to use the skill", async () => {
  const root = await onboardedWorkspace();

  // Two skills created by this test, not shipped ones: Task 5 gives every
  // shipped skill a contract, so asserting "this shipped skill has none" would
  // break one task later.
  await mkdir(path.join(root, "skills", "local-contracted"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "local-contracted", "SKILL.md"),
    "# Skill: Local Contracted\n\nRead the docs first.\n",
    "utf8"
  );
  await writeFile(
    path.join(root, "skills", "local-contracted", "skill.json"),
    JSON.stringify(
      {
        id: "local-contracted",
        title: "Local Contracted",
        useWhen: "Connecting our system to a third-party API.",
        verify: ["one real read call succeeds"]
      },
      null,
      2
    ),
    "utf8"
  );
  await mkdir(path.join(root, "skills", "local-bare"), { recursive: true });
  await writeFile(path.join(root, "skills", "local-bare", "SKILL.md"), "# Skill: Local Bare\n", "utf8");

  const listed = JSON.parse(awb(["--root", root, "--json", "skill", "list"]).stdout);
  const contracted = listed.find((entry) => entry.id === "local-contracted");
  assert.equal(contracted.useWhen, "Connecting our system to a third-party API.");
  assert.equal(contracted.title, "Local Contracted");
  const bare = listed.find((entry) => entry.id === "local-bare");
  assert.equal(bare.useWhen, undefined, "a skill without a contract carries no useWhen");

  const shown = awb(["--root", root, "skill", "show", "local-contracted"]);
  assertSuccess(shown);
  assert.match(shown.stdout, /Use when: Connecting our system to a third-party API\./);

  // A skill with no contract still shows, it simply has no contract section.
  assertSuccess(awb(["--root", root, "skill", "show", "local-bare"]));

  assertSuccess(
    awb([
      "--root", root, "project", "add", "app", "--path", "src/app", "--create"
    ])
  );
  assertSuccess(
    awb([
      "--root", root, "task", "create", "--id", "TASK-ROUTE", "--title", "Route",
      "--role", "developer", "--project", "app", "--skill", "local-contracted"
    ])
  );
  const context = awb(["--root", root, "task", "context", "TASK-ROUTE"]);
  assertSuccess(context);
  assert.match(context.stdout, /Connecting our system to a third-party API\./);
});

test("validate warns for a missing skill contract and errors for a malformed one", async () => {
  const root = await initializedWorkspace();

  let validation = JSON.parse(awb(["--root", root, "--json", "validate"]).stdout);
  assert.equal(validation.valid, true, validation.errors.join("; "));

  await mkdir(path.join(root, "skills", "broken"), { recursive: true });
  await writeFile(path.join(root, "skills", "broken", "SKILL.md"), "# Broken\n", "utf8");
  validation = JSON.parse(awb(["--root", root, "--json", "validate"]).stdout);
  assert.equal(validation.valid, true, "a missing contract is a warning, not an error");
  assert.equal(
    validation.warnings.some((message) => message.includes("skills/broken/skill.json")),
    true,
    validation.warnings.join("; ")
  );

  await writeFile(
    path.join(root, "skills", "broken", "skill.json"),
    JSON.stringify({ id: "broken", title: "Broken" }, null, 2),
    "utf8"
  );
  validation = JSON.parse(awb(["--root", root, "--json", "validate"]).stdout);
  assert.equal(validation.valid, false, "a contract missing useWhen is an error");
  assert.equal(
    validation.errors.some((message) => message.includes("useWhen")),
    true,
    validation.errors.join("; ")
  );

  await writeFile(
    path.join(root, "skills", "broken", "skill.json"),
    JSON.stringify({ id: "something-else", title: "Broken", useWhen: "Never." }, null, 2),
    "utf8"
  );
  validation = JSON.parse(awb(["--root", root, "--json", "validate"]).stdout);
  assert.equal(validation.valid, false, "a contract naming a different skill is an error");
  assert.equal(
    validation.errors.some((message) => message.includes("declares a different id")),
    true,
    validation.errors.join("; ")
  );
});
```

`test/cli.test.js` already imports `mkdir`, `mkdtemp`, `readFile`, `readdir`,
`rename`, `rm`, and `writeFile` from `node:fs/promises` — no import change is
needed for this task.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `skill list --json` returns strings, so `listed.find((entry) => entry.id === ...)` is `undefined`.

- [ ] **Step 3: Create `schemas/skill.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://agent-workbench.local/schemas/skill.schema.json",
  "title": "Agent Workbench Skill Contract",
  "type": "object",
  "required": ["id", "title", "useWhen"],
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z0-9][a-z0-9._-]*$" },
    "title": { "type": "string", "minLength": 1 },
    "useWhen": { "type": "string", "minLength": 1 },
    "inputs": { "type": "array", "items": { "type": "string" } },
    "outputs": { "type": "array", "items": { "type": "string" } },
    "verify": { "type": "array", "items": { "type": "string" } }
  },
  "additionalProperties": true
}
```

- [ ] **Step 4: Add contract reading and validation to `core/core.js`**

Add after `listCapabilities`:

```javascript
// A SKILL.md says what to do; the contract says what the skill is FOR. Without
// it an agent has to guess whether a skill fits, which is the failure this
// exists to remove.
export async function readSkillContract(root, id) {
  const relativePath = `skills/${id}/skill.json`;
  if (!(await exists(path.join(root, relativePath)))) return null;
  return readJson(root, relativePath);
}

// One call must carry enough to route on; a list of bare ids sends the agent
// back for one lookup per skill.
export async function listCapabilityEntries(root, kind) {
  const ids = await listCapabilities(root, kind);
  if (kind !== "skill") return ids.map((id) => ({ id }));
  const entries = [];
  for (const id of ids) {
    const contract = await readSkillContract(root, id).catch(() => null);
    entries.push(contract ? { id, title: contract.title, useWhen: contract.useWhen } : { id });
  }
  return entries;
}
```

In `taskContext`, replace:

```javascript
  const skillFiles = [];
  for (const skill of task.skills ?? []) skillFiles.push(...(await listFilesRecursively(root, `skills/${skill}`, 20)));
```

with:

```javascript
  const skillFiles = [];
  const skillContracts = [];
  for (const skill of task.skills ?? []) {
    skillFiles.push(...(await listFilesRecursively(root, `skills/${skill}`, 20)));
    const contract = await readSkillContract(root, skill).catch(() => null);
    if (contract?.useWhen) skillContracts.push({ id: skill, useWhen: contract.useWhen });
  }
```

In the object `taskContext` returns, add `skillContracts,` immediately after `skillFiles,`.

In `validateWorkspace`, add `"skill"` and `"research"` to the `loadSchemas([...])` array, and insert this block immediately before the final `return {` statement:

```javascript
  for (const skillId of await listCapabilities(root, "skill")) {
    const relativePath = `skills/${skillId}/skill.json`;
    if (!(await exists(path.join(root, relativePath)))) {
      warnings.push(`Skill has no contract: ${relativePath}`);
      continue;
    }
    try {
      const contract = await readJson(root, relativePath);
      errors.push(...validateAgainstSchema(contract, schemas.skill, `Skill contract ${skillId}`));
      if (contract.id !== skillId) {
        errors.push(`Skill contract ${skillId} declares a different id: ${contract.id}`);
      }
    } catch (error) {
      errors.push(`Skill contract ${skillId}: ${error.message}`);
    }
  }

  // Read the directory here rather than importing core/research.js: research.js
  // imports this module, and a cycle would be fragile for no gain.
  const researchDirectory = path.join(root, "work", "research");
  if (await exists(researchDirectory)) {
    const files = (await readdir(researchDirectory)).filter((file) => file.endsWith(".json")).sort();
    for (const file of files) {
      try {
        const record = await readJson(root, `work/research/${file}`);
        errors.push(...validateAgainstSchema(record, schemas.research, `Research ${record.id ?? file}`));
      } catch (error) {
        errors.push(`Research ${file}: ${error.message}`);
      }
    }
  }
```

- [ ] **Step 5: Surface contracts in `core/cli.js` and update the three broken assertions**

Add `listCapabilityEntries` and `readSkillContract` to the `./core.js` import list in alphabetical position.

Replace `capabilityCommand` with:

```javascript
async function capabilityCommand(root, kind, action, positionals) {
  if (action === "list") {
    const entries = await listCapabilityEntries(root, kind);
    return {
      data: entries,
      text: () =>
        entries.length
          ? entries.map((entry) => `- ${entry.id}${entry.useWhen ? ` — ${entry.useWhen}` : ""}`).join("\n")
          : `No ${kind}s found.`
    };
  }
  if (action === "show") {
    const id = positionals[0];
    if (!id) throw new Error(`Usage: awb ${kind} show <${kind}-id>`);
    const capability = await showCapability(root, kind, id);
    const contract = kind === "skill" ? await readSkillContract(root, capability.id).catch(() => null) : null;
    return {
      data: { ...capability, contract },
      text: () => {
        const lines = [`${kind}: ${capability.id}`];
        if (contract) {
          lines.push(`Title: ${contract.title}`, `Use when: ${contract.useWhen}`);
          for (const [label, items] of [
            ["Inputs", contract.inputs],
            ["Outputs", contract.outputs],
            ["Verify", contract.verify]
          ]) {
            if ((items ?? []).length) lines.push(`${label}:`, ...items.map((item) => `- ${item}`));
          }
        }
        lines.push(`Path: ${capability.path}`, "Files:", ...capability.files.map((file) => `- ${file}`));
        return lines.join("\n");
      }
    };
  }
  throw new Error(`Usage: awb ${kind} list|show`);
}
```

In `formatTaskContext`, immediately after the block that pushes `Skill files:`, add:

```javascript
  if ((context.skillContracts ?? []).length) {
    lines.push(
      "Skill contracts:",
      ...context.skillContracts.map((item) => `- ${item.id}: ${item.useWhen}`)
    );
  }
```

Now fix the three assertions that expected id strings. In `test/cli.test.js`, in the test named `capability catalogs are discoverable for every kind`, replace:

```javascript
  assert.deepEqual(
    JSON.parse(awb(["--root", root, "--json", "skill", "list"]).stdout),
    ["code-review", "debugging", "writing-user-guide"]
  );
  assert.deepEqual(
    JSON.parse(awb(["--root", root, "--json", "workflow", "list"]).stdout),
    ["document-delivery", "feature-delivery"]
  );
```

with:

```javascript
  assert.deepEqual(
    JSON.parse(awb(["--root", root, "--json", "skill", "list"]).stdout).map((entry) => entry.id),
    ["code-review", "debugging", "writing-user-guide"]
  );
  assert.deepEqual(
    JSON.parse(awb(["--root", root, "--json", "workflow", "list"]).stdout).map((entry) => entry.id),
    ["document-delivery", "feature-delivery"]
  );
```

Then run `npm test` and fix any remaining assertion that compares a `list --json` result against an array of strings the same way — search the file for `"list"]).stdout)` to find them.

- [ ] **Step 6: Run the tests**

Run: `npm run check && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add core/core.js core/cli.js schemas/skill.schema.json test/cli.test.js
git commit -m "feat: give skills a routable contract"
```

---

### Task 5: Ship the research skill, the workflow, and contracts for the catalog

**Files:**
- Modify: `core/templates.js` (`CAPABILITY_CATALOG`)
- Create: the corresponding files under `roles/`, `skills/`, `workflows/` in this repository
- Test: `test/cli.test.js`

**Interfaces:**
- Consumes: `CAPABILITY_CATALOG` from Task 1 of the previous plan; the skill contract schema from Task 4.
- Produces: no new code interfaces.

- [ ] **Step 1: Write the failing test**

Append to `test/cli.test.js`, before the `function awb(args) {` helper:

```javascript
test("every shipped skill carries a contract and the workspace validates clean", async () => {
  const root = await initializedWorkspace();

  const skills = JSON.parse(awb(["--root", root, "--json", "skill", "list"]).stdout);
  assert.deepEqual(
    skills.map((entry) => entry.id),
    ["api-integration", "code-review", "debugging", "research", "writing-user-guide"]
  );
  for (const entry of skills) {
    assert.ok(entry.useWhen, `shipped skill ${entry.id} must carry a contract`);
  }

  const workflows = JSON.parse(awb(["--root", root, "--json", "workflow", "list"]).stdout).map((e) => e.id);
  assert.deepEqual(workflows, ["document-delivery", "feature-delivery", "research-to-skill"]);

  // No "Skill has no contract" warning may remain for the shipped catalog.
  const validation = JSON.parse(awb(["--root", root, "--json", "validate"]).stdout);
  assert.equal(validation.valid, true, validation.errors.join("; "));
  assert.equal(
    validation.warnings.some((message) => message.includes("has no contract")),
    false,
    validation.warnings.join("; ")
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — the skill list has three entries, not five, and every one warns about a missing contract.

- [ ] **Step 3: Add the contracts and new entries to `CAPABILITY_CATALOG`**

In `core/templates.js`, add these entries to the `CAPABILITY_CATALOG` object. Contracts for the three existing skills:

```javascript
  "skills/code-review/skill.json": `{
  "id": "code-review",
  "title": "Code Review",
  "useWhen": "Reviewing a change before it merges.",
  "inputs": ["the task objective", "the diff under review"],
  "outputs": ["a findings list ranked by severity"],
  "verify": ["every finding names a file, a line, and a failing case"]
}
`,
  "skills/debugging/skill.json": `{
  "id": "debugging",
  "title": "Debugging",
  "useWhen": "Something fails and the cause is not yet known.",
  "inputs": ["a reproduction of the failure"],
  "outputs": ["the cause", "the fix", "evidence the fix works"],
  "verify": ["the reproduction no longer fails", "the cause was fixed, not the symptom"]
}
`,
  "skills/writing-user-guide/skill.json": `{
  "id": "writing-user-guide",
  "title": "Writing a User Guide",
  "useWhen": "Producing instructions for someone who does not build the system.",
  "inputs": ["the audience", "the single task the guide accomplishes"],
  "outputs": ["a document a reader can follow start to finish"],
  "verify": ["every step was performed in the real system before it was written"]
}
`,
```

The research skill:

```javascript
  "skills/research/SKILL.md": `# Skill: Research

Use before committing to an approach you do not yet understand.

## Method

1. Write the question down first, in one sentence, and bound it: what answer
   would let you stop looking?
2. Record the plan before searching. A plan you cannot write is a question you
   have not narrowed enough.
3. Try one thing at a time and record every attempt, **especially the ones that
   fail**. "Polling returned 429 after 40 requests" is the finding; the working
   approach is only half the value.
4. Stop when the question is answered, not when something works. Those differ.
5. Conclude into a proposal so the person decides whether it becomes knowledge.

## Commands

\\\`\\\`\\\`bash
awb research start --question "..." --plan "..."
awb research attempt <id> --tried "..." --result failed --note "..."
awb research conclude <id> --text "..."
\\\`\\\`\\\`

## Output

An answered question, an attempt log the next person can read, and a proposal
awaiting approval.
`,
  "skills/research/skill.json": `{
  "id": "research",
  "title": "Research",
  "useWhen": "You must understand something before you can decide how to build it.",
  "inputs": ["a question worth bounding"],
  "outputs": ["an attempt log including the failures", "a conclusion proposed for approval"],
  "verify": ["the question is answered, not merely worked around", "every failed attempt is recorded"]
}
`,
```

The API integration skill, which the Shopify walkthrough showed the catalog was missing:

```javascript
  "skills/api-integration/SKILL.md": `# Skill: API Integration

Use when connecting our system to a third-party API.

## Method

1. Read the API documentation first and record the authentication method, the
   rate limits, and how pagination works.
2. Get one read call working before building anything on top of it.
3. Keep keys and tokens in environment variables. Nothing secret enters the
   workspace.
4. Handle pagination and retry before calling the integration done.

## Output

A working client, and the limits you found written down where the next person
will look.
`,
  "skills/api-integration/skill.json": `{
  "id": "api-integration",
  "title": "API Integration",
  "useWhen": "Connecting our system to a third-party API.",
  "inputs": ["API documentation", "the authentication method"],
  "outputs": ["a working client", "recorded rate limits and pagination rules"],
  "verify": ["one real read call succeeds", "no credential was written into the workspace"]
}
`,
```

The workflow that closes the loop:

```javascript
  "workflows/research-to-skill/WORKFLOW.md": `# Workflow: Research to Skill

Turning something you had to figure out into something nobody has to figure out
again.

1. \\\`awb research start --question "..."\\\` — bound the question before searching.
2. \\\`awb research attempt <id> --tried "..." --result ...\\\` after each try.
   Record the failures; they are what save the next person time.
3. \\\`awb research conclude <id> --text "..."\\\` when the question is answered.
4. \\\`awb memory approve <proposal-id>\\\` — you decide whether it becomes knowledge.
5. If the approach is worth repeating, write it up as a skill:
   \\\`skills/<id>/SKILL.md\\\` for the method and \\\`skills/<id>/skill.json\\\` for the
   contract. \\\`useWhen\\\` is the field that lets an agent pick it later, so write
   that one for a reader who does not already know what the skill does.
6. \\\`awb validate\\\` — a malformed contract is an error, a missing one a warning.
7. If it should be shared, open a pull request against the distribution. The
   maintainer decides what the whole team carries.

Do not promote after one success. A skill is a claim that the approach works
again.
`
};
```

Note the escaping: the file content is inside a JavaScript template literal, so every backtick in the Markdown must be written `\\\`` and every `${` must be written `\\${`. Run `node --check core/templates.js` after this step — it is in the check script for exactly this reason.

- [ ] **Step 4: Create the same files in this repository**

The distribution ships the shared catalog, so every key added in Step 3 must also exist as a real file at the repository root with byte-identical content. The existing pin test (`every committed capability catalog file matches the CAPABILITY_CATALOG template` in `test/onboarding.test.js`) enforces this.

Run: `npm test`
Expected: the pin test fails until every new file exists with matching content.

- [ ] **Step 5: Run the tests**

Run: `npm run check && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/templates.js skills workflows test/cli.test.js
git commit -m "feat: ship the research skill, its workflow, and catalog contracts"
```

---

### Task 6: Documentation and 0.5.0

**Files:**
- Modify: `core/core.js` (`PACKAGE_VERSION`), `package.json`
- Modify: `README.md`, `CHANGELOG.md`, `docs/CORE_SPEC.md`, `docs/REFERENCE.md`
- Test: `test/cli.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: no new code interfaces.

- [ ] **Step 1: Write the failing test**

Append to `test/cli.test.js`, before the `function awb(args) {` helper:

```javascript
test("the research loop is documented for a new reader", async () => {
  const readme = await readFile(path.join(repositoryRoot, "README.md"), "utf8");
  assert.match(readme, /awb research start/);
  assert.match(readme, /awb research conclude/);

  const expected = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")).version;
  assert.equal(expected, "0.5.0");
  assert.equal(awb(["version"]).stdout.trim(), "0.5.0");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — the README does not mention `awb research start` and the version is `0.4.0`.

- [ ] **Step 3: Bump the version**

In `core/core.js`: `export const PACKAGE_VERSION = "0.5.0";`
In `package.json`: `"version": "0.5.0",`

- [ ] **Step 4: Document the loop in `README.md`**

Add a section in Vietnamese, matching the file's existing voice, after the section `## Ghi lại điều đã học`:

```markdown
## Khi bạn chưa biết cách làm

Trước khi cam kết vào một hướng, hãy tìm hiểu — và ghi lại cả những lần thất
bại, vì đó mới là thứ giúp người sau đỡ mất thời gian.

```bash
node bin/awb.js research start --question "Shopify có webhook đơn hàng không?"
node bin/awb.js research attempt <id> --tried "Poll REST mỗi 30s" --result failed --note "429 sau 40 request/phút"
node bin/awb.js research attempt <id> --tried "Webhook orders/create" --result passed
node bin/awb.js research conclude <id> --text "Dùng webhook orders/create; polling dính 429."
```

`conclude` tạo một đề xuất chờ bạn duyệt — giống mọi bài học khác:

```bash
node bin/awb.js memory approve <proposal-id>
```

Nghiên cứu **không cần dự án** và **không bị chặn bởi onboarding**: nó chính là
thứ giúp bạn quyết định có nên tạo dự án hay không.

Nếu cách làm đó đáng lặp lại, hãy biến nó thành skill — xem
`workflows/research-to-skill/WORKFLOW.md`.
```

- [ ] **Step 5: Document skill contracts in `docs/REFERENCE.md`**

Add a section after `## Repository layout`:

```markdown
## Skill contracts

A skill may carry `skills/<id>/skill.json` beside its `SKILL.md`:

```json
{
  "id": "api-integration",
  "title": "API Integration",
  "useWhen": "Connecting our system to a third-party API.",
  "inputs": ["API documentation", "the authentication method"],
  "outputs": ["a working client", "recorded rate limits and pagination rules"],
  "verify": ["one real read call succeeds", "no credential was written into the workspace"]
}
```

`id`, `title`, and `useWhen` are required and `id` must equal the directory
name. `useWhen` is what an agent routes on: `awb skill list --json` returns it
for every contracted skill, so one call is enough to choose.

A missing contract is a warning from `awb validate`; a malformed one is an
error.
```

- [ ] **Step 6: Add the spec sections to `docs/CORE_SPEC.md`**

Add to the invariants list in section 2:

```
16. Research records answer a question before a project exists; they require no
    project and are not gated on onboarding.
17. A research conclusion enters knowledge only through the memory proposal
    approval lifecycle.
18. A skill contract is optional; when present it must name its own skill.
```

- [ ] **Step 7: Add the `0.5.0` entry to `CHANGELOG.md`**

```markdown
## 0.5.0 — 2026-08-28

### Added

- `awb research start|attempt|conclude|abandon|list|show` records a question,
  the plan for answering it, and every attempt including the failures. Research
  needs no project and is not gated on onboarding, because it is what tells you
  whether a project is worth creating.
- `awb research conclude` creates a memory proposal rather than writing
  knowledge directly, so a conclusion is approved through the same path as every
  other lesson.
- Skills may carry `skills/<id>/skill.json` declaring `useWhen`, `inputs`,
  `outputs`, and `verify`. `awb skill list --json` returns `useWhen` for every
  contracted skill, so one call is enough for an agent to choose a skill instead
  of guessing.
- `awb task context` reports the `useWhen` of each attached skill.
- The shipped catalog gains the `research` and `api-integration` skills, the
  `research-to-skill` workflow, and a contract for every skill.

### Changed

- `awb role|skill|workflow list --json` returns objects rather than id strings,
  so a single call carries what an agent needs to route.
- `awb validate` warns for a skill with no contract, errors for a malformed one
  or one naming a different skill, and validates research records.

`formatVersion` stays `0.3`; no migration is required, and `awb migrate` leaves
`work/research/` untouched.
```

- [ ] **Step 8: Run everything**

Run: `npm run check && npm test && node bin/awb.js validate`
Expected: all tests pass and the workspace validates.

- [ ] **Step 9: Commit**

```bash
git add core/core.js package.json README.md CHANGELOG.md docs test/cli.test.js
git commit -m "docs: document the research loop and release 0.5.0"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| 4.1 Research records | 1 |
| 4.2 Commands, including the enforced rules | 2, 3 |
| 4.2 Not gated on onboarding | 2 (asserted directly) |
| 4.3 Promotion is not a command | 5 (the workflow carries it) |
| 4.4 Skill contracts, required fields, id must match | 4 |
| 4.5 Reachable through list / show / task context | 4 |
| 4.6 Shipped content | 5 |
| 6.11 Research survives migrate | Covered by the existing migrate idempotence test; `migrateWorkspace` is untouched and `work/research/` is outside every path it writes |

**Type consistency**

`startResearch`, `getResearch`, `listResearch`, `addResearchAttempt`, `abandonResearch`, `saveResearch`, and `requireOpenResearch` are defined in Task 1 and used with identical signatures in Tasks 2 and 3. `concludeResearch` is defined in Task 3 and wired in the same task. `readSkillContract` and `listCapabilityEntries` are defined in Task 4 and used in the same task. `RESEARCH_DIRECTORY` is defined once and used only inside `core/research.js`.

**Corrections made during review**

- Task 4 changes the shape of `role|skill|workflow list --json` from strings to objects. Three existing assertions break; Step 5 names them and gives the replacement, and instructs a search for any others rather than assuming three is the complete count.
- `validateWorkspace` reads `work/research/` with `readdir` rather than importing `listResearch`, because `core/research.js` imports `core/core.js` and the reverse import would create a cycle.
- Task 5's template additions sit inside a JavaScript template literal; the escaping requirement for backticks is stated in the step rather than left to be discovered, and `core/templates.js` is already in the `check` script from the previous release.
- Task 4's test originally created a skill called `api-integration` and asserted that the shipped `code-review` carried no contract. Task 5 ships both, so the test would have passed in Task 4 and failed in Task 5. It now creates `local-contracted` and `local-bare`, two ids the catalog will never ship, so it holds regardless of what the catalog gains later.
- `test/cli.test.js` already imports every filesystem helper Task 4 needs; the step no longer asks for an import that exists.
