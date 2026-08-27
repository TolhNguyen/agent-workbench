import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  CAPABILITY_CATALOG,
  DIRECTORY_READMES,
  ONBOARDING_QUESTIONS,
  START_HERE,
  USER_PROFILE
} from "./templates.js";
import { normalizeProviderConfig } from "./providers.js";
import { loadSchemas, validateAgainstSchema } from "./schema.js";

export const FORMAT_VERSION = "0.3";
export const PACKAGE_VERSION = "0.3.1";

export const USER_PROFILE_PATH = "user/PROFILE.md";

const PROJECTS_FILE = "projects/index.json";
const RELATIONSHIPS_FILE = "relationships/index.json";
const KNOWLEDGE_FILE = "knowledge/index.json";
const PROVIDERS_FILE = "knowledge/providers.json";
const ARTIFACTS_FILE = "work/artifacts/index.json";

export function nowIso() {
  return new Date().toISOString();
}

// Uppercase IDs are folded, not merely accepted: they become filenames, so
// leaving `task-a` and `TASK-A` distinct would silently mean one task on a
// case-insensitive filesystem and two on a case-sensitive one.
export function normalizeId(value, label = "ID", { uppercase = false } = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required.`);
  }
  const result = uppercase ? value.trim().toUpperCase() : value.trim();
  const pattern = uppercase
    ? /^[A-Z0-9][A-Z0-9._-]*$/
    : /^[a-z0-9][a-z0-9._-]*$/;
  if (!pattern.test(result)) {
    const expected = uppercase
      ? "letters, numbers, dots, underscores, and hyphens (stored uppercase)"
      : "lowercase letters, numbers, dots, underscores, and hyphens";
    throw new Error(`${label} must use ${expected}.`);
  }
  return result;
}

export function makeId(prefix, { uppercase = false } = {}) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  // 40 random bits: a 16-bit suffix collides at roughly 300 IDs generated
  // within the same second, and callers throw on collision rather than retry.
  const suffix = randomBytes(5).toString("hex");
  const value = `${prefix}-${stamp}-${suffix}`;
  return uppercase ? value.toUpperCase() : value.toLowerCase();
}

export async function exists(target) {
  try {
    await access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(root, relativePath, fallback) {
  const target = path.join(root, relativePath);
  if (!(await exists(target))) {
    if (fallback !== undefined) return structuredClone(fallback);
    throw new Error(`Required file is missing: ${relativePath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${relativePath}: ${error.message}`);
  }
  return parsed;
}

export async function writeJson(root, relativePath, value) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${randomBytes(3).toString("hex")}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, target);
}

export async function writeText(root, relativePath, value, { overwrite = true } = {}) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  if (!overwrite && (await exists(target))) return false;
  await writeFile(target, value.endsWith("\n") ? value : `${value}\n`, "utf8");
  return true;
}

// Separator folding must happen BEFORE normalization. On POSIX, path.normalize
// treats a backslash as an ordinary character, so `foo\..\..\etc` survives it as
// a single segment and only becomes traversal after the replacement -- too late
// for a post-normalize `..` check to see it.
function toPortablePath(input) {
  return path.posix.normalize(input.replaceAll("\\", "/")).replace(/^\.\//, "");
}

// Absoluteness is checked under both platform rules so that `C:\x` on POSIX and
// `/x` on Windows are rejected the same way everywhere.
function isAbsoluteAnyPlatform(input) {
  return path.posix.isAbsolute(input) || path.win32.isAbsolute(input);
}

export function workspaceRelative(root, input, { requireSource = false } = {}) {
  if (!input || typeof input !== "string") throw new Error("A relative path is required.");
  if (isAbsoluteAnyPlatform(input)) throw new Error("Workspace paths must be relative.");
  const normalized = toPortablePath(input);
  if (isAbsoluteAnyPlatform(normalized) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Workspace paths cannot leave the workspace root.");
  }
  const resolved = path.resolve(root, normalized);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error("Workspace paths cannot leave the workspace root.");
  }
  if (requireSource && normalized !== "src" && !normalized.startsWith("src/")) {
    throw new Error("Project source paths must be inside src/.");
  }
  return normalized;
}

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

  const directories = [
    ".awb",
    "user",
    "roles",
    "projects",
    "relationships",
    "knowledge/items",
    "skills",
    "workflows",
    "work/tasks",
    "work/proposals",
    "work/artifacts",
    "profile",
    "src",
    "src/.external"
  ];
  await Promise.all(directories.map((directory) => mkdir(path.join(target, directory), { recursive: true })));

  const timestamp = nowIso();
  await writeJson(target, ".awb/workspace.json", {
    formatVersion: FORMAT_VERSION,
    name,
    description,
    createdAt: timestamp,
    updatedAt: timestamp
  });
  await writeJson(target, PROJECTS_FILE, { formatVersion: FORMAT_VERSION, projects: [] });
  await writeJson(target, RELATIONSHIPS_FILE, { formatVersion: FORMAT_VERSION, relationships: [] });
  await writeJson(target, KNOWLEDGE_FILE, { formatVersion: FORMAT_VERSION, items: [] });
  await writeJson(target, PROVIDERS_FILE, { formatVersion: FORMAT_VERSION, providers: [] });
  await writeJson(target, ARTIFACTS_FILE, { formatVersion: FORMAT_VERSION, artifacts: [] });
  await writeText(target, "START_HERE.md", START_HERE, { overwrite: false });
  await writeText(target, "user/PROFILE.md", USER_PROFILE, { overwrite: false });
  await writeText(target, "roles/README.md", DIRECTORY_READMES.roles, { overwrite: false });
  await writeText(target, "skills/README.md", DIRECTORY_READMES.skills, { overwrite: false });
  await writeText(target, "workflows/README.md", DIRECTORY_READMES.workflows, { overwrite: false });
  await writeText(target, "knowledge/README.md", DIRECTORY_READMES.knowledge, { overwrite: false });
  await writeText(target, "src/README.md", DIRECTORY_READMES.src, { overwrite: false });
  await writeText(target, "profile/README.md", DIRECTORY_READMES.profile, { overwrite: false });
  for (const [relativePath, content] of Object.entries(CAPABILITY_CATALOG)) {
    await writeText(target, relativePath, content, { overwrite: false });
  }
  return { root: target, name, formatVersion: FORMAT_VERSION };
}

export async function getWorkspace(root) {
  return readJson(root, ".awb/workspace.json");
}

export async function touchWorkspace(root) {
  const workspace = await getWorkspace(root);
  workspace.updatedAt = nowIso();
  await writeJson(root, ".awb/workspace.json", workspace);
}

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

export async function migrateWorkspace(root) {
  const workspace = await getWorkspace(root);
  if (workspace.formatVersion !== "0.2" && workspace.formatVersion !== FORMAT_VERSION) {
    throw new Error(`No migration is available for formatVersion: ${workspace.formatVersion ?? "missing"}`);
  }
  const from = workspace.formatVersion;

  const tasks = await canonicalizeRecordIds(root, "work/tasks", (task) => {
    task.secretPolicy ??= "runtime-only";
    task.status ??= "active";
  });
  const proposals = await canonicalizeRecordIds(root, "work/proposals", (proposal) => {
    const renamed = tasks.renames.get(proposal.sourceTask);
    if (renamed) proposal.sourceTask = renamed;
  });

  const registryFiles = [
    [PROJECTS_FILE, { projects: [] }],
    [RELATIONSHIPS_FILE, { relationships: [] }],
    [KNOWLEDGE_FILE, { items: [] }],
    [ARTIFACTS_FILE, { artifacts: [] }]
  ];
  for (const [relativePath, fallback] of registryFiles) {
    const registry = await readJson(root, relativePath, { formatVersion: from, ...fallback });
    for (const project of registry.projects ?? []) {
      project.sourceMode ??= "managed";
      project.repositoryUrl ??= null;
      project.localReference ??= null;
    }
    for (const artifact of registry.artifacts ?? []) {
      const renamed = tasks.renames.get(artifact.taskId);
      if (renamed) artifact.taskId = renamed;
    }
    for (const item of registry.items ?? []) {
      const scoped = /^task:(.+)$/.exec(item.scope ?? "");
      const renamed = scoped && tasks.renames.get(scoped[1]);
      if (renamed) item.scope = `task:${renamed}`;
    }
    await writeJson(root, relativePath, { ...registry, formatVersion: FORMAT_VERSION });
  }
  const providers = await readJson(root, PROVIDERS_FILE, { formatVersion: FORMAT_VERSION, providers: [] });
  await writeJson(root, PROVIDERS_FILE, { ...providers, formatVersion: FORMAT_VERSION });
  workspace.formatVersion = FORMAT_VERSION;
  workspace.updatedAt = nowIso();
  await writeJson(root, ".awb/workspace.json", workspace);
  return {
    root: path.resolve(root),
    from,
    to: FORMAT_VERSION,
    changed: from !== FORMAT_VERSION || tasks.changed > 0 || proposals.changed > 0,
    tasksUpdated: tasks.changed,
    proposalsUpdated: proposals.changed,
    renamedTasks: Object.fromEntries(tasks.renames),
    renamedProposals: Object.fromEntries(proposals.renames)
  };
}

// Task and proposal IDs are the filenames that hold them, and they are canonical
// uppercase. A record written before that rule resolves on a case-insensitive
// filesystem and disappears on a case-sensitive one, so migration repairs both
// the filename and the `id` field, reporting renames so referrers can follow.
async function canonicalizeRecordIds(root, directory, patch = () => {}) {
  const target = path.join(root, directory);
  const renames = new Map();
  if (!(await exists(target))) return { renames, changed: 0 };

  const files = (await readdir(target)).filter((file) => file.endsWith(".json")).sort();
  const byCanonical = new Map();
  for (const file of files) {
    const canonical = `${path.basename(file, ".json").toUpperCase()}.json`;
    const clash = byCanonical.get(canonical);
    if (clash && clash !== file) {
      throw new Error(
        `Cannot migrate ${directory}: ${clash} and ${file} both become ${canonical}. Merge them by hand first.`
      );
    }
    byCanonical.set(canonical, file);
  }

  let changed = 0;
  for (const [canonical, file] of byCanonical) {
    const record = await readJson(root, `${directory}/${file}`);
    const before = JSON.stringify(record);
    const previousId = record.id;
    record.id = path.basename(canonical, ".json");
    patch(record);
    if (previousId !== undefined && previousId !== record.id) renames.set(previousId, record.id);
    if (file === canonical && JSON.stringify(record) === before) continue;
    // Rename first: writing the canonical name while the lowercase file still
    // exists would target the same inode on a case-insensitive filesystem.
    if (file !== canonical) await rename(path.join(target, file), path.join(target, canonical));
    await writeJson(root, `${directory}/${canonical}`, record);
    changed += 1;
  }
  return { renames, changed };
}

export async function getProjects(root) {
  const registry = await getProjectRegistry(root);
  return registry.projects ?? [];
}

async function getProjectRegistry(root) {
  return readJson(root, PROJECTS_FILE, { formatVersion: FORMAT_VERSION, projects: [] });
}

export async function addProject(root, input) {
  const id = normalizeId(input.id, "Project ID");
  const sourceMode = input.externalPath ? "external" : input.sourceMode || "managed";
  if (!["managed", "submodule", "external"].includes(sourceMode)) {
    throw new Error("Source mode must be managed, submodule, or external.");
  }
  const registry = await getProjectRegistry(root);
  const projects = registry.projects ?? [];
  if (projects.some((project) => project.id === id)) throw new Error(`Project already exists: ${id}`);
  let sourcePath;
  let localReference = null;
  if (sourceMode === "external") {
    if (!input.externalPath || !path.isAbsolute(input.externalPath)) {
      throw new Error("External projects require an absolute --external-path.");
    }
    sourcePath = `src/${id}.source.json`;
    localReference = `src/.external/${id}.local.json`;
    await writeJson(root, sourcePath, {
      formatVersion: FORMAT_VERSION,
      projectId: id,
      sourceMode,
      repositoryUrl: input.repositoryUrl || null,
      localReference
    });
    await writeJson(root, localReference, {
      projectId: id,
      path: path.resolve(input.externalPath)
    });
  } else {
    sourcePath = workspaceRelative(root, input.path ?? `src/${id}`, { requireSource: true });
    if (sourcePath.endsWith(".source.json") || sourcePath.startsWith("src/.external/")) {
      throw new Error("Managed and submodule project paths must be source directories.");
    }
    if (input.createPath) await mkdir(path.join(root, sourcePath), { recursive: true });
  }
  const timestamp = nowIso();
  const project = {
    id,
    name: input.name || id,
    path: sourcePath,
    sourceMode,
    repositoryUrl: input.repositoryUrl || null,
    localReference,
    description: input.description || "",
    tags: unique(input.tags ?? []),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  projects.push(project);
  projects.sort((a, b) => a.id.localeCompare(b.id));
  await writeJson(root, PROJECTS_FILE, { ...registry, formatVersion: FORMAT_VERSION, projects });
  await touchWorkspace(root);
  return project;
}

export async function getProject(root, id) {
  const safeId = normalizeId(id, "Project ID");
  const project = (await getProjects(root)).find((candidate) => candidate.id === safeId);
  if (!project) throw new Error(`Unknown project: ${safeId}`);
  return project;
}

export async function resolveProject(root, projectOrId) {
  const project = typeof projectOrId === "string" ? await getProject(root, projectOrId) : projectOrId;
  const sourceMode = project.sourceMode || "managed";
  if (sourceMode === "external") {
    const reference = workspaceRelative(
      root,
      project.localReference || `src/.external/${project.id}.local.json`,
      { requireSource: true }
    );
    if (!(await exists(path.join(root, reference)))) {
      return { ...project, resolvedPath: null, available: false, reason: `Missing local reference: ${reference}` };
    }
    const local = await readJson(root, reference);
    if (!local.path || !path.isAbsolute(local.path)) {
      return { ...project, resolvedPath: null, available: false, reason: `Invalid external path in ${reference}` };
    }
    const available = await exists(local.path);
    return {
      ...project,
      resolvedPath: path.resolve(local.path),
      available,
      reason: available ? null : "External source path does not exist on this machine."
    };
  }
  const sourcePath = workspaceRelative(root, project.path, { requireSource: true });
  const resolvedPath = path.join(root, sourcePath);
  const available = await exists(resolvedPath);
  return {
    ...project,
    resolvedPath,
    available,
    reason: available ? null : "Source path does not exist."
  };
}

export async function getRelationships(root) {
  const registry = await getRelationshipRegistry(root);
  return registry.relationships ?? [];
}

async function getRelationshipRegistry(root) {
  return readJson(root, RELATIONSHIPS_FILE, {
    formatVersion: FORMAT_VERSION,
    relationships: []
  });
}

export async function addRelationship(root, input) {
  const projects = await getProjects(root);
  const known = new Set(projects.map((project) => project.id));
  const from = normalizeId(input.from, "Source project ID");
  const to = normalizeId(input.to, "Target project ID");
  const type = normalizeId(input.type, "Relationship type");
  if (!known.has(from)) throw new Error(`Unknown project: ${from}`);
  if (!known.has(to)) throw new Error(`Unknown project: ${to}`);
  if (from === to) throw new Error("A project cannot relate to itself.");
  const registry = await getRelationshipRegistry(root);
  const relationships = registry.relationships ?? [];
  if (relationships.some((item) => item.from === from && item.to === to && item.type === type)) {
    throw new Error(`Relationship already exists: ${from} --${type}--> ${to}`);
  }
  const relationship = {
    id: input.id ? normalizeId(input.id, "Relationship ID") : `${from}.${type}.${to}`,
    from,
    to,
    type,
    description: input.description || "",
    contract: input.contract ? workspaceRelative(root, input.contract) : "",
    tags: unique(input.tags ?? []),
    lastVerified: input.lastVerified || null,
    createdAt: nowIso()
  };
  relationships.push(relationship);
  relationships.sort((a, b) => a.id.localeCompare(b.id));
  await writeJson(root, RELATIONSHIPS_FILE, { ...registry, formatVersion: FORMAT_VERSION, relationships });
  await touchWorkspace(root);
  return relationship;
}

export async function getTask(root, id) {
  const safeId = normalizeId(id, "Task ID", { uppercase: true });
  return readJson(root, `work/tasks/${safeId}.json`);
}

export async function listTasks(root) {
  const directory = path.join(root, "work", "tasks");
  if (!(await exists(directory))) return [];
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  const tasks = [];
  for (const file of files) {
    tasks.push(await readJson(root, `work/tasks/${file}`));
  }
  return tasks;
}

export async function createTask(root, input) {
  const id = normalizeId(input.id || makeId("TASK", { uppercase: true }), "Task ID", { uppercase: true });
  const target = `work/tasks/${id}.json`;
  if (await exists(path.join(root, target))) throw new Error(`Task already exists: ${id}`);
  const projects = unique(input.projects ?? []);
  if (projects.length === 0) throw new Error("A task requires at least one project.");
  const registered = new Set((await getProjects(root)).map((project) => project.id));
  for (const project of projects) {
    normalizeId(project, "Project ID");
    if (!registered.has(project)) throw new Error(`Unknown project: ${project}`);
  }
  const primaryProject = input.primaryProject || projects[0];
  if (!projects.includes(primaryProject)) throw new Error("The primary project must be included in task projects.");
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
  const readScopes = unique(input.readScopes?.length ? input.readScopes : projects.map((project) => `project:${project}`))
    .map((scope) => normalizeAccessScope(scope, projects));
  const writeScopes = unique(
    input.writeScopes?.length ? input.writeScopes : [`project:${primaryProject}`]
  ).map((scope) => normalizeAccessScope(scope, projects));
  const browserTargets = unique(input.browserTargets ?? []).map(normalizeBrowserTarget);
  const deliverables = unique(input.deliverables ?? []).map((item) => normalizeId(item, "Deliverable ID"));
  const qualityGates = unique(input.qualityGates ?? []).map((item) => ({
    id: normalizeId(item, "Quality gate ID"),
    status: "pending",
    note: null,
    passedAt: null
  }));
  const task = {
    id,
    title: input.title || id,
    status: "active",
    objective: input.objective || "",
    audience: input.audience || "",
    primaryRole,
    supportingRoles,
    primaryProject,
    projects,
    skills,
    workflows,
    browserTargets,
    readScopes,
    writeScopes,
    deliverables,
    qualityGates,
    constraints: unique(input.constraints ?? []),
    doneWhen: unique(input.doneWhen ?? []),
    secretPolicy: "runtime-only",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  await writeJson(root, target, task);
  await touchWorkspace(root);
  return task;
}

export async function passQualityGate(root, taskId, gateId, { note = "" } = {}) {
  const task = await getTask(root, taskId);
  if (task.status !== "active") throw new Error(`Task is not active: ${task.id}`);
  const safeGateId = normalizeId(gateId, "Quality gate ID");
  const gate = (task.qualityGates ?? []).find((item) => item.id === safeGateId);
  if (!gate) throw new Error(`Unknown quality gate for ${task.id}: ${safeGateId}`);
  gate.status = "passed";
  gate.note = note || null;
  gate.passedAt = nowIso();
  task.updatedAt = nowIso();
  await writeJson(root, `work/tasks/${task.id}.json`, task);
  await touchWorkspace(root);
  return { taskId: task.id, gate };
}

export async function verifyTask(root, taskId) {
  const task = await getTask(root, taskId);
  const artifacts = await listArtifacts(root, { taskId: task.id });
  const missingDeliverables = (task.deliverables ?? []).filter(
    (deliverable) => !artifacts.some((artifact) => artifact.kind === deliverable)
  );
  const unverifiedArtifacts = artifacts.filter((artifact) => !artifact.verified).map((artifact) => artifact.id);
  const missingArtifacts = [];
  for (const artifact of artifacts) {
    const resolved = await resolveArtifact(root, artifact);
    if (!resolved.exists) missingArtifacts.push(artifact.id);
  }
  const pendingQualityGates = (task.qualityGates ?? [])
    .filter((gate) => gate.status !== "passed")
    .map((gate) => gate.id);
  return {
    taskId: task.id,
    valid:
      missingDeliverables.length === 0 &&
      unverifiedArtifacts.length === 0 &&
      missingArtifacts.length === 0 &&
      pendingQualityGates.length === 0,
    artifactCount: artifacts.length,
    missingDeliverables,
    unverifiedArtifacts,
    missingArtifacts,
    pendingQualityGates
  };
}

export async function closeTask(root, taskId, { force = false } = {}) {
  const task = await getTask(root, taskId);
  const verification = await verifyTask(root, task.id);
  if (!verification.valid && !force) {
    throw new Error(`Task ${task.id} is not verified. Run \`awb task verify ${task.id}\`.`);
  }
  task.status = "closed";
  task.closedAt = nowIso();
  task.updatedAt = nowIso();
  task.closedWithForce = Boolean(force && !verification.valid);
  await writeJson(root, `work/tasks/${task.id}.json`, task);
  await touchWorkspace(root);
  return { task, verification };
}

