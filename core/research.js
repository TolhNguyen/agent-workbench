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
    const last = ATTEMPT_RESULTS[ATTEMPT_RESULTS.length - 1];
    const options = `${ATTEMPT_RESULTS.slice(0, -1).join(", ")}, or ${last}`;
    throw new Error(`Attempt result must be ${options}.`);
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
