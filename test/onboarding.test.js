import assert from "node:assert/strict";
import test from "node:test";
import { assertQuestionCatalogs } from "../core/core.js";

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