export async function listFilesRecursively(root, relativeDirectory, limit = 50) {
  const target = path.join(root, relativeDirectory);
  if (!(await exists(target))) return [];
  const output = [];
  async function visit(absolute, relative) {
    if (output.length >= limit) return;
    const entries = await readdir(absolute, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (output.length >= limit) break;
      const nextAbsolute = path.join(absolute, entry.name);
      const nextRelative = path.posix.join(relative.replaceAll("\\", "/"), entry.name);
      if (entry.isDirectory()) await visit(nextAbsolute, nextRelative);
      else if (entry.isFile() && entry.name !== "README.md") output.push(nextRelative);
    }
  }
  await visit(target, relativeDirectory);
  return output;
}

export async function taskContext(root, taskId) {
  const task = await getTask(root, taskId);
  const projectRegistry = await getProjects(root);
  const projectMap = new Map(projectRegistry.map((project) => [project.id, project]));
  const projects = await Promise.all(
    task.projects.map((id) => projectMap.get(id)).filter(Boolean).map((project) => resolveProject(root, project))
  );
  const allRelationships = await getRelationships(root);
  const taskSet = new Set(task.projects);
  const relationships = allRelationships.filter(
    (relationship) => taskSet.has(relationship.from) || taskSet.has(relationship.to)
  );
  const relatedIds = new Set();
  for (const relationship of relationships) {
    if (!taskSet.has(relationship.from)) relatedIds.add(relationship.from);
    if (!taskSet.has(relationship.to)) relatedIds.add(relationship.to);
  }
  const relatedProjects = await Promise.all(
    [...relatedIds].map((id) => projectMap.get(id)).filter(Boolean).map((project) => resolveProject(root, project))
  );
  const [knowledge, providers] = await Promise.all([getKnowledgeItems(root), getKnowledgeProviders(root)]);
  const allowedScopes = new Set([
    "user",
    `role:${task.primaryRole}`,
    ...(task.supportingRoles ?? []).map((role) => `role:${role}`),
    ...task.projects.map((project) => `project:${project}`),
    `task:${task.id}`
  ]);
  const allRelevantKnowledge = knowledge
    .filter((item) => allowedScopes.has(item.scope))
    .map(({ id, title, scope, path: itemPath, tags }) => ({ id, title, scope, path: itemPath, tags }));
  const relevantKnowledge = allRelevantKnowledge.slice(0, 50);
  const roles = unique([task.primaryRole, ...(task.supportingRoles ?? [])]);
  const roleFiles = [];
  for (const role of roles) roleFiles.push(...(await listFilesRecursively(root, `roles/${role}`, 20)));
  const skillFiles = [];
  for (const skill of task.skills ?? []) skillFiles.push(...(await listFilesRecursively(root, `skills/${skill}`, 20)));
  const workflowFiles = [];
  for (const workflow of task.workflows ?? []) {
    workflowFiles.push(...(await listFilesRecursively(root, `workflows/${workflow}`, 20)));
  }
  const taskProjects = new Set(task.projects);
  const providerResources = providers.flatMap((provider) =>
    (provider.bindings ?? [])
      .filter((binding) => taskProjects.has(binding.projectId))
      .map((binding) => ({
        providerId: provider.id,
        providerType: provider.type,
        enabled: provider.enabled !== false,
        projectId: binding.projectId,
        knowledgeId: binding.knowledgeId,
        description: binding.description || ""
      }))
  );
  return {
    task,
    userProfile: "user/PROFILE.md",
    projects,
    relationships,
    relatedProjects,
    roleFiles,
    skillFiles,
    workflowFiles,
    knowledge: relevantKnowledge,
    knowledgeTotal: allRelevantKnowledge.length,
    knowledgeTruncated: allRelevantKnowledge.length > relevantKnowledge.length,
    providerResources
  };
}

