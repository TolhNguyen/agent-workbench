# Onboarding and Capability Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new workspace ships with real roles, skills, and workflows; the agent interviews the user before the first task; and every capability a task names is verified to exist.

**Architecture:** Core never prompts. It supplies state (`awb profile status`), owns the write (`awb profile complete`), refuses unknown capability references, and blocks `awb task create` until a profile exists. The conversation is the agent's job. Catalog content lives in `core/templates.js` next to the existing `START_HERE` and `USER_PROFILE` templates, and `initWorkspace` writes it the same way.

**Tech Stack:** Node.js >= 20, ES modules, zero third-party dependencies. Tests are `node --test` with `spawnSync` against `bin/awb.js`.

**Spec:** `docs/ONBOARDING.md`

## Global Constraints

- Node.js >= 20. No third-party packages, ever.
- `PACKAGE_VERSION` in `core/core.js` and `version` in `package.json` both become `0.4.0`. `FORMAT_VERSION` stays `"0.3"`.
- `awb migrate` is not modified by this plan.
- Every new command must work with `--json` and be asserted in `test/cli.test.js`.
- Every new option must be added to `COMMAND_OPTIONS` in `core/cli.js`, or the CLI will reject it as unknown.
- Every new boolean flag must be added to `BOOLEAN_OPTIONS` in `core/cli.js`, or it will swallow the next token as its value.
- Run `npm run check && npm test` before every commit. All tests must pass.
- Commit after each task.

---

### Task 1: Capability catalog templates and nested-init guard

**Files:**
- Modify: `core/templates.js` (append `CAPABILITY_CATALOG`)
- Modify: `core/core.js` (`findWorkspaceRoot`, `initWorkspace`)
- Modify: `core/cli.js` (`init` options)
- Test: `test/cli.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `CAPABILITY_CATALOG: Record<string, string>` in `core/templates.js` — maps workspace-relative path to file content.
  - `locateWorkspace(start: string): Promise<string | null>` in `core/core.js`.
  - `initWorkspace(root, { name, description, allowNested })` — new third option, default `false`.

- [ ] **Step 1: Write the failing tests**

Append to `test/cli.test.js`, before the `function awb(args)` helper:

```javascript
test("init ships a starter capability catalog", async () => {
  const root = await initializedWorkspace();

  assert.deepEqual(await readdir(path.join(root, "roles")), [
    "README.md",
    "developer",
    "reviewer",
    "technical-writer"
  ]);
  assert.equal(await fileExists(path.join(root, "roles", "developer", "ROLE.md")), true);
  assert.equal(
    await fileExists(path.join(root, "roles", "developer", "DEFINITION_OF_DONE.md")),
    true
  );
  assert.equal(await fileExists(path.join(root, "skills", "code-review", "SKILL.md")), true);
  assert.equal(
    await fileExists(path.join(root, "workflows", "feature-delivery", "WORKFLOW.md")),
    true
  );
});

