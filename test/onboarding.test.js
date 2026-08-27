import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertQuestionCatalogs } from "../core/core.js";
import { CAPABILITY_CATALOG, USER_PROFILE } from "../core/templates.js";

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

// The repository is itself an initialized workspace (see the "distributed
// repository" test in cli.test.js), so its committed user/PROFILE.md is the
// one every employee's clone starts with. If it silently drifts from the
// USER_PROFILE template, `completeProfile` sees an "edited" file that no one
// actually edited and refuses onboarding with a false accusation. This pins
// the two together so drift fails the suite instead of shipping.
test("the committed user/PROFILE.md is byte-identical to the USER_PROFILE template", async () => {
  const committed = await readFile(path.join(repositoryRoot, "user", "PROFILE.md"), "utf8");
  assert.equal(committed.trim(), USER_PROFILE.trim());
});

// Same class of drift, generalized to the whole starter catalog: every file
// CAPABILITY_CATALOG describes is also committed to the repository root
// (initWorkspace and migrateWorkspace both write it with overwrite: false),
// and the two copies must stay in sync.
//
// START_HERE.md is deliberately NOT pinned here. The repository's copy and
// the START_HERE template intentionally diverge in wording and list length
// -- that is an accepted decision, not drift. Do not "fix" it by adding a
// pin for it.
test("every committed capability catalog file matches the CAPABILITY_CATALOG template", async () => {
  for (const [relativePath, content] of Object.entries(CAPABILITY_CATALOG)) {
    const committed = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    assert.equal(committed, content, `${relativePath} has drifted from CAPABILITY_CATALOG`);
  }
});