async function getArtifactRegistry(root) {
  return readJson(root, ARTIFACTS_FILE, { formatVersion: FORMAT_VERSION, artifacts: [] });
}

export async function listArtifacts(root, { taskId } = {}) {
  const registry = await getArtifactRegistry(root);
  const safeTaskId = taskId ? normalizeId(taskId, "Task ID", { uppercase: true }) : null;
  return (registry.artifacts ?? []).filter((artifact) => !safeTaskId || artifact.taskId === safeTaskId);
}

export async function addArtifact(root, input) {
  const task = await getTask(root, input.taskId);
  if (task.status !== "active") throw new Error(`Task is not active: ${task.id}`);
  const projectId = normalizeId(input.projectId || task.primaryProject, "Project ID");
  if (!task.projects.includes(projectId)) throw new Error(`Project is outside task scope: ${projectId}`);
  const relativePath = normalizeProjectRelative(input.path);
  if (!scopeAllows(task.writeScopes ?? [], projectId, relativePath)) {
    throw new Error(`Artifact path is outside task write scope: project:${projectId}/${relativePath}`);
  }
  const project = await getProject(root, projectId);
  const resolvedProject = await resolveProject(root, project);
  if (!resolvedProject.available) throw new Error(`Project source is unavailable: ${projectId}. ${resolvedProject.reason ?? ""}`.trim());
  const absolutePath = resolveWithinProject(resolvedProject.resolvedPath, relativePath);
  if (!(await exists(absolutePath))) throw new Error(`Artifact file does not exist: ${absolutePath}`);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) throw new Error("Artifacts must reference files.");
  const registry = await getArtifactRegistry(root);
  const artifacts = registry.artifacts ?? [];
  const id = normalizeId(input.id || makeId("artifact"), "Artifact ID");
  if (artifacts.some((artifact) => artifact.id === id)) throw new Error(`Artifact already exists: ${id}`);
  const artifact = {
    id,
    taskId: task.id,
    projectId,
    path: relativePath,
    kind: normalizeId(input.kind, "Artifact kind"),
    title: input.title || path.basename(relativePath),
    verified: Boolean(input.verified),
    verificationNote: input.verificationNote || null,
    sizeBytes: fileStat.size,
    createdAt: nowIso(),
    verifiedAt: input.verified ? nowIso() : null
  };
  artifacts.push(artifact);
  artifacts.sort((a, b) => a.id.localeCompare(b.id));
  await writeJson(root, ARTIFACTS_FILE, { ...registry, formatVersion: FORMAT_VERSION, artifacts });
  await touchWorkspace(root);
  return artifact;
}

