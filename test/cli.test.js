import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repositoryRoot, "bin", "awb.js");
const temporaryRoots = [];

test.afterEach(async () => {
  while (temporaryRoots.length) {
    const target = temporaryRoots.pop();
    await rm(target, { recursive: true, force: true });
  }
});

test("init creates the standard core without harness bootstrap files", async () => {
  const root = await tempWorkspacePath();
  const result = awb(["init", "--root", root, "--name", "Test Workbench"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Initialized Test Workbench/);
  assert.equal(await fileExists(path.join(root, "START_HERE.md")), true);
  assert.equal(await fileExists(path.join(root, ".awb", "workspace.json")), true);
  assert.equal(await fileExists(path.join(root, "AGENTS.md")), false);
  assert.equal(await fileExists(path.join(root, "CLAUDE.md")), false);
});

test("a task can contain several related projects and returns compact context", async () => {
  const root = await initializedWorkspace();
  assertSuccess(awb(["--root", root, "project", "add", "portal", "--path", "src/portal", "--create"]));
  assertSuccess(awb(["--root", root, "project", "add", "order-api", "--path", "src/order-api", "--create"]));
  assertSuccess(
    awb([
      "--root",
      root,
      "relation",
      "add",
      "portal",
      "calls-api",
      "order-api",
      "--description",
      "Portal creates orders"
    ])
  );
  assertSuccess(
    awb([
      "--root",
      root,
      "task",
      "create",
      "--id",
      "TASK-MULTI",
      "--title",
      "Order investigation",
      "--role",
      "developer",
      "--primary",
      "portal",
      "--project",
      "portal",
      "--project",
      "order-api"
    ])
  );
  assertSuccess(
    awb([
      "--root",
      root,
      "knowledge",
      "add",
      "portal.order-flow",
      "--scope",
      "project:portal",
      "--title",
      "Order flow",
      "--text",
      "A deliberately long body that must not be returned by task context."
    ])
  );

  const contextResult = awb(["--root", root, "--json", "task", "context", "TASK-MULTI"]);
  assertSuccess(contextResult);
  const context = JSON.parse(contextResult.stdout);
  assert.deepEqual(context.task.projects, ["portal", "order-api"]);
  assert.equal(context.relationships[0].type, "calls-api");
  assert.equal(context.knowledge[0].id, "portal.order-flow");
  assert.equal("content" in context.knowledge[0], false);
  assert.doesNotMatch(contextResult.stdout, /deliberately long body/);
});

test("provider bindings add compact external references without loading provider data", async () => {
  const root = await initializedWorkspace();
  assertSuccess(awb(["--root", root, "project", "add", "portal", "--path", "src/portal", "--create"]));
  assertSuccess(
    awb([
      "--root", root, "provider", "add", "tencent-local",
      "--knowledge-url", "http://127.0.0.1:8424/v3",
      "--service-id", "default",
      "--auth-env", "AWB_TENCENT_USER_KEY"
    ])
  );
  assertSuccess(
    awb([
      "--root", root, "provider", "bind", "tencent-local",
      "--project", "portal",
      "--knowledge-id", "wiki-123"
    ])
  );
  assertSuccess(
    awb([
      "--root", root, "task", "create", "--id", "TASK-PROVIDER",
      "--project", "portal", "--role", "developer"
    ])
  );

  const result = awb(["--root", root, "--json", "task", "context", "TASK-PROVIDER"]);
  assertSuccess(result);
  const context = JSON.parse(result.stdout);
  assert.deepEqual(context.providerResources, [{
    providerId: "tencent-local",
    providerType: "tencentdb-agent-memory",
    enabled: true,
    projectId: "portal",
    knowledgeId: "wiki-123",
    description: ""
  }]);
  assert.doesNotMatch(result.stdout, /AWB_TENCENT_USER_KEY.*secret/i);
});

test("migrate upgrades a 0.2 workspace without rewriting registry data", async () => {
  const root = await initializedWorkspace();
  assertSuccess(awb(["--root", root, "project", "add", "portal", "--path", "src/portal", "--create"]));
  for (const relative of [
    ".awb/workspace.json",
    "projects/index.json",
    "relationships/index.json",
    "knowledge/index.json",
    "work/artifacts/index.json"
  ]) {
    const target = path.join(root, relative);
    const value = JSON.parse(await readFile(target, "utf8"));
    value.formatVersion = "0.2";
    await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
  await rm(path.join(root, "knowledge", "providers.json"));

  const migration = awb(["--root", root, "--json", "migrate"]);
  assertSuccess(migration);
  assert.equal(JSON.parse(migration.stdout).to, "0.3");
  const projects = JSON.parse(await readFile(path.join(root, "projects", "index.json"), "utf8"));
  assert.equal(projects.formatVersion, "0.3");
  assert.equal(projects.projects[0].id, "portal");
  const providers = JSON.parse(await readFile(path.join(root, "knowledge", "providers.json"), "utf8"));
  assert.deepEqual(providers.providers, []);
  assertSuccess(awb(["--root", root, "validate"]));
});

test("memory requires approval before it becomes durable knowledge", async () => {
  const root = await initializedWorkspace();
  assertSuccess(awb(["--root", root, "project", "add", "portal", "--path", "src/portal", "--create"]));

  const proposal = awb([
    "--root",
    root,
    "memory",
    "propose",
    "--id",
    "LEARN-001",
    "--scope",
    "project:portal",
    "--title",
    "Validate region IDs",
    "--text",
    "Verify province, city, and area before creating the order."
  ]);
  assertSuccess(proposal);

  let knowledge = JSON.parse((await readFile(path.join(root, "knowledge", "index.json"), "utf8"))).items;
  assert.equal(knowledge.length, 0);

  assertSuccess(
    awb([
      "--root",
      root,
      "memory",
      "approve",
      "LEARN-001",
      "--knowledge-id",
      "portal.validate-region"
    ])
  );
  knowledge = JSON.parse((await readFile(path.join(root, "knowledge", "index.json"), "utf8"))).items;
  assert.equal(knowledge.length, 1);
  assert.equal(knowledge[0].id, "portal.validate-region");
});

test("profile build produces a self-contained escaped HTML view", async () => {
  const root = await initializedWorkspace();
  await writeFile(path.join(root, "user", "PROFILE.md"), "# Nguyễn An\n\n<script>alert('no')</script>\n", "utf8");
  assertSuccess(
    awb([
      "--root",
      root,
      "project",
      "add",
      "docs",
      "--name",
      "Product Docs",
      "--path",
      "src/docs",
      "--create"
    ])
  );

  const result = awb(["--root", root, "profile", "build"]);
  assertSuccess(result);
  const html = await readFile(path.join(root, "profile", "index.html"), "utf8");
  assert.match(html, /Agent Workbench/);
  assert.match(html, /Product Docs/);
  assert.match(html, /Nguyễn An/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test("validate detects unavailable project sources as warnings without invalidating the workspace", async () => {
  const root = await initializedWorkspace();
  assertSuccess(awb(["--root", root, "project", "add", "future", "--path", "src/future"]));
  const result = awb(["--root", root, "--json", "validate"]);
  assert.equal(result.status, 0, result.stderr);
  const validation = JSON.parse(result.stdout);
  assert.equal(validation.valid, true);
  assert.equal(validation.warnings.length, 1);
  assert.match(validation.warnings[0], /Project source is unavailable/);
});

test("the distributed repository is itself a valid single-root workspace", async () => {
  const result = awb(["--root", repositoryRoot, "--json", "validate"]);
  assert.equal(result.status, 0, result.stderr);
  const validation = JSON.parse(result.stdout);
  assert.equal(validation.valid, true);
  assert.equal(await fileExists(path.join(repositoryRoot, "core", "core.js")), true);
  assert.equal(await fileExists(path.join(repositoryRoot, "src", "core.js")), false);
  assert.equal(await fileExists(path.join(repositoryRoot, ".awb", "workspace.json")), true);
  assert.equal(await fileExists(path.join(repositoryRoot, "AGENTS.md")), false);
  assert.equal(await fileExists(path.join(repositoryRoot, "CLAUDE.md")), false);
});

test("external sources keep portable metadata separate from the machine-local path", async () => {
  const root = await initializedWorkspace();
  const externalSource = await mkdtemp(path.join(tmpdir(), "awb-external-"));
  temporaryRoots.push(externalSource);

  assertSuccess(
    awb([
      "--root",
      root,
      "project",
      "add",
      "legacy-app",
      "--name",
      "Legacy App",
      "--external-path",
      externalSource,
      "--repo",
      "https://git.example.test/legacy-app.git"
    ])
  );

  const portable = JSON.parse(await readFile(path.join(root, "src", "legacy-app.source.json"), "utf8"));
  const local = JSON.parse(await readFile(path.join(root, "src", ".external", "legacy-app.local.json"), "utf8"));
  assert.equal(local.projectId, "legacy-app");
  assert.equal(local.path, path.resolve(externalSource));
  assert.equal(portable.localReference, "src/.external/legacy-app.local.json");
  assert.equal(portable.repositoryUrl, "https://git.example.test/legacy-app.git");
  // Check the serialized form for both the raw path and its JSON-escaped form:
  // on Windows the descriptor holds `C:\Users\...`, which a naive search for
  // `C:\Users\...` would miss.
  const portableText = JSON.stringify(portable);
  assert.equal(portableText.includes(externalSource), false);
  assert.equal(portableText.includes(JSON.stringify(externalSource).slice(1, -1)), false);

  const resolvedResult = awb(["--root", root, "--json", "project", "resolve", "legacy-app"]);
  assertSuccess(resolvedResult);
  const resolved = JSON.parse(resolvedResult.stdout);
  assert.equal(resolved.available, true);
  assert.equal(resolved.resolvedPath, externalSource);
});

test("CS documentation task enforces write scope and closes only after verified artifacts and gates", async () => {
  const root = await initializedWorkspace();
  assertSuccess(
    awb([
      "--root",
      root,
      "project",
      "add",
      "hvh-user-guides",
      "--name",
      "HVH User Guides",
      "--path",
      "src/hvh-user-guides",
      "--create"
    ])
  );
  assertSuccess(
    awb([
      "--root",
      root,
      "project",
      "add",
      "hvh-web-app",
      "--name",
      "HVH Web App",
      "--path",
      "src/hvh-web-app",
      "--create"
    ])
  );
  assertSuccess(awb(["--root", root, "relation", "add", "hvh-user-guides", "documents", "hvh-web-app"]));
  assertSuccess(
    awb([
      "--root",
      root,
      "task",
      "create",
      "--id",
      "TASK-CS-GUIDE",
      "--title",
      "Advertising account end-user guide",
      "--objective",
      "Create a Word guide with screenshots from the development website.",
      "--audience",
      "end-user",
      "--role",
      "technical-writer",
      "--primary",
      "hvh-user-guides",
      "--project",
      "hvh-user-guides",
      "--project",
      "hvh-web-app",
      "--browser",
      "https://dev.hvh.hvnet.vn",
      "--read",
      "project:hvh-web-app",
      "--read",
      "project:hvh-user-guides",
      "--write",
      "project:hvh-user-guides/marketing-accounts",
      "--deliverable",
      "docx",
      "--deliverable",
      "markdown",
      "--quality-gate",
      "render-docx",
      "--quality-gate",
      "check-sensitive-data",
      "--constraint",
      "Do not modify DEV source",
      "--constraint",
      "Do not persist login credentials"
    ])
  );

  const guideDirectory = path.join(root, "src", "hvh-user-guides", "marketing-accounts", "docs");
  await writeFile(path.join(root, "src", "hvh-web-app", "forbidden.docx"), "not allowed", "utf8");
  const forbidden = awb([
    "--root",
    root,
    "artifact",
    "add",
    "TASK-CS-GUIDE",
    "--project",
    "hvh-web-app",
    "--path",
    "forbidden.docx",
    "--kind",
    "docx",
    "--verified"
  ]);
  assert.equal(forbidden.status, 1);
  assert.match(forbidden.stderr, /outside task write scope/);

  await import("node:fs/promises").then(({ mkdir }) => mkdir(guideDirectory, { recursive: true }));
  await writeFile(path.join(guideDirectory, "guide.docx"), "docx fixture", "utf8");
  await writeFile(path.join(guideDirectory, "guide.md"), "# Guide", "utf8");
  for (const [kind, file] of [["docx", "guide.docx"], ["markdown", "guide.md"]]) {
    assertSuccess(
      awb([
        "--root",
        root,
        "artifact",
        "add",
        "TASK-CS-GUIDE",
        "--project",
        "hvh-user-guides",
        "--path",
        `marketing-accounts/docs/${file}`,
        "--kind",
        kind,
        "--verified"
      ])
    );
  }

  let verification = awb(["--root", root, "--json", "task", "verify", "TASK-CS-GUIDE"]);
  assertSuccess(verification);
  assert.equal(JSON.parse(verification.stdout).valid, false);

  assertSuccess(awb(["--root", root, "task", "gate-pass", "TASK-CS-GUIDE", "render-docx"]));
  assertSuccess(awb(["--root", root, "task", "gate-pass", "TASK-CS-GUIDE", "check-sensitive-data"]));

  verification = awb(["--root", root, "--json", "task", "verify", "TASK-CS-GUIDE"]);
  assertSuccess(verification);
  assert.equal(JSON.parse(verification.stdout).valid, true);
  assertSuccess(awb(["--root", root, "task", "close", "TASK-CS-GUIDE"]));

  const task = JSON.parse(await readFile(path.join(root, "work", "tasks", "TASK-CS-GUIDE.json"), "utf8"));
  assert.equal(task.status, "closed");
  assert.equal(task.audience, "end-user");
  assert.equal(task.secretPolicy, "runtime-only");
  assert.deepEqual(task.writeScopes, ["project:hvh-user-guides/marketing-accounts"]);
});

test("artifact paths cannot escape the project source root on any platform", async () => {
  const root = await initializedWorkspace();
  assertSuccess(awb(["--root", root, "project", "add", "app", "--path", "src/app", "--create"]));
  assertSuccess(
    awb([
      "--root",
      root,
      "task",
      "create",
      "--id",
      "TASK-ESCAPE",
      "--title",
      "Escape attempt",
      "--role",
      "developer",
      "--project",
      "app"
    ])
  );
  await writeFile(path.join(root, "outside.txt"), "workspace file outside the project\n", "utf8");

  const escapes = [
    "../../outside.txt",
    "a/../../../outside.txt",
    // Backslash separators must be folded before normalization: on POSIX these
    // survive path.normalize as a single segment and would otherwise slip past
    // a `..` prefix check.
    "foo\\..\\..\\..\\outside.txt",
    "..\\..\\outside.txt"
  ];
  for (const escape of escapes) {
    const result = awb([
      "--root",
      root,
      "artifact",
      "add",
      "TASK-ESCAPE",
      "--project",
      "app",
      "--path",
      escape,
      "--kind",
      "note"
    ]);
    assert.equal(result.status, 1, `expected rejection for ${escape}, got: ${result.stdout}`);
    assert.match(result.stderr, /cannot leave the project source root/, `unexpected error for ${escape}`);
  }

  const listed = awb(["--root", root, "--json", "artifact", "list", "--task", "TASK-ESCAPE"]);
  assertSuccess(listed);
  assert.deepEqual(JSON.parse(listed.stdout), []);
});

test("task identifiers are stored uppercase regardless of the casing supplied", async () => {
  const root = await initializedWorkspace();
  assertSuccess(awb(["--root", root, "project", "add", "app", "--path", "src/app", "--create"]));
  assertSuccess(
    awb([
      "--root",
      root,
      "task",
      "create",
      "--id",
      "task-mixed-Case",
      "--title",
      "Mixed casing",
      "--role",
      "developer",
      "--project",
      "app"
    ])
  );

  const taskFiles = await readdir(path.join(root, "work", "tasks"));
  assert.equal(taskFiles.includes("TASK-MIXED-CASE.json"), true);
  assert.equal(taskFiles.includes("task-mixed-Case.json"), false);

  const duplicate = awb([
    "--root",
    root,
    "task",
    "create",
    "--id",
    "TASK-MIXED-CASE",
    "--title",
    "Duplicate",
    "--role",
    "developer",
    "--project",
    "app"
  ]);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /Task already exists: TASK-MIXED-CASE/);

  for (const lookup of ["task-mixed-case", "TASK-MIXED-CASE", "Task-Mixed-Case"]) {
    const context = awb(["--root", root, "--json", "task", "context", lookup]);
    assertSuccess(context);
    assert.equal(JSON.parse(context.stdout).task.id, "TASK-MIXED-CASE");
  }
});

test("an unrecognized option is rejected instead of swallowing the next token", async () => {
  const root = await initializedWorkspace();
  assertSuccess(awb(["--root", root, "project", "add", "app", "--path", "src/app", "--create"]));

  const typo = awb([
    "--root",
    root,
    "task",
    "create",
    "--titl",
    "Order investigation",
    "--role",
    "developer",
    "--project",
    "app"
  ]);
  assert.equal(typo.status, 1);
  assert.match(typo.stderr, /Unknown option for `awb task create`: --titl/);

  const tasks = JSON.parse(awb(["--root", root, "--json", "task", "list"]).stdout);
  assert.deepEqual(tasks, [], "the mistyped command must not have created anything");
});

test("--json reports failures as JSON and exit codes separate failure from an unhealthy result", async () => {
  const root = await initializedWorkspace();
  assertSuccess(awb(["--root", root, "project", "add", "app", "--path", "src/app", "--create"]));

  const missing = awb(["--root", root, "--json", "task", "context", "TASK-NOPE"]);
  assert.equal(missing.status, 1);
  assert.match(JSON.parse(missing.stderr).error.message, /work\/tasks\/TASK-NOPE\.json/);
  assert.equal(missing.stdout, "");

  const plain = awb(["--root", root, "task", "context", "TASK-NOPE"]);
  assert.equal(plain.status, 1);
  assert.match(plain.stderr, /^Error: /);

  // Exit 2 means "the command ran and reports a problem", distinct from exit 1.
  assertSuccess(
    awb([
      "--root",
      root,
      "provider",
      "add",
      "offline",
      "--knowledge-url",
      "http://127.0.0.1:59999/v3",
      "--timeout-ms",
      "250"
    ])
  );
  const status = awb(["--root", root, "--json", "provider", "status", "offline"]);
  assert.equal(status.status, 2);
  assert.equal(JSON.parse(status.stdout).ok, false);

  assertSuccess(
    awb(["--root", root, "provider", "bind", "offline", "--project", "app", "--knowledge-id", "wiki-1"])
  );
  const recall = awb(["--root", root, "--json", "provider", "recall", "anything", "--project", "app"]);
  assert.equal(recall.status, 2);
  const recalled = JSON.parse(recall.stdout);
  assert.equal(recalled.failedCount, 1);
  assert.equal(recalled.okCount, 0);
});

test("migrate canonicalizes lowercase task files and repoints everything at them", async () => {
  const root = await initializedWorkspace();
  assertSuccess(awb(["--root", root, "project", "add", "app", "--path", "src/app", "--create"]));
  assertSuccess(
    awb([
      "--root",
      root,
      "task",
      "create",
      "--id",
      "TASK-LEGACY",
      "--title",
      "Legacy task",
      "--role",
      "developer",
      "--project",
      "app",
      "--deliverable",
      "note"
    ])
  );
  await writeFile(path.join(root, "src", "app", "note.md"), "content\n", "utf8");
  assertSuccess(
    awb([
      "--root",
      root,
      "artifact",
      "add",
      "TASK-LEGACY",
      "--id",
      "artifact-legacy",
      "--project",
      "app",
      "--path",
      "note.md",
      "--kind",
      "note",
      "--verified"
    ])
  );
  assertSuccess(
    awb([
      "--root",
      root,
      "knowledge",
      "add",
      "legacy.note",
      "--scope",
      "task:TASK-LEGACY",
      "--title",
      "Legacy note",
      "--text",
      "Body"
    ])
  );

  // Rewrite the workspace the way a pre-0.3 one looks: a lowercase task file,
  // no secretPolicy, and every referrer pointing at the lowercase identifier.
  const legacy = JSON.parse(await readFile(path.join(root, "work", "tasks", "TASK-LEGACY.json"), "utf8"));
  legacy.id = "task-legacy";
  delete legacy.secretPolicy;
  // Rename rather than write-then-delete: on a case-insensitive filesystem the
  // lowercase path is the same file, so writing it and removing the uppercase
  // name would delete the task outright.
  await rename(
    path.join(root, "work", "tasks", "TASK-LEGACY.json"),
    path.join(root, "work", "tasks", "task-legacy.json")
  );
  await writeFile(path.join(root, "work", "tasks", "task-legacy.json"), JSON.stringify(legacy, null, 2), "utf8");

  const artifacts = JSON.parse(await readFile(path.join(root, "work", "artifacts", "index.json"), "utf8"));
  artifacts.artifacts[0].taskId = "task-legacy";
  artifacts.formatVersion = "0.2";
  await writeFile(path.join(root, "work", "artifacts", "index.json"), JSON.stringify(artifacts, null, 2), "utf8");

  const knowledge = JSON.parse(await readFile(path.join(root, "knowledge", "index.json"), "utf8"));
  knowledge.items[0].scope = "task:task-legacy";
  await writeFile(path.join(root, "knowledge", "index.json"), JSON.stringify(knowledge, null, 2), "utf8");

  const workspace = JSON.parse(await readFile(path.join(root, ".awb", "workspace.json"), "utf8"));
  workspace.formatVersion = "0.2";
  await writeFile(path.join(root, ".awb", "workspace.json"), JSON.stringify(workspace, null, 2), "utf8");

  const migration = awb(["--root", root, "--json", "migrate"]);
  assertSuccess(migration);
  assert.deepEqual(JSON.parse(migration.stdout).renamedTasks, { "task-legacy": "TASK-LEGACY" });

  const taskFiles = await readdir(path.join(root, "work", "tasks"));
  assert.equal(taskFiles.includes("TASK-LEGACY.json"), true);
  assert.equal(taskFiles.includes("task-legacy.json"), false);

  const migrated = JSON.parse(await readFile(path.join(root, "work", "tasks", "TASK-LEGACY.json"), "utf8"));
  assert.equal(migrated.id, "TASK-LEGACY");
  assert.equal(migrated.secretPolicy, "runtime-only");

  const migratedArtifacts = JSON.parse(await readFile(path.join(root, "work", "artifacts", "index.json"), "utf8"));
  assert.equal(migratedArtifacts.artifacts[0].taskId, "TASK-LEGACY");
  const migratedKnowledge = JSON.parse(await readFile(path.join(root, "knowledge", "index.json"), "utf8"));
  assert.equal(migratedKnowledge.items[0].scope, "task:TASK-LEGACY");

  assertSuccess(awb(["--root", root, "validate"]));
  assertSuccess(awb(["--root", root, "--json", "migrate"]), "migration must stay idempotent");
});

test("validate enforces the published JSON schemas, not only its own rules", async () => {
  const root = await initializedWorkspace();
  assertSuccess(awb(["--root", root, "project", "add", "app", "--path", "src/app", "--create"]));

  const registry = JSON.parse(await readFile(path.join(root, "projects", "index.json"), "utf8"));
  registry.projects[0].sourceMode = "borrowed";
  registry.projects[0].tags = "not-an-array";
  await writeFile(path.join(root, "projects", "index.json"), JSON.stringify(registry, null, 2), "utf8");

  const result = awb(["--root", root, "--json", "validate"]);
  assert.equal(result.status, 2);
  const validation = JSON.parse(result.stdout);
  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.some((message) => message.includes("sourceMode") && message.includes("must be one of")),
    true,
    validation.errors.join("; ")
  );
  assert.equal(
    validation.errors.some((message) => message.includes("tags") && message.includes("must be of type array")),
    true,
    validation.errors.join("; ")
  );
});

test("knowledge scope filters are canonicalized the same way stored scopes are", async () => {
  const root = await initializedWorkspace();
  assertSuccess(awb(["--root", root, "project", "add", "app", "--path", "src/app", "--create"]));
  assertSuccess(
    awb([
      "--root",
      root,
      "task",
      "create",
      "--id",
      "task-lower",
      "--title",
      "Lowercase input",
      "--role",
      "developer",
      "--project",
      "app"
    ])
  );
  assertSuccess(
    awb([
      "--root",
      root,
      "knowledge",
      "add",
      "k1",
      "--scope",
      "task:task-lower",
      "--title",
      "Saved note",
      "--text",
      "body text"
    ])
  );

  const stored = JSON.parse(awb(["--root", root, "--json", "knowledge", "list"]).stdout);
  assert.equal(stored[0].scope, "task:TASK-LOWER");

  // The scope the user saved with must also find the item back.
  for (const scope of ["task:task-lower", "task:TASK-LOWER", "task:Task-Lower"]) {
    const listed = JSON.parse(awb(["--root", root, "--json", "knowledge", "list", "--scope", scope]).stdout);
    assert.equal(listed.length, 1, `list --scope ${scope}`);
    const found = JSON.parse(
      awb(["--root", root, "--json", "knowledge", "search", "body", "--scope", scope]).stdout
    );
    assert.equal(found.length, 1, `search --scope ${scope}`);
  }

  const unknown = awb(["--root", root, "knowledge", "list", "--scope", "project:nope"]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown project: nope/);
});

test("the version is reported for every spelling of the flag", async () => {
  const expected = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")).version;
  for (const spelling of [["version"], ["--version"], ["-v"]]) {
    const result = awb(spelling);
    assertSuccess(result);
    assert.equal(result.stdout.trim(), expected, `awb ${spelling.join(" ")}`);
  }
  // An empty command line still falls through to help rather than to a version.
  assert.match(awb([]).stdout, /^Agent Workbench Core /);
});

test("init ships a starter capability catalog", async () => {
  const root = await initializedWorkspace();

  assert.deepEqual((await readdir(path.join(root, "roles"))).sort(), [
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

test("profile complete validates answers, writes the profile, and guards overwrites", async () => {
  const root = await initializedWorkspace();

  const statusBefore = awb(["--root", root, "profile", "status"]);
  assertSuccess(statusBefore);
  assert.match(statusBefore.stdout, /Which role best describes your main work here\?/);
  assert.match(statusBefore.stdout, /developer/);

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

  const statusAfter = awb(["--root", root, "profile", "status"]);
  assertSuccess(statusAfter);
  assert.match(statusAfter.stdout, /Onboarding is complete/);

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

function awb(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
}

function assertSuccess(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function tempWorkspacePath() {
  const parent = await mkdtemp(path.join(tmpdir(), "awb-test-"));
  temporaryRoots.push(parent);
  return path.join(parent, "workspace");
}

async function initializedWorkspace() {
  const root = await tempWorkspacePath();
  assertSuccess(awb(["init", "--root", root, "--name", "Test Workbench"]));
  return root;
}

async function fileExists(target) {
  try {
    await readFile(target);
    return true;
  } catch {
    return false;
  }
}
