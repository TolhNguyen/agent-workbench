import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertQuestionCatalogs } from "../core/core.js";
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