export async function resolveArtifact(root, artifactOrId) {
  const artifact =
    typeof artifactOrId === "string"
      ? (await listArtifacts(root)).find((candidate) => candidate.id === artifactOrId)
      : artifactOrId;
  if (!artifact) throw new Error(`Unknown artifact: ${artifactOrId}`);
  const project = await resolveProject(root, artifact.projectId);
  if (!project.available) {
    return { ...artifact, absolutePath: null, exists: false, reason: project.reason };
  }
  const absolutePath = resolveWithinProject(project.resolvedPath, artifact.path);
  return { ...artifact, absolutePath, exists: await exists(absolutePath), reason: null };
}

export async function getKnowledgeItems(root) {
  const registry = await getKnowledgeRegistry(root);
  return registry.items ?? [];
}

async function getKnowledgeRegistry(root) {
  return readJson(root, KNOWLEDGE_FILE, { formatVersion: FORMAT_VERSION, items: [] });
}

export async function getKnowledgeProviders(root) {
  const registry = await readJson(root, PROVIDERS_FILE, { formatVersion: FORMAT_VERSION, providers: [] });
  return registry.providers ?? [];
}

export async function getKnowledgeProvider(root, id) {
  const safeId = normalizeId(id, "Provider ID");
  const provider = (await getKnowledgeProviders(root)).find((candidate) => candidate.id === safeId);
  if (!provider) throw new Error(`Unknown knowledge provider: ${safeId}`);
  return provider;
}

