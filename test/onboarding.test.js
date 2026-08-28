import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertQuestionCatalogs } from "../core/core.js";
import {
  abandonResearch,
  addResearchAttempt,
  getResearch,
  listResearch,
  startResearch
} from "../core/research.js";
import { CAPABILITY_CATALOG } from "../core/templates.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("a question set whose catalog pointers all exist passes silently", () => {
  const questions = [
    { id: "name", kind: "text", required: true, prompt: "What should I call you?" },
    { id: "role", kind: "choice", required: true, catalog: "roles", prompt: "Which role?" },
    { id: "skills", kind: "list", required: false, catalog: "skills", prompt: "Which skills?" }
  ];
  const catalog = { roles: ["developer"], skills: ["debugging"], workflows: [] };
  assert.doesNotThrow(() => assertQuestionCatalogs(questions, catalog));
});

test("a question naming an unknown catalog fails loudly instead of throwing inside the formatter", () => {
  const questions = [
    { id: "role", kind: "choice", required: true, catalog: "role", prompt: "Which role?" }
  ];
  const catalog = { roles: ["developer"], skills: [], workflows: [] };
  assert.throws(
    () => assertQuestionCatalogs(questions, catalog),
    /"role".*unknown catalog: "role".*Valid catalogs: roles, skills, workflows/s
  );
});

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

// There is deliberately no pin for user/PROFILE.md here. The repository used
// to ship one, it drifted from the USER_PROFILE template, and `completeProfile`
// then refused onboarding by accusing the employee of editing a file they had
// never opened. The file is no longer distributed at all -- `awb init` writes it
// from the template in each fork -- so the drift it guarded against cannot
// happen. Do not "restore" the pin; restoring the file is what caused the bug.

// Same class of drift, generalized to the whole starter catalog: every file
// CAPABILITY_CATALOG describes is also committed to the repository root
// (initWorkspace and migrateWorkspace both write it with overwrite: false),
// and the two copies must stay in sync.
//
// START_HERE.md is deliberately NOT pinned here. The repository's copy and
// the START_HERE template intentionally diverge in wording and list length
// -- that is an accepted decision, not drift. Do not "fix" it by adding a
// pin for it.
//
// The six DIRECTORY_READMES are deliberately NOT pinned either, for the same
// reason. The templates address a bare workspace created by `awb init`; the
// committed copies address THIS repository, which also carries `core/`,
// `bin/`, and `test/` that a bare workspace never has. Forcing them to match
// would make one of the two wrong wherever it is read. Their content is
// documentation only -- unlike `user/PROFILE.md`, nothing compares them at
// runtime, so drift here cannot break a command.
test("every committed capability catalog file matches the CAPABILITY_CATALOG template", async () => {
  for (const [relativePath, content] of Object.entries(CAPABILITY_CATALOG)) {
    const committed = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    assert.equal(committed, content, `${relativePath} has drifted from CAPABILITY_CATALOG`);
  }
});