test("init refuses to nest a workspace inside an existing one", async () => {
  const root = await initializedWorkspace();
  const nested = path.join(root, "src", "web", "sub");

  const refused = awb(["init", "--root", nested, "--name", "Nested"]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /already inside the workspace at/);
  assert.equal(await fileExists(path.join(nested, ".awb", "workspace.json")), false);

  const allowed = awb(["init", "--root", nested, "--name", "Nested", "--allow-nested"]);
  assertSuccess(allowed);
  assert.equal(await fileExists(path.join(nested, ".awb", "workspace.json")), true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: both new tests FAIL. The first fails because `roles/` contains only `README.md`. The second fails because the nested `init` succeeds instead of exiting 1.

- [ ] **Step 3: Add the catalog content to `core/templates.js`**

Append at the end of `core/templates.js`:

```javascript
// A starter catalog, not a finished taxonomy. A workspace owner is expected to
// edit these and add their own; they exist so that a fresh workspace has real
// capabilities to route to instead of three empty directories.
export const CAPABILITY_CATALOG = {
  "roles/developer/ROLE.md": `# Role: Developer

Builds and changes software in the registered projects.

## Responsibilities

- Understand the task scope before editing anything.
- Stay inside the task's write scope. Read access to a related project is not
  permission to change it.
- Prefer the smallest change that solves the stated problem.

## Expected outputs

- Source changes registered as artifacts.
- A short account of what was verified and how.
`,
  "roles/developer/DEFINITION_OF_DONE.md": `# Definition of Done: Developer

- The change does what the task objective describes.
- Automated tests covering the change pass, and the output was seen, not assumed.
- No credential, token, or connection string entered the workspace.
- Every deliverable is registered as an artifact and marked verified.
- Every quality gate on the task has passed.
`,
  "roles/reviewer/ROLE.md": `# Role: Reviewer

Reviews work produced by others against the task contract.

## Responsibilities

- Check the change against the task objective and definition of done.
- Report defects with a concrete failing case, not a general impression.
- Separate correctness problems from preferences, and say which is which.

## Expected outputs

- A findings list, most severe first.
- An explicit verdict on each quality gate the review covers.
`,
  "roles/reviewer/DEFINITION_OF_DONE.md": `# Definition of Done: Reviewer

- Every finding names a file, a line, and a way to reproduce it.
- Findings that could not be verified are labelled as unverified.
- The review states plainly whether the task may close.
`,
  "roles/technical-writer/ROLE.md": `# Role: Technical Writer

Produces documentation for a stated audience.

## Responsibilities

- Confirm who the reader is before writing; the task's audience field is the
  contract.
- Describe what the system does, verified against the system, not the ticket.
- Keep internal details out of user-facing documents.

## Expected outputs

- A document registered as an artifact.
- The audience it was written for.
`,
  "roles/technical-writer/DEFINITION_OF_DONE.md": `# Definition of Done: Technical Writer

- The document names its audience and stays at that audience's level.
- Every instruction was checked against the running system.
- No internal hostname, credential, or customer name appears in the text.
`,
  "skills/code-review/SKILL.md": `# Skill: Code Review

Use when reviewing a change before it merges.

## Method

1. Read the task objective first, then the diff. A change that is correct but
   unrelated to the objective is still a finding.
2. For each suspected defect, construct the input that triggers it. If you
   cannot, label the finding unverified rather than dropping or asserting it.
3. Rank by severity: wrong results first, then crashes, then maintainability.

## Output

A findings list. Each entry: file, line, what breaks, and the failing case.
`,
  "skills/debugging/SKILL.md": `# Skill: Debugging

Use when something fails and the cause is not yet known.

## Method

1. Reproduce the failure and keep the exact reproduction command.
2. Read the actual error output before forming a theory.
3. Form one hypothesis, then find the cheapest observation that would disprove
   it. Change one thing at a time.
4. Fix the cause, not the symptom. If you only know how to hide the symptom,
   say so.

## Output

The reproduction, the cause, the fix, and the evidence the fix works.
`,
  "skills/writing-user-guide/SKILL.md": `# Skill: Writing a User Guide

Use when producing instructions for someone who does not build the system.

## Method

1. Name the audience and the single task the guide accomplishes.
2. Perform the task yourself in the real system, recording each step.
3. Write the steps in the order the reader performs them, with the visible
   result of each step so the reader can tell whether it worked.
4. Cut anything the reader does not need to finish the task.

## Output

A document whose steps a reader can follow start to finish without help.
`,
  "workflows/feature-delivery/WORKFLOW.md": `# Workflow: Feature Delivery

1. \`awb task create\` with the role, projects, deliverables, and quality gates.
2. \`awb task context <task-id>\` to load scoped context.
3. Build the change inside the task write scope.
4. Verify: run the tests and read the output.
5. \`awb artifact add\` for each deliverable, with \`--verified\` once checked.
6. \`awb task gate-pass\` for each quality gate.
7. \`awb task verify\`, then \`awb task close\`.
8. \`awb memory propose\` for anything reusable that was learned.
`,
  "workflows/document-delivery/WORKFLOW.md": `# Workflow: Document Delivery

1. \`awb task create\` with the technical-writer role and an explicit
   \`--audience\`.
2. \`awb task context <task-id>\` and read the project knowledge it names.
3. Perform the documented task in the real system before writing about it.
4. Write the document into the task write scope.
5. \`awb artifact add\` with \`--kind\` matching the declared deliverable.
6. \`awb task gate-pass\` for review and sensitive-data checks.
7. \`awb task verify\`, then \`awb task close\`.
`
};
```

- [ ] **Step 4: Add the nested guard and catalog write to `core/core.js`**

Replace the whole `findWorkspaceRoot` function with:

```javascript
export async function locateWorkspace(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    if (await exists(path.join(current, ".awb", "workspace.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function findWorkspaceRoot(start = process.cwd()) {
  const found = await locateWorkspace(start);
  if (!found) throw new Error("No Agent Workbench found. Run `awb init` or pass --root.");
  return found;
}
```

Change the `initWorkspace` signature and add the guard. Replace:

```javascript
export async function initWorkspace(root, { name = "Agent Workbench", description = "" } = {}) {
  const target = path.resolve(root);
  const marker = path.join(target, ".awb", "workspace.json");
  if (await exists(marker)) throw new Error(`A workspace already exists at ${target}.`);
```

with:

```javascript
export async function initWorkspace(
  root,
  { name = "Agent Workbench", description = "", allowNested = false } = {}
) {
  const target = path.resolve(root);
  const marker = path.join(target, ".awb", "workspace.json");
  if (await exists(marker)) throw new Error(`A workspace already exists at ${target}.`);
  if (!allowNested) {
    // A workspace inside another workspace is almost always a mistyped --root:
    // findWorkspaceRoot walks upward and would silently pick the inner one.
    const enclosing = await locateWorkspace(path.dirname(target));
    if (enclosing) {
      throw new Error(
        `${target} is already inside the workspace at ${enclosing}. Use that workspace, or pass --allow-nested if a separate one is intended.`
      );
    }
  }
```

Add the catalog import at the top of `core/core.js`. Replace:

```javascript
import { DIRECTORY_READMES, START_HERE, USER_PROFILE } from "./templates.js";
```

with:

```javascript
import { CAPABILITY_CATALOG, DIRECTORY_READMES, START_HERE, USER_PROFILE } from "./templates.js";
```

Then, immediately after the last `writeText(target, "profile/README.md", ...)` line in `initWorkspace` and before `return { root: target, ... }`, add:

```javascript
  for (const [relativePath, content] of Object.entries(CAPABILITY_CATALOG)) {
    await writeText(target, relativePath, content, { overwrite: false });
  }
```

- [ ] **Step 5: Add the `--allow-nested` option to `core/cli.js`**

In `BOOLEAN_OPTIONS`, add `"allow-nested"`:

```javascript
const BOOLEAN_OPTIONS = new Set([
  "json", "create", "replace", "stdin", "help", "verified", "force", "allow-nested"
]);
```

In `COMMAND_OPTIONS`, change the `init` entry:

```javascript
  init: ["name", "description", "allow-nested"],
```

In the `init` branch of `dispatch`, pass the flag:

```javascript
    const result = await initWorkspace(root, {
      name: value(parsed, "name") || "Agent Workbench",
      description: value(parsed, "description") || "",
      allowNested: has(parsed, "allow-nested")
    });
```

- [ ] **Step 6: Create the catalog in this repository**

This repository is itself an initialized workspace, so the catalog must exist here too. Write each key of `CAPABILITY_CATALOG` to its path under the repository root. Verify:

Run: `ls roles skills workflows`
Expected: `developer`, `reviewer`, `technical-writer` under `roles/`; `code-review`, `debugging`, `writing-user-guide` under `skills/`; `feature-delivery`, `document-delivery` under `workflows/`.

- [ ] **Step 7: Run the tests**

Run: `npm run check && npm test`
Expected: PASS, both new tests included.

- [ ] **Step 8: Commit**

```bash
git add core/templates.js core/core.js core/cli.js roles skills workflows test/cli.test.js
git commit -m "feat: ship a starter capability catalog and refuse nested init"
```

---

### Task 2: Capability discovery commands

**Files:**
- Modify: `core/core.js` (add `capabilityDirectory`, `listCapabilities`, `showCapability`)
- Modify: `core/cli.js` (add `role`/`skill`/`workflow` command groups)
- Test: `test/cli.test.js`

**Interfaces:**
- Consumes: `CAPABILITY_CATALOG` from Task 1, and the existing `listDirectDirectories(root, relativeDirectory)` and `listFilesRecursively(root, relativeDirectory, limit)`.
- Produces:
  - `capabilityDirectory(kind: "role"|"skill"|"workflow"): string`
  - `listCapabilities(root, kind): Promise<string[]>`
  - `showCapability(root, kind, id): Promise<{kind, id, path, files: string[]}>`
  - `assertCapabilityExists(root, kind, id): Promise<string>` — returns the id, throws naming the available ids. Task 3 and Task 5 both use this.

- [ ] **Step 1: Write the failing test**

Append to `test/cli.test.js` before the `function awb(args)` helper:

```javascript
test("capability catalogs are discoverable for every kind", async () => {
  const root = await initializedWorkspace();

  assert.deepEqual(
    JSON.parse(awb(["--root", root, "--json", "skill", "list"]).stdout),
    ["code-review", "debugging", "writing-user-guide"]
  );
  assert.deepEqual(
    JSON.parse(awb(["--root", root, "--json", "workflow", "list"]).stdout),
    ["document-delivery", "feature-delivery"]
  );

  const shown = JSON.parse(awb(["--root", root, "--json", "role", "show", "developer"]).stdout);
  assert.equal(shown.id, "developer");
  assert.equal(shown.path, "roles/developer");
  assert.deepEqual(shown.files.sort(), [
    "roles/developer/DEFINITION_OF_DONE.md",
    "roles/developer/ROLE.md"
  ]);

  const missing = awb(["--root", root, "role", "show", "nope"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Unknown role: nope\. Available: developer, reviewer, technical-writer\./);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL with `Unknown command: skill. Run \`awb help\`.`

- [ ] **Step 3: Add the core functions**

Add to `core/core.js`, immediately after `listDirectDirectories`:

```javascript
const CAPABILITY_DIRECTORIES = { role: "roles", skill: "skills", workflow: "workflows" };

export function capabilityDirectory(kind) {
  const directory = CAPABILITY_DIRECTORIES[kind];
  if (!directory) throw new Error(`Unknown capability kind: ${kind}`);
  return directory;
}

export async function listCapabilities(root, kind) {
  return listDirectDirectories(root, capabilityDirectory(kind));
}

export async function showCapability(root, kind, id) {
  const safeId = await assertCapabilityExists(root, kind, normalizeId(id, `${kind} ID`));
  const relativeDirectory = `${capabilityDirectory(kind)}/${safeId}`;
  return {
    kind,
    id: safeId,
    path: relativeDirectory,
    files: await listFilesRecursively(root, relativeDirectory, 50)
  };
}

// Names what does exist instead of guessing at a correction: an agent reading
// the error can pick a real ID from it without another round trip.
export async function assertCapabilityExists(root, kind, id) {
  const directory = capabilityDirectory(kind);
  if (await exists(path.join(root, directory, id))) return id;
  const available = await listCapabilities(root, kind);
  if (!available.length) {
    throw new Error(`Unknown ${kind}: ${id}. No ${directory}/ entries exist yet.`);
  }
  const shown = available.slice(0, 10).join(", ");
  const more = available.length > 10 ? `, and ${available.length - 10} more` : "";
  throw new Error(`Unknown ${kind}: ${id}. Available: ${shown}${more}.`);
}
```

- [ ] **Step 4: Add the CLI groups**

In `core/cli.js`, add to the `core.js` import list, in alphabetical position: `assertCapabilityExists`, `listCapabilities`, `showCapability`.

Add to `COMMAND_OPTIONS`, after the `"relation list"` entry:

```javascript
  "role list": [],
  "role show": [],
  "skill list": [],
  "skill show": [],
  "workflow list": [],
  "workflow show": [],
```

Add these cases to the `switch (group)` in `dispatch`, after `case "relation":`:

```javascript
    case "role":
    case "skill":
    case "workflow":
      command = await capabilityCommand(root, group, action, positionals);
      break;
```

Add the command handler next to `relationCommand`:

```javascript
async function capabilityCommand(root, kind, action, positionals) {
  if (action === "list") {
    const items = await listCapabilities(root, kind);
    return {
      data: items,
      text: () => (items.length ? items.map((item) => `- ${item}`).join("\n") : `No ${kind}s found.`)
    };
  }
  if (action === "show") {
    const id = positionals[0];
    if (!id) throw new Error(`Usage: awb ${kind} show <${kind}-id>`);
    const capability = await showCapability(root, kind, id);
    return {
      data: capability,
      text: () =>
        [`${kind}: ${capability.id}`, `Path: ${capability.path}`, "Files:", ...capability.files.map((file) => `- ${file}`)].join("\n")
    };
  }
  throw new Error(`Usage: awb ${kind} list|show`);
}
```

Add to the `Commands:` block of `helpFor`'s `common` string, after the `relation add|list` line:

```
  role|skill|workflow list|show
                               Inspect the capability catalog
```

- [ ] **Step 5: Run the tests**

Run: `npm run check && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/core.js core/cli.js test/cli.test.js
git commit -m "feat: add role, skill, and workflow discovery commands"
```

---

### Task 3: Reject and report dangling capability references

**Files:**
- Modify: `core/core.js` (`createTask`, `validateWorkspace`)
- Test: `test/cli.test.js`

**Interfaces:**
- Consumes: `assertCapabilityExists(root, kind, id)` and `capabilityDirectory(kind)` from Task 2.
- Produces: no new exports. `createTask` gains validation; `validateWorkspace` gains errors on active tasks and warnings on closed ones.

- [ ] **Step 1: Write the failing test**

Append to `test/cli.test.js` before the `function awb(args)` helper:

```javascript
test("a task cannot name a role, skill, or workflow that does not exist", async () => {
  const root = await initializedWorkspace();
  assertSuccess(awb(["--root", root, "project", "add", "app", "--path", "src/app", "--create"]));

  const badRole = awb([
    "--root", root, "task", "create", "--id", "TASK-A", "--title", "X",
    "--role", "khong-co-that", "--project", "app"
  ]);
  assert.equal(badRole.status, 1);
  assert.match(badRole.stderr, /Unknown role: khong-co-that\. Available: developer/);

  const badSkill = awb([
    "--root", root, "task", "create", "--id", "TASK-B", "--title", "X",
    "--role", "developer", "--skill", "cung-khong-co", "--project", "app"
  ]);
  assert.equal(badSkill.status, 1);
  assert.match(badSkill.stderr, /Unknown skill: cung-khong-co/);

  const badWorkflow = awb([
    "--root", root, "task", "create", "--id", "TASK-C", "--title", "X",
    "--role", "developer", "--workflow", "bia-dat", "--project", "app"
  ]);
  assert.equal(badWorkflow.status, 1);
  assert.match(badWorkflow.stderr, /Unknown workflow: bia-dat/);

  assert.deepEqual(await readdir(path.join(root, "work", "tasks")), [], "no task file may be left behind");
});

test("validate errors on a dangling reference from an active task and warns for a closed one", async () => {
  const root = await initializedWorkspace();
  assertSuccess(awb(["--root", root, "project", "add", "app", "--path", "src/app", "--create"]));
  assertSuccess(
    awb([
      "--root", root, "task", "create", "--id", "TASK-D", "--title", "X",
      "--role", "reviewer", "--project", "app"
    ])
  );

  // Remove the role after the task was created.
  await rm(path.join(root, "roles", "reviewer"), { recursive: true, force: true });

  let validation = JSON.parse(awb(["--root", root, "--json", "validate"]).stdout);
  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.some((message) => message === "Task TASK-D references unknown role: reviewer"),
    true,
    validation.errors.join("; ")
  );

  const task = JSON.parse(await readFile(path.join(root, "work", "tasks", "TASK-D.json"), "utf8"));
  task.status = "closed";
  await writeFile(path.join(root, "work", "tasks", "TASK-D.json"), JSON.stringify(task, null, 2), "utf8");

  validation = JSON.parse(awb(["--root", root, "--json", "validate"]).stdout);
  assert.equal(validation.valid, true, validation.errors.join("; "));
  assert.equal(
    validation.warnings.some((message) => message === "Task TASK-D references unknown role: reviewer"),
    true,
    validation.warnings.join("; ")
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL. `task create` exits 0 for all three bad references, and `validate` reports `valid: true`.

- [ ] **Step 3: Validate references in `createTask`**

In `core/core.js`, inside `createTask`, replace:

```javascript
  const primaryRole = normalizeId(input.primaryRole || "developer", "Role ID");
```

with:

```javascript
  const primaryRole = await assertCapabilityExists(
    root,
    "role",
    normalizeId(input.primaryRole || "developer", "Role ID")
  );
  const supportingRoles = [];
  for (const role of unique(input.supportingRoles ?? [])) {
    supportingRoles.push(await assertCapabilityExists(root, "role", normalizeId(role, "Role ID")));
  }
  const skills = [];
  for (const skill of unique(input.skills ?? [])) {
    skills.push(await assertCapabilityExists(root, "skill", normalizeId(skill, "Skill ID")));
  }
  const workflows = [];
  for (const workflow of unique(input.workflows ?? [])) {
    workflows.push(await assertCapabilityExists(root, "workflow", normalizeId(workflow, "Workflow ID")));
  }
```

Then, in the `const task = { ... }` object literal below, replace these three lines:

```javascript
    supportingRoles: unique(input.supportingRoles ?? []).map((role) => normalizeId(role, "Role ID")),
```
```javascript
    skills: unique(input.skills ?? []).map((skill) => normalizeId(skill, "Skill ID")),
    workflows: unique(input.workflows ?? []).map((workflow) => normalizeId(workflow, "Workflow ID")),
```

with:

```javascript
    supportingRoles,
```
```javascript
    skills,
    workflows,
```

- [ ] **Step 4: Report dangling references in `validateWorkspace`**

In `core/core.js`, inside `validateWorkspace`, find the task loop and add the capability check. Replace:

```javascript
    for (const task of tasks) {
      errors.push(...validateAgainstSchema(task, schemas.task, `Task ${task.id}`));
```

with:

```javascript
    for (const task of tasks) {
      errors.push(...validateAgainstSchema(task, schemas.task, `Task ${task.id}`));
      // A capability removed after a task closed is history, not a defect.
      const sink = task.status === "active" ? errors : warnings;
      const references = [
        ["role", [task.primaryRole, ...(task.supportingRoles ?? [])]],
        ["skill", task.skills ?? []],
        ["workflow", task.workflows ?? []]
      ];
      for (const [kind, ids] of references) {
        for (const id of ids) {
          if (!id) continue;
          if (!(await exists(path.join(root, capabilityDirectory(kind), id)))) {
            sink.push(`Task ${task.id} references unknown ${kind}: ${id}`);
          }
        }
      }
```

- [ ] **Step 5: Run the tests**

Run: `npm run check && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/core.js test/cli.test.js
git commit -m "feat: reject and report dangling capability references"
```

---

### Task 4: Onboarding state and `awb profile status`

**Files:**
- Modify: `core/templates.js` (add `ONBOARDING_QUESTIONS`)
- Modify: `core/core.js` (add `USER_PROFILE_PATH`, `getOnboarding`, `profileStatus`)
- Modify: `core/cli.js` (`profile status`)
- Modify: `schemas/workspace.schema.json`
- Test: `test/cli.test.js`

**Interfaces:**
- Consumes: `listCapabilities(root, kind)` from Task 2.
- Produces:
  - `USER_PROFILE_PATH = "user/PROFILE.md"` in `core/core.js`.
  - `getOnboarding(root): Promise<{complete: boolean, completedAt: string|null}>` — Task 5 and Task 6 both use this.
  - `profileStatus(root): Promise<{complete, completedAt, profilePath, questions, catalog}>`
  - `ONBOARDING_QUESTIONS: Array<{id, prompt, kind, required, catalog?}>` in `core/templates.js`.

- [ ] **Step 1: Write the failing test**

Append to `test/cli.test.js` before the `function awb(args)` helper:

```javascript
test("profile status reports the gate, the questions, and the catalog", async () => {
  const root = await initializedWorkspace();

  const status = JSON.parse(awb(["--root", root, "--json", "profile", "status"]).stdout);
  assert.equal(status.complete, false);
  assert.equal(status.completedAt, null);
  assert.equal(status.profilePath, "user/PROFILE.md");
  assert.deepEqual(status.catalog.roles, ["developer", "reviewer", "technical-writer"]);

  const ids = status.questions.map((question) => question.id);
  assert.deepEqual(ids, [
    "name", "role", "language", "responsibilities",
    "systems", "skills", "principles", "constraints"
  ]);
  for (const question of status.questions) {
    assert.equal(typeof question.prompt, "string");
    assert.ok(question.prompt.length > 0, `${question.id} needs a prompt`);
    assert.ok(["text", "list", "choice"].includes(question.kind), `${question.id} kind`);
  }
  assert.equal(status.questions.find((q) => q.id === "role").catalog, "roles");
  assert.equal(status.questions.find((q) => q.id === "skills").catalog, "skills");

  // Missing PROFILE.md must not break the command that diagnoses the workspace.
  await rm(path.join(root, "user", "PROFILE.md"), { force: true });
  const withoutProfile = awb(["--root", root, "--json", "profile", "status"]);
  assertSuccess(withoutProfile);
  assert.equal(JSON.parse(withoutProfile.stdout).complete, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL with `Usage: awb profile build`.

- [ ] **Step 3: Add the questions to `core/templates.js`**

Append to `core/templates.js`:

```javascript
// Asked in English and stored in English; the agent conducts the interview in
// whatever language the user speaks and records the answers here.
export const ONBOARDING_QUESTIONS = [
  { id: "name", kind: "text", required: true, prompt: "What should I call you?" },
  {
    id: "role",
    kind: "choice",
    required: true,
    catalog: "roles",
    prompt: "Which role best describes your main work here?"
  },
  {
    id: "language",
    kind: "text",
    required: true,
    prompt: "Which language should I write and talk to you in?"
  },
  {
    id: "responsibilities",
    kind: "list",
    required: true,
    prompt: "What are you responsible for day to day?"
  },
  {
    id: "systems",
    kind: "list",
    required: false,
    prompt: "Which systems, products, or codebases do you own or touch most?"
  },
  {
    id: "skills",
    kind: "list",
    required: false,
    catalog: "skills",
    prompt: "Which of these skills do you expect to need regularly?"
  },
  {
    id: "principles",
    kind: "list",
    required: false,
    prompt: "How do you prefer work to be done? Anything I should always do?"
  },
  {
    id: "constraints",
    kind: "list",
    required: false,
    prompt: "Anything I must never do, or must ask you before doing?"
  }
];
```

- [ ] **Step 4: Add the core functions**

In `core/core.js`, extend the templates import to include `ONBOARDING_QUESTIONS`:

```javascript
import {
  CAPABILITY_CATALOG,
  DIRECTORY_READMES,
  ONBOARDING_QUESTIONS,
  START_HERE,
  USER_PROFILE
} from "./templates.js";
```

Add next to the other file-path constants near the top:

```javascript
export const USER_PROFILE_PATH = "user/PROFILE.md";
```

Add after `touchWorkspace`:

```javascript
export async function getOnboarding(root) {
  const workspace = await getWorkspace(root);
  const onboarding = workspace.onboarding ?? {};
  // A workspace with no key at all predates onboarding, which is exactly the
  // state the interview exists to fix.
  return { complete: onboarding.complete === true, completedAt: onboarding.completedAt ?? null };
}

export async function profileStatus(root) {
  const { complete, completedAt } = await getOnboarding(root);
  const [roles, skills, workflows] = await Promise.all([
    listCapabilities(root, "role"),
    listCapabilities(root, "skill"),
    listCapabilities(root, "workflow")
  ]);
  return {
    complete,
    completedAt,
    profilePath: USER_PROFILE_PATH,
    questions: structuredClone(ONBOARDING_QUESTIONS),
    catalog: { roles, skills, workflows }
  };
}
```

- [ ] **Step 5: Add the schema property**

In `schemas/workspace.schema.json`, add inside `properties`, after `updatedAt`:

```json
    "onboarding": {
      "type": "object",
      "required": ["complete"],
      "properties": {
        "complete": { "type": "boolean" },
        "completedAt": { "type": ["string", "null"], "format": "date-time" }
      },
      "additionalProperties": false
    }
```

- [ ] **Step 6: Wire the CLI**

In `core/cli.js`, add `profileStatus` to the `core.js` import list in alphabetical position.

Change the `COMMAND_OPTIONS` profile entries to:

```javascript
  "profile build": [],
  "profile status": [],
```

Replace the `case "profile":` block in `dispatch` with:

```javascript
    case "profile": {
      if (action === "status") {
        const status = await profileStatus(root);
        command = { data: status, text: () => formatProfileStatus(status) };
        break;
      }
      if (action !== "build") throw new Error("Usage: awb profile build|status");
      const profile = await buildProfile(root);
      command = {
        data: profile,
        text: () =>
          `Profile generated: ${profile.path}\nProjects: ${profile.counts.projects}\nProviders: ${profile.counts.providers}\nActive tasks: ${profile.counts.activeTasks}`
      };
      break;
    }
```

Add the formatter next to `formatValidation`:

```javascript
function formatProfileStatus(status) {
  if (status.complete) {
    return [
      "Onboarding is complete.",
      `Profile: ${status.profilePath}`,
      `Completed: ${status.completedAt ?? "unknown"}`
    ].join("\n");
  }
  return [
    "Onboarding is not complete. Interview the user with these questions, then",
    "record the answers with `awb profile complete`.",
    "",
    ...status.questions.map(
      (question) =>
        `- ${question.id}${question.required ? " (required)" : ""}: ${question.prompt}` +
        (question.catalog ? `\n  Choose from ${question.catalog}: ${status.catalog[question.catalog].join(", ")}` : "")
    )
  ].join("\n");
}
```

Update the `profile build` line in `helpFor`'s `common` string:

```
  profile build|status         Generate profile/index.html; report onboarding
```

- [ ] **Step 7: Run the tests**

Run: `npm run check && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add core/templates.js core/core.js core/cli.js schemas/workspace.schema.json test/cli.test.js
git commit -m "feat: add onboarding state and awb profile status"
```

---

### Task 5: `awb profile complete`

**Files:**
- Modify: `core/core.js` (add `completeProfile`, `renderUserProfile`)
- Modify: `core/cli.js` (`profile complete`)
- Test: `test/cli.test.js`

**Interfaces:**
- Consumes: `getOnboarding`, `USER_PROFILE_PATH` (Task 4); `assertCapabilityExists` (Task 2); existing `USER_PROFILE` template, `writeText`, `writeJson`, `unique`, `nowIso`.
- Produces: `completeProfile(root, input): Promise<{profilePath, name, role, language, skills, completedAt}>` where `input` is `{name, role, language, responsibilities: string[], systems: string[], skills: string[], principles: string[], constraints: string[], replace: boolean}`.

- [ ] **Step 1: Write the failing test**

Append to `test/cli.test.js` before the `function awb(args)` helper:

```javascript
test("profile complete validates answers, writes the profile, and guards overwrites", async () => {
  const root = await initializedWorkspace();

  const badRole = awb([
    "--root", root, "profile", "complete",
    "--name", "Tin", "--role", "khong-co-that", "--language", "vi",
    "--responsibility", "Ship the POS integrations"
  ]);
  assert.equal(badRole.status, 1);
  assert.match(badRole.stderr, /Unknown role: khong-co-that\. Available: developer/);

  const noResponsibility = awb([
    "--root", root, "profile", "complete",
    "--name", "Tin", "--role", "developer", "--language", "vi"
  ]);
  assert.equal(noResponsibility.status, 1);
  assert.match(noResponsibility.stderr, /At least one responsibility is required/);

  const completed = awb([
    "--root", root, "--json", "profile", "complete",
    "--name", "Tin", "--role", "developer", "--language", "vi",
    "--responsibility", "Ship the POS integrations",
    "--system", "order-api",
    "--skill", "debugging",
    "--principle", "Verify before claiming done",
    "--constraint", "Never touch production data"
  ]);
  assertSuccess(completed);
  assert.equal(JSON.parse(completed.stdout).role, "developer");

  const profile = await readFile(path.join(root, "user", "PROFILE.md"), "utf8");
  assert.match(profile, /Tin/);
  assert.match(profile, /developer/);
  assert.match(profile, /Ship the POS integrations/);
  assert.match(profile, /Never touch production data/);

  const workspace = JSON.parse(await readFile(path.join(root, ".awb", "workspace.json"), "utf8"));
  assert.equal(workspace.onboarding.complete, true);
  assert.ok(workspace.onboarding.completedAt);

  const status = JSON.parse(awb(["--root", root, "--json", "profile", "status"]).stdout);
  assert.equal(status.complete, true);

  const again = awb([
    "--root", root, "profile", "complete",
    "--name", "Tin", "--role", "reviewer", "--language", "vi",
    "--responsibility", "Review"
  ]);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already complete/);

  const replaced = awb([
    "--root", root, "profile", "complete", "--replace",
    "--name", "Tin", "--role", "reviewer", "--language", "vi",
    "--responsibility", "Review"
  ]);
  assertSuccess(replaced);
  assert.match(await readFile(path.join(root, "user", "PROFILE.md"), "utf8"), /reviewer/);

  assertSuccess(awb(["--root", root, "validate"]));
});

test("profile complete refuses to overwrite a hand-edited profile", async () => {
  const root = await initializedWorkspace();
  await writeFile(path.join(root, "user", "PROFILE.md"), "# My own notes\n\nHand written.\n", "utf8");

  const refused = awb([
    "--root", root, "profile", "complete",
    "--name", "Tin", "--role", "developer", "--language", "vi",
    "--responsibility", "Ship things"
  ]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /has been edited/);
  assert.match(await readFile(path.join(root, "user", "PROFILE.md"), "utf8"), /Hand written/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL with `Usage: awb profile build|status`.

- [ ] **Step 3: Implement `completeProfile`**

Add to `core/core.js`, after `profileStatus`:

```javascript
export async function completeProfile(root, input = {}) {
  const { complete } = await getOnboarding(root);
  const target = path.join(root, USER_PROFILE_PATH);
  const current = (await exists(target)) ? await readFile(target, "utf8") : null;
  const untouched = current === null || current.trim() === USER_PROFILE.trim();

  // The rule is "do not overwrite content Core did not write", which covers a
  // re-run and a profile the user filled in by hand before the interview.
  if (!input.replace) {
    if (complete) {
      throw new Error("Onboarding is already complete. Pass --replace to record new answers.");
    }
    if (!untouched) {
      throw new Error(
        `${USER_PROFILE_PATH} has been edited. Pass --replace to overwrite it with the interview answers.`
      );
    }
  }

  const name = requiredAnswer(input.name, "Name");
  const language = requiredAnswer(input.language, "Preferred language");
  const role = await assertCapabilityExists(root, "role", normalizeId(input.role, "Role ID"));
  const skills = [];
  for (const skill of unique(input.skills ?? [])) {
    skills.push(await assertCapabilityExists(root, "skill", normalizeId(skill, "Skill ID")));
  }
  const responsibilities = unique(input.responsibilities ?? []);
  if (responsibilities.length === 0) throw new Error("At least one responsibility is required.");
  const systems = unique(input.systems ?? []);
  const principles = unique(input.principles ?? []);
  const constraints = unique(input.constraints ?? []);

  await writeText(
    root,
    USER_PROFILE_PATH,
    renderUserProfile({ name, role, language, responsibilities, systems, skills, principles, constraints })
  );

  const completedAt = nowIso();
  const workspace = await getWorkspace(root);
  workspace.onboarding = { complete: true, completedAt };
  workspace.updatedAt = completedAt;
  await writeJson(root, ".awb/workspace.json", workspace);

  return { profilePath: USER_PROFILE_PATH, name, role, language, skills, completedAt };
}

function requiredAnswer(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function renderUserProfile(answers) {
  const section = (title, items, empty) => [
    `## ${title}`,
    "",
    ...(items.length ? items.map((item) => `- ${item}`) : [`- ${empty}`]),
    ""
  ];
  return [
    "# User Profile",
    "",
    "Recorded by `awb profile complete`. Edit freely; re-running the interview",
    "requires `--replace`.",
    "",
    "## About",
    "",
    `- Name: ${answers.name}`,
    `- Primary role: ${answers.role}`,
    `- Preferred language: ${answers.language}`,
    "",
    ...section("Primary responsibilities", answers.responsibilities, "Not recorded."),
    ...section("Systems and codebases", answers.systems, "Not recorded."),
    ...section("Frequently needed skills", answers.skills, "Not recorded."),
    ...section("Working principles", answers.principles, "Not recorded."),
    ...section("Constraints", answers.constraints, "None recorded.")
  ].join("\n");
}
```

- [ ] **Step 4: Wire the CLI**

In `core/cli.js`, add `completeProfile` to the `core.js` import list in alphabetical position.

Add to `COMMAND_OPTIONS`:

```javascript
  "profile complete": [
    "name", "role", "language", "responsibility", "system", "skill",
    "principle", "constraint", "replace"
  ],
```

In the `case "profile":` block, add before the `if (action !== "build")` line:

```javascript
      if (action === "complete") {
        const recorded = await completeProfile(root, {
          name: value(parsed, "name"),
          role: value(parsed, "role"),
          language: value(parsed, "language"),
          responsibilities: values(parsed, "responsibility"),
          systems: values(parsed, "system"),
          skills: values(parsed, "skill"),
          principles: values(parsed, "principle"),
          constraints: values(parsed, "constraint"),
          replace: has(parsed, "replace")
        });
        command = {
          data: recorded,
          text: () =>
            `Profile recorded: ${recorded.profilePath}\nName: ${recorded.name}\nRole: ${recorded.role}\nLanguage: ${recorded.language}`
        };
        break;
      }
```

and change the usage error to `"Usage: awb profile build|status|complete"`.

Update the help line:

```
  profile build|status|complete
                               Generate the HTML view; run onboarding
```

Add a `profile` entry to the `details` map in `helpFor`:

```javascript
    profile: `Profile commands:
  awb profile status
  awb profile complete --name <text> --role <role-id> --language <text>
                       --responsibility <text> [--responsibility <text>]
                       [--system <text>] [--skill <skill-id>]
                       [--principle <text>] [--constraint <text>] [--replace]
  awb profile build`,
```

- [ ] **Step 5: Run the tests**

Run: `npm run check && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/core.js core/cli.js test/cli.test.js
git commit -m "feat: add awb profile complete"
```

---

### Task 6: Gate `task create` on onboarding

**Files:**
- Modify: `core/core.js` (`createTask`)
- Modify: `core/cli.js` (`--skip-onboarding`)
- Modify: `test/cli.test.js` (new `onboardedWorkspace` helper; update existing task-creating tests)

**Interfaces:**
- Consumes: `getOnboarding(root)` from Task 4.
- Produces: `createTask(root, input)` honours `input.skipOnboarding: boolean`. A new test helper `onboardedWorkspace(): Promise<string>`.

**Note on test churn:** this task makes every existing `task create` call fail. Five tests create tasks: *a task can contain several related projects*, *CS documentation task enforces write scope*, *artifact paths cannot escape*, *task identifiers are stored uppercase*, *migrate canonicalizes lowercase task files*, and *knowledge scope filters*. They must switch from `initializedWorkspace()` to `onboardedWorkspace()`. `initializedWorkspace()` stays, because Tasks 1–5 assert on a workspace that has not been onboarded.

- [ ] **Step 1: Write the failing test**

Append to `test/cli.test.js` before the `function awb(args)` helper:

```javascript
test("task create is blocked until the user has been interviewed", async () => {
  const root = await initializedWorkspace();
  assertSuccess(awb(["--root", root, "project", "add", "app", "--path", "src/app", "--create"]));

  const gated = awb([
    "--root", root, "task", "create", "--id", "TASK-GATE", "--title", "X",
    "--role", "developer", "--project", "app"
  ]);
  assert.equal(gated.status, 1);
  assert.match(gated.stderr, /no user profile yet/);
  assert.deepEqual(await readdir(path.join(root, "work", "tasks")), [], "no task file may be left behind");

  // The escape hatch exists for automation.
  assertSuccess(
    awb([
      "--root", root, "task", "create", "--id", "TASK-SKIP", "--title", "X",
      "--role", "developer", "--project", "app", "--skip-onboarding"
    ])
  );

  // Reading and diagnosing must keep working before onboarding.
  assertSuccess(awb(["--root", root, "validate"]));
  assertSuccess(awb(["--root", root, "role", "list"]));
  assertSuccess(awb(["--root", root, "task", "list"]));

  assertSuccess(
    awb([
      "--root", root, "profile", "complete",
      "--name", "Tin", "--role", "developer", "--language", "vi",
      "--responsibility", "Ship the POS integrations"
    ])
  );
  assertSuccess(
    awb([
      "--root", root, "task", "create", "--id", "TASK-OK", "--title", "X",
      "--role", "developer", "--project", "app"
    ])
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — the gated `task create` exits 0 instead of 1.

- [ ] **Step 3: Add the gate**

In `core/core.js`, insert at the very top of `createTask`, before the `const id = ...` line:

```javascript
  // The gate lives here rather than only in START_HERE.md, so an agent that
  // never reads the protocol file still cannot start work on a guess.
  if (!input.skipOnboarding) {
    const { complete } = await getOnboarding(root);
    if (!complete) {
      throw new Error(
        "This workspace has no user profile yet. Run `awb profile status` and complete the interview, or pass --skip-onboarding for a one-off task."
      );
    }
  }
```

- [ ] **Step 4: Wire the flag**

In `core/cli.js`, add `"skip-onboarding"` to `BOOLEAN_OPTIONS`:

```javascript
const BOOLEAN_OPTIONS = new Set([
  "json", "create", "replace", "stdin", "help", "verified", "force",
  "allow-nested", "skip-onboarding"
]);
```

Add `"skip-onboarding"` to the end of the `"task create"` array in `COMMAND_OPTIONS`.

In `taskCommand`, add to the `createTask` call:

```javascript
      skipOnboarding: has(parsed, "skip-onboarding"),
```

Add to the `task` entry of the `details` map in `helpFor`, after the `awb task create ...` lines:

```
                  [--skip-onboarding]
```

- [ ] **Step 5: Add the onboarded helper and update existing tests**

Add next to `initializedWorkspace` in `test/cli.test.js`:

```javascript
async function onboardedWorkspace() {
  const root = await initializedWorkspace();
  assertSuccess(
    awb([
      "--root", root, "profile", "complete",
      "--name", "Test User", "--role", "developer", "--language", "en",
      "--responsibility", "Exercise the Workbench in tests"
    ])
  );
  return root;
}
```

Change `const root = await initializedWorkspace();` to `const root = await onboardedWorkspace();` in exactly these tests:

- `a task can contain several related projects and returns compact context`
- `CS documentation task enforces write scope and closes only after verified artifacts and gates`
- `artifact paths cannot escape the project source root on any platform`
- `task identifiers are stored uppercase regardless of the casing supplied`
- `migrate canonicalizes lowercase task files and repoints everything at them`
- `knowledge scope filters are canonicalized the same way stored scopes are`

Leave every other test on `initializedWorkspace()`.

- [ ] **Step 6: Run the tests**

Run: `npm run check && npm test`
Expected: PASS, all tests.

- [ ] **Step 7: Commit**

```bash
git add core/core.js core/cli.js test/cli.test.js
git commit -m "feat: require onboarding before the first task"
```

---

### Task 7: Protocol, documentation, and version

**Files:**
- Modify: `core/templates.js` (`START_HERE`)
- Modify: `START_HERE.md`
- Modify: `core/core.js` (`PACKAGE_VERSION`)
- Modify: `package.json`
- Modify: `README.md`, `CHANGELOG.md`
- Test: `test/cli.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: no new code interfaces.

- [ ] **Step 1: Write the failing test**

Append to `test/cli.test.js` before the `function awb(args)` helper:

```javascript
test("a fresh workspace tells the agent to run the interview first", async () => {
  const root = await initializedWorkspace();
  const startHere = await readFile(path.join(root, "START_HERE.md"), "utf8");
  assert.match(startHere, /awb profile status/);
  assert.match(startHere, /awb profile complete/);

  const repoStartHere = await readFile(path.join(repositoryRoot, "START_HERE.md"), "utf8");
  assert.match(repoStartHere, /awb profile status/);

  const expected = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")).version;
  assert.equal(expected, "0.4.0");
  assert.equal(awb(["version"]).stdout.trim(), "0.4.0");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `START_HERE.md` has no `awb profile status`, and the version is `0.3.1`.

- [ ] **Step 3: Add the protocol step to both `START_HERE` copies**

In `core/templates.js`, in the `START_HERE` template's `## Operating model` list, insert a new item 1 and renumber the rest:

```
1. Run \`awb profile status\`. If it reports that onboarding is not complete,
   interview the user with the questions it returns before starting any task,
   then record the answers with \`awb profile complete\`. Do not guess who the
   user is or which skills apply.
2. Work from the workspace root, not from a single source repository.
```

Make the same insertion at the top of the `## First actions` list in the repository's own `START_HERE.md`, renumbering its existing items 1-11 to 2-12.

- [ ] **Step 4: Bump the version**

In `core/core.js`:

```javascript
export const PACKAGE_VERSION = "0.4.0";
```

In `package.json`:

```json
  "version": "0.4.0",
```

- [ ] **Step 5: Document the flow**

Add a section to `README.md` after the "Ready after unzip or clone" section:

```markdown
## First run

A new workspace has no user profile. Before the first task, the agent runs:

```bash
node bin/awb.js profile status
```

If onboarding is incomplete, the command returns the interview questions and
the catalog of available roles and skills. The agent asks the user those
questions in the user's own language and records the answers:

```bash
node bin/awb.js profile complete \
  --name "..." --role developer --language vi \
  --responsibility "..." --system order-api --skill debugging
```

Until this is done, `awb task create` refuses to run. Automation that must
bypass the interview can pass `--skip-onboarding`.

Inspect the catalog at any time:

```bash
node bin/awb.js role list
node bin/awb.js skill show debugging
```
```

Add a `## 0.4.0` section at the top of `CHANGELOG.md`:

```markdown
## 0.4.0 — 2026-08-27

### Added

- A starter capability catalog: three roles, three skills, and two workflows
  are created by `awb init` and shipped with the repository, so a new
  workspace has real capabilities to route to.
- `awb role|skill|workflow list|show` for discovering the catalog.
- `awb profile status` reports whether the workspace has been onboarded and
  returns the interview questions and the catalog.
- `awb profile complete` validates the answers, writes `user/PROFILE.md`, and
  records completion in `.awb/workspace.json`.
- `START_HERE.md` now opens with the interview step.

### Changed

- `awb task create` rejects a role, skill, or workflow that does not exist, and
  names the ones that do.
- `awb task create` is blocked until onboarding is complete. `--skip-onboarding`
  is the escape hatch for automation.
- `awb validate` reports dangling capability references as errors on active
  tasks and as warnings on closed ones.
- `awb init` refuses to create a workspace inside an existing one unless
  `--allow-nested` is passed.

`formatVersion` stays `0.3`; no migration is required.
```

- [ ] **Step 6: Run everything**

Run: `npm run check && npm test && node bin/awb.js validate && node bin/awb.js profile build`
Expected: all tests pass, the workspace validates, and the profile builds.

- [ ] **Step 7: Commit**

```bash
git add core/templates.js START_HERE.md core/core.js package.json README.md CHANGELOG.md test/cli.test.js
git commit -m "docs: document the onboarding flow and release 0.4.0"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| 4.1 Capability catalog | 1 |
| 4.2 Discovery commands | 2 |
| 4.3 Reference validation | 3 |
| 4.4 Onboarding state | 4 |
| 4.5 `profile status` | 4 |
| 4.6 `profile complete` | 5 |
| 4.7 The gate | 6 |
| 4.8 Protocol | 7 |
| Version semantics (header) | 7 |
| R5 nested init | 1 |

**Type consistency**

`assertCapabilityExists(root, kind, id)` is defined in Task 2 and used with the same signature in Tasks 3 and 5. `getOnboarding(root)` is defined in Task 4 and used in Tasks 5 and 6. `USER_PROFILE_PATH` is defined in Task 4 and used in Task 5. `capabilityDirectory(kind)` is defined in Task 2 and used in Task 3. `locateWorkspace(start)` is defined in Task 1 and used only there.

**Corrections made during review**

- Task 1's catalog test originally asserted on `awb role list`, a command Task 2
  introduces. It now reads `roles/` directly, so every task is green at the end
  of its own task.
- Two tests asserted that a fresh `work/tasks/` contains `README.md`.
  `initWorkspace` writes READMEs only for `roles`, `skills`, `workflows`,
  `knowledge`, `src`, and `profile`, so the directory is empty. Both now assert
  `[]`.