export async function addKnowledgeProvider(root, input) {
  const id = normalizeId(input.id, "Provider ID");
  const registry = await readJson(root, PROVIDERS_FILE, { formatVersion: FORMAT_VERSION, providers: [] });
  const providers = registry.providers ?? [];
  if (providers.some((provider) => provider.id === id)) throw new Error(`Knowledge provider already exists: ${id}`);
  const normalized = normalizeProviderConfig(input);
  const timestamp = nowIso();
  const provider = {
    id,
    name: input.name || id,
    ...normalized,
    bindings: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
  providers.push(provider);
  providers.sort((a, b) => a.id.localeCompare(b.id));
  await writeJson(root, PROVIDERS_FILE, { ...registry, formatVersion: FORMAT_VERSION, providers });
  await touchWorkspace(root);
  return provider;
}

export async function bindKnowledgeProvider(root, providerId, input) {
  const safeProviderId = normalizeId(providerId, "Provider ID");
  const projectId = normalizeId(input.projectId, "Project ID");
  await getProject(root, projectId);
  const knowledgeId = normalizeKnowledgeResourceId(input.knowledgeId);
  const registry = await readJson(root, PROVIDERS_FILE, { formatVersion: FORMAT_VERSION, providers: [] });
  const provider = (registry.providers ?? []).find((candidate) => candidate.id === safeProviderId);
  if (!provider) throw new Error(`Unknown knowledge provider: ${safeProviderId}`);
  provider.bindings ??= [];
  if (provider.bindings.some((binding) => binding.projectId === projectId && binding.knowledgeId === knowledgeId)) {
    throw new Error(`Provider binding already exists: ${safeProviderId}/${projectId}/${knowledgeId}`);
  }
  const binding = {
    projectId,
    knowledgeId,
    description: input.description || "",
    createdAt: nowIso()
  };
  provider.bindings.push(binding);
  provider.bindings.sort((a, b) => `${a.projectId}:${a.knowledgeId}`.localeCompare(`${b.projectId}:${b.knowledgeId}`));
  provider.updatedAt = nowIso();
  await writeJson(root, PROVIDERS_FILE, { ...registry, formatVersion: FORMAT_VERSION, providers: registry.providers });
  await touchWorkspace(root);
  return { providerId: safeProviderId, binding };
}

export async function setKnowledgeProviderEnabled(root, providerId, enabled) {
  const safeProviderId = normalizeId(providerId, "Provider ID");
  const registry = await readJson(root, PROVIDERS_FILE, { formatVersion: FORMAT_VERSION, providers: [] });
  const provider = (registry.providers ?? []).find((candidate) => candidate.id === safeProviderId);
  if (!provider) throw new Error(`Unknown knowledge provider: ${safeProviderId}`);
  provider.enabled = Boolean(enabled);
  provider.updatedAt = nowIso();
  await writeJson(root, PROVIDERS_FILE, { ...registry, formatVersion: FORMAT_VERSION, providers: registry.providers });
  await touchWorkspace(root);
  return provider;
}

// Returns the canonical scope string, so a stored scope always matches the one
// `taskContext` derives from the record it points at.
export async function validateScope(root, scope) {
  if (scope === "user") return scope;
  const match = /^(role|project|task):([A-Za-z0-9._-]+)$/.exec(scope ?? "");
  if (!match) throw new Error("Scope must be user, role:<id>, project:<id>, or task:<id>.");
  const [, kind, id] = match;
  if (kind === "role") return `role:${normalizeId(id, "Role ID")}`;
  if (kind === "project") {
    const projectId = normalizeId(id, "Project ID");
    if (!(await getProjects(root)).some((project) => project.id === projectId)) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    return `project:${projectId}`;
  }
  return `task:${(await getTask(root, id)).id}`;
}

export async function addKnowledge(root, input) {
  const id = normalizeId(input.id, "Knowledge ID");
  const scope = await validateScope(root, input.scope || "user");
  const registry = await getKnowledgeRegistry(root);
  const items = registry.items ?? [];
  const existingIndex = items.findIndex((item) => item.id === id);
  if (existingIndex >= 0 && !input.replace) throw new Error(`Knowledge already exists: ${id}`);
  const itemPath = `knowledge/items/${id}.md`;
  const timestamp = nowIso();
  const existing = existingIndex >= 0 ? items[existingIndex] : null;
  const item = {
    id,
    title: input.title || id,
    scope,
    path: itemPath,
    tags: unique(input.tags ?? []),
    sourceTask: input.sourceTask || null,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };
  const markdown = `# ${item.title}\n\n${String(input.text ?? "").trim()}\n`;
  await writeText(root, itemPath, markdown);
  if (existingIndex >= 0) items[existingIndex] = item;
  else items.push(item);
  items.sort((a, b) => a.id.localeCompare(b.id));
  await writeJson(root, KNOWLEDGE_FILE, { ...registry, formatVersion: FORMAT_VERSION, items });
  await touchWorkspace(root);
  return item;
}

export async function readKnowledge(root, id) {
  const safeId = normalizeId(id, "Knowledge ID");
  const item = (await getKnowledgeItems(root)).find((candidate) => candidate.id === safeId);
  if (!item) throw new Error(`Unknown knowledge item: ${safeId}`);
  const itemPath = workspaceRelative(root, item.path);
  const content = await readFile(path.join(root, itemPath), "utf8");
  return { ...item, content };
}

// Reading filters through the same canonicalization as writing: a scope saved
// as `task:task-a` is stored as `task:TASK-A`, so comparing the raw argument
// would silently return nothing for the exact string the user just saved with.
export async function listKnowledge(root, { scope } = {}) {
  const items = await getKnowledgeItems(root);
  if (!scope) return items;
  const canonical = await validateScope(root, scope);
  return items.filter((item) => item.scope === canonical);
}

export async function searchKnowledge(root, query, { scope } = {}) {
  const normalizedQuery = String(query ?? "").trim().toLowerCase();
  if (!normalizedQuery) throw new Error("Search query is required.");
  const canonicalScope = scope ? await validateScope(root, scope) : null;
  const items = await getKnowledgeItems(root);
  const results = [];
  for (const item of items) {
    if (canonicalScope && item.scope !== canonicalScope) continue;
    let content = "";
    try {
      const itemPath = workspaceRelative(root, item.path);
      content = await readFile(path.join(root, itemPath), "utf8");
    } catch {
      // Validation reports missing bodies; search simply skips their content.
    }
    const haystack = [item.id, item.title, item.scope, ...(item.tags ?? []), content].join("\n").toLowerCase();
    const position = haystack.indexOf(normalizedQuery);
    if (position < 0) continue;
    const flat = content.replace(/\s+/g, " ").trim();
    const contentPosition = flat.toLowerCase().indexOf(normalizedQuery);
    const start = Math.max(0, contentPosition - 70);
    const snippet = flat
      ? `${start > 0 ? "…" : ""}${flat.slice(start, start + 180)}${flat.length > start + 180 ? "…" : ""}`
      : "";
    results.push({ id: item.id, title: item.title, scope: item.scope, path: item.path, tags: item.tags, snippet });
  }
  return results;
}

export async function proposeMemory(root, input) {
  const id = normalizeId(input.id || makeId("LEARN", { uppercase: true }), "Proposal ID", {
    uppercase: true
  });
  const target = `work/proposals/${id}.json`;
  if (await exists(path.join(root, target))) throw new Error(`Proposal already exists: ${id}`);
  const scope = await validateScope(root, input.scope || "user");
  const sourceTask = input.taskId ? (await getTask(root, input.taskId)).id : null;
  const proposal = {
    id,
    status: "candidate",
    kind: normalizeId(input.kind || "lesson", "Memory kind"),
    title: input.title || id,
    scope,
    text: String(input.text ?? "").trim(),
    sourceTask,
    sourceProvider: input.sourceProvider || null,
    sourceRef: input.sourceRef || null,
    sourceTool: input.sourceTool || null,
    tags: unique(input.tags ?? []),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  if (!proposal.text) throw new Error("Proposal text is required.");
  await writeJson(root, target, proposal);
  await touchWorkspace(root);
  return proposal;
}

export async function getProposal(root, id) {
  const safeId = normalizeId(id, "Proposal ID", { uppercase: true });
  return readJson(root, `work/proposals/${safeId}.json`);
}

export async function listProposals(root, { status } = {}) {
  const directory = path.join(root, "work", "proposals");
  if (!(await exists(directory))) return [];
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  const proposals = [];
  for (const file of files) {
    const proposal = await readJson(root, `work/proposals/${file}`);
    if (!status || proposal.status === status) proposals.push(proposal);
  }
  return proposals;
}

export async function approveMemory(root, id, { knowledgeId } = {}) {
  const proposal = await getProposal(root, id);
  if (proposal.status !== "candidate") throw new Error(`Proposal is already ${proposal.status}: ${proposal.id}`);
  const targetId = normalizeId(
    knowledgeId || `${proposal.kind}-${proposal.id.toLowerCase().replace(/^learn-/, "")}`,
    "Knowledge ID"
  );
  const item = await addKnowledge(root, {
    id: targetId,
    title: proposal.title,
    scope: proposal.scope,
    tags: proposal.tags,
    sourceTask: proposal.sourceTask,
    text: proposal.text
  });
  proposal.status = "approved";
  proposal.knowledgeId = item.id;
  proposal.approvedAt = nowIso();
  proposal.updatedAt = nowIso();
  await writeJson(root, `work/proposals/${proposal.id}.json`, proposal);
  return { proposal, knowledge: item };
}

export async function rejectMemory(root, id, { reason = "" } = {}) {
  const proposal = await getProposal(root, id);
  if (proposal.status !== "candidate") throw new Error(`Proposal is already ${proposal.status}: ${proposal.id}`);
  proposal.status = "rejected";
  proposal.rejectionReason = reason;
  proposal.rejectedAt = nowIso();
  proposal.updatedAt = nowIso();
  await writeJson(root, `work/proposals/${proposal.id}.json`, proposal);
  await touchWorkspace(root);
  return proposal;
}

export async function listDirectDirectories(root, relativeDirectory) {
  const target = path.join(root, relativeDirectory);
  if (!(await exists(target))) return [];
  const entries = await readdir(target, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

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

export async function validateWorkspace(root) {
  const errors = [];
  const warnings = [];
  // The portable contracts in schemas/ are the published description of this
  // data, so validation checks records against them rather than only against
  // the hand-written rules below.
  const schemas = await loadSchemas([
    "workspace",
    "project",
    "relationship",
    "task",
    "artifact",
    "provider"
  ]);
  const required = [
    ".awb/workspace.json",
    "START_HERE.md",
    PROJECTS_FILE,
    RELATIONSHIPS_FILE,
    KNOWLEDGE_FILE,
    PROVIDERS_FILE,
    "work/tasks",
    "work/proposals",
    ARTIFACTS_FILE,
    "src"
  ];
  for (const relative of required) {
    if (!(await exists(path.join(root, relative)))) errors.push(`Missing required path: ${relative}`);
  }

  let workspace;
  let projects = [];
  let relationships = [];
  let knowledge = [];
  let artifacts = [];
  let providers = [];
  try {
    workspace = await getWorkspace(root);
    if (workspace.formatVersion !== FORMAT_VERSION) {
      errors.push(`Unsupported formatVersion: ${workspace.formatVersion ?? "missing"}`);
    }
    errors.push(...validateAgainstSchema(workspace, schemas.workspace, "Workspace"));
  } catch (error) {
    errors.push(error.message);
  }
  try {
    projects = await getProjects(root);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    relationships = await getRelationships(root);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    knowledge = await getKnowledgeItems(root);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    artifacts = await listArtifacts(root);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    providers = await getKnowledgeProviders(root);
  } catch (error) {
    errors.push(error.message);
  }

  const projectIds = new Set();
  for (const project of projects) {
    try {
      normalizeId(project.id, "Project ID");
      errors.push(...validateAgainstSchema(project, schemas.project, `Project ${project.id}`));
      if (projectIds.has(project.id)) errors.push(`Duplicate project ID: ${project.id}`);
      projectIds.add(project.id);
      const sourcePath = workspaceRelative(root, project.path, { requireSource: true });
      if (project.sourceMode === "external") {
        if (!sourcePath.endsWith(".source.json")) errors.push(`External project descriptor must end in .source.json: ${project.id}`);
        if (project.localReference) workspaceRelative(root, project.localReference, { requireSource: true });
      }
      const resolved = await resolveProject(root, project);
      if (!resolved.available) warnings.push(`Project source is unavailable: ${project.id} -> ${resolved.reason}`);
    } catch (error) {
      errors.push(`Project ${project.id ?? "<unknown>"}: ${error.message}`);
    }
  }

  const relationshipIds = new Set();
  for (const relationship of relationships) {
    errors.push(...validateAgainstSchema(relationship, schemas.relationship, `Relationship ${relationship.id}`));
    if (relationshipIds.has(relationship.id)) errors.push(`Duplicate relationship ID: ${relationship.id}`);
    relationshipIds.add(relationship.id);
    if (!projectIds.has(relationship.from)) errors.push(`Relationship ${relationship.id} has unknown source: ${relationship.from}`);
    if (!projectIds.has(relationship.to)) errors.push(`Relationship ${relationship.id} has unknown target: ${relationship.to}`);
    if (relationship.contract) {
      try {
        const contractPath = workspaceRelative(root, relationship.contract);
        if (!(await exists(path.join(root, contractPath)))) {
          warnings.push(`Relationship contract does not exist: ${relationship.id} -> ${relationship.contract}`);
        }
      } catch (error) {
        errors.push(`Relationship ${relationship.id}: ${error.message}`);
      }
    }
  }

  const providerIds = new Set();
  for (const provider of providers) {
    try {
      normalizeId(provider.id, "Provider ID");
      errors.push(...validateAgainstSchema(provider, schemas.provider, `Provider ${provider.id}`));
      if (providerIds.has(provider.id)) errors.push(`Duplicate provider ID: ${provider.id}`);
      providerIds.add(provider.id);
      if (!provider.endpoints?.knowledge) throw new Error("Knowledge endpoint is required.");
      if (!Array.isArray(provider.bindings)) throw new Error("Provider bindings must be an array.");
      normalizeProviderConfig(provider);
      const bindingKeys = new Set();
      for (const binding of provider.bindings ?? []) {
        normalizeId(binding.projectId, "Project ID");
        if (!projectIds.has(binding.projectId)) {
          errors.push(`Provider ${provider.id} binding references unknown project: ${binding.projectId}`);
        }
        const knowledgeId = normalizeKnowledgeResourceId(binding.knowledgeId);
        const key = `${binding.projectId}:${knowledgeId}`;
        if (bindingKeys.has(key)) errors.push(`Duplicate provider binding: ${provider.id}/${key}`);
        bindingKeys.add(key);
      }
    } catch (error) {
      errors.push(`Provider ${provider.id ?? "<unknown>"}: ${error.message}`);
    }
  }

  const knowledgeIds = new Set();
  for (const item of knowledge) {
    if (knowledgeIds.has(item.id)) errors.push(`Duplicate knowledge ID: ${item.id}`);
    knowledgeIds.add(item.id);
    try {
      const itemPath = workspaceRelative(root, item.path);
      if (!(await exists(path.join(root, itemPath)))) errors.push(`Knowledge body does not exist: ${item.id} -> ${item.path}`);
    } catch (error) {
      errors.push(`Knowledge ${item.id}: ${error.message}`);
    }
  }

  try {
    const tasks = await listTasks(root);
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
      for (const project of task.projects ?? []) {
        if (!projectIds.has(project)) errors.push(`Task ${task.id} references unknown project: ${project}`);
      }
      if (!(task.projects ?? []).includes(task.primaryProject)) {
        errors.push(`Task ${task.id} primary project is not in its project list.`);
      }
      for (const scope of [...(task.readScopes ?? []), ...(task.writeScopes ?? [])]) {
        try {
          normalizeAccessScope(scope, task.projects ?? []);
        } catch (error) {
          errors.push(`Task ${task.id}: ${error.message}`);
        }
      }
      for (const target of task.browserTargets ?? []) {
        try {
          normalizeBrowserTarget(target);
        } catch (error) {
          errors.push(`Task ${task.id}: ${error.message}`);
        }
      }
    }
  } catch (error) {
    errors.push(error.message);
  }

  const artifactIds = new Set();
  for (const artifact of artifacts) {
    errors.push(...validateAgainstSchema(artifact, schemas.artifact, `Artifact ${artifact.id}`));
    if (artifactIds.has(artifact.id)) errors.push(`Duplicate artifact ID: ${artifact.id}`);
    artifactIds.add(artifact.id);
    if (!projectIds.has(artifact.projectId)) errors.push(`Artifact ${artifact.id} references unknown project: ${artifact.projectId}`);
    try {
      const resolved = await resolveArtifact(root, artifact);
      if (!resolved.exists) warnings.push(`Artifact file is unavailable: ${artifact.id}`);
    } catch (error) {
      errors.push(`Artifact ${artifact.id}: ${error.message}`);
    }
  }

  return {
    valid: errors.length === 0,
    workspace: workspace?.name ?? path.basename(root),
    formatVersion: workspace?.formatVersion ?? null,
    counts: {
      projects: projects.length,
      relationships: relationships.length,
      knowledge: knowledge.length,
      artifacts: artifacts.length,
      providers: providers.length
    },
    errors,
    warnings
  };
}

function normalizeKnowledgeResourceId(value) {
  const id = String(value ?? "").trim();
  if (!id) throw new Error("Knowledge resource ID is required.");
  if (id.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
    throw new Error("Knowledge resource ID contains unsupported characters.");
  }
  return id;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ""))];
}

function normalizeBrowserTarget(value) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error(`Invalid browser target: ${value}`);
  }
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error(`Browser target must use http or https: ${value}`);
  }
  return target.toString();
}

function normalizeAccessScope(value, taskProjects) {
  const match = /^project:([a-z0-9][a-z0-9._-]*)(?:\/(.+))?$/.exec(String(value ?? ""));
  if (!match) throw new Error(`Invalid access scope: ${value}. Use project:<id> or project:<id>/<path>.`);
  const [, projectId, relative] = match;
  normalizeId(projectId, "Project ID");
  if (!taskProjects.includes(projectId)) throw new Error(`Access scope project is not part of the task: ${projectId}`);
  return relative ? `project:${projectId}/${normalizeProjectRelative(relative)}` : `project:${projectId}`;
}

function normalizeProjectRelative(value) {
  if (!value || typeof value !== "string" || isAbsoluteAnyPlatform(value)) {
    throw new Error("A project-relative file path is required.");
  }
  const normalized = toPortablePath(value);
  if (isAbsoluteAnyPlatform(normalized) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Project paths cannot leave the project source root.");
  }
  return normalized;
}

// Second line of defence at every join site: even if normalization were bypassed,
// the resolved path must still sit inside the project source root.
function resolveWithinProject(sourceRoot, relativePath) {
  const baseResolved = path.resolve(sourceRoot);
  const resolved = path.resolve(baseResolved, normalizeProjectRelative(relativePath));
  if (resolved !== baseResolved && !resolved.startsWith(`${baseResolved}${path.sep}`)) {
    throw new Error("Project paths cannot leave the project source root.");
  }
  return resolved;
}

function scopeAllows(scopes, projectId, relativePath) {
  return scopes.some((scope) => {
    const match = /^project:([a-z0-9][a-z0-9._-]*)(?:\/(.+))?$/.exec(scope);
    if (!match || match[1] !== projectId) return false;
    if (!match[2]) return true;
    const base = normalizeProjectRelative(match[2]).replace(/\/$/, "");
    return relativePath === base || relativePath.startsWith(`${base}/`);
  });
}
