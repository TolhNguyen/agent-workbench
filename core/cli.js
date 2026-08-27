import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  PACKAGE_VERSION,
  addArtifact,
  addKnowledge,
  addKnowledgeProvider,
  addProject,
  addRelationship,
  approveMemory,
  bindKnowledgeProvider,
  closeTask,
  completeProfile,
  createTask,
  findWorkspaceRoot,
  getKnowledgeProvider,
  getKnowledgeProviders,
  getProjects,
  getRelationships,
  initWorkspace,
  listArtifacts,
  listCapabilities,
  listKnowledge,
  listProposals,
  listTasks,
  migrateWorkspace,
  normalizeId,
  passQualityGate,
  profileStatus,
  proposeMemory,
  readKnowledge,
  rejectMemory,
  resolveProject,
  searchKnowledge,
  setKnowledgeProviderEnabled,
  showCapability,
  taskContext,
  validateWorkspace,
  verifyTask
} from "./core.js";
import { buildProfile } from "./profile.js";
import { callProviderTool, listProviderTools, probeProvider, recallCoreMemory, searchProvider } from "./providers.js";

// Boolean flags are recognised globally rather than per command: the command is
// only known once positionals are parsed, and whether a flag consumes the next
// token has to be decided during that same pass.
const BOOLEAN_OPTIONS = new Set([
  "json", "create", "replace", "stdin", "help", "verified", "force", "allow-nested", "skip-onboarding"
]);

const GLOBAL_OPTIONS = ["root", "json", "output", "help"];

// The accepted options per command. Without this, a typo such as `--titl` is
// swallowed silently: it consumes the following token as its value and leaves
// the option the user meant at its default.
const COMMAND_OPTIONS = {
  init: ["name", "description", "allow-nested"],
  migrate: [],
  validate: [],
  "project add": ["name", "path", "description", "tag", "create", "mode", "external-path", "repo"],
  "project list": [],
  "project relations": [],
  "project resolve": [],
  "relation add": ["id", "description", "contract", "tag", "last-verified"],
  "relation list": [],
  "role list": [],
  "role show": [],
  "skill list": [],
  "skill show": [],
  "workflow list": [],
  "workflow show": [],
  "task create": [
    "id", "title", "objective", "audience", "role", "supporting-role", "primary", "project",
    "skill", "workflow", "browser", "read", "write", "deliverable", "quality-gate", "constraint", "done",
    "skip-onboarding"
  ],
  "task list": ["status"],
  "task context": [],
  "task gate-pass": ["note"],
  "task verify": [],
  "task close": ["force"],
  "artifact add": ["id", "task", "project", "path", "kind", "title", "verified", "verification-note"],
  "artifact list": ["task"],
  "knowledge add": ["title", "scope", "tag", "task", "text", "file", "stdin", "replace"],
  "knowledge list": ["scope"],
  "knowledge read": [],
  "knowledge search": ["query", "scope"],
  "memory propose": [
    "id", "kind", "title", "scope", "text", "file", "stdin", "task", "tag",
    "source-provider", "source-ref", "source-tool"
  ],
  "memory list": ["status"],
  "memory approve": ["knowledge-id"],
  "memory reject": ["reason"],
  "provider add": [
    "name", "type", "knowledge-url", "core-url", "service-id",
    "auth-env", "knowledge-auth-env", "core-auth-env", "timeout-ms"
  ],
  "provider list": [],
  "provider bind": ["project", "knowledge-id", "description"],
  "provider enable": [],
  "provider disable": [],
  "provider status": [],
  "provider tools": ["knowledge-id"],
  "provider call": ["knowledge-id", "params"],
  "provider search": ["knowledge-id", "query", "limit"],
  "provider recall": ["project", "provider", "limit", "query"],
  "provider memory-recall": ["query", "session-key", "user-id"],
  "provider propose": [
    "id", "kind", "title", "scope", "text", "file", "stdin", "task", "tag",
    "knowledge-id", "source-ref", "source-tool"
  ],
  "profile build": [],
  "profile status": [],
  "profile complete": [
    "name", "role", "language", "responsibility", "system", "skill",
    "principle", "constraint", "replace"
  ]
};

export async function run(argv, io = defaultIo()) {
  const parsed = parseArgs(argv);
  const [group = "help", action, ...positionals] = parsed.positionals;
  const wantsJson = has(parsed, "json") || value(parsed, "output") === "json";
  try {
    return await dispatch({ io, parsed, group, action, positionals, wantsJson });
  } catch (error) {
    emitError(io, error, wantsJson);
    return { exitCode: 1 };
  }
}

async function dispatch({ io, parsed, group, action, positionals, wantsJson }) {
  // Checked before help: `--version` is parsed as an option, which leaves no
  // positionals at all, and an empty command line otherwise defaults to help.
  if (group === "version" || group === "-v" || has(parsed, "version")) {
    emit(io, PACKAGE_VERSION);
    return { exitCode: 0 };
  }
  if (group === "help" || has(parsed, "help")) {
    emit(io, helpFor(group === "help" ? action || positionals[0] : group));
    return { exitCode: 0 };
  }
  assertKnownOptions(parsed, group, action);

  if (group === "init") {
    const root = path.resolve(value(parsed, "root") || io.cwd);
    const result = await initWorkspace(root, {
      name: value(parsed, "name") || "Agent Workbench",
      description: value(parsed, "description") || "",
      allowNested: has(parsed, "allow-nested")
    });
    emitResult(io, result, wantsJson, () => `Initialized ${result.name}\nRoot: ${result.root}\nFormat: ${result.formatVersion}`);
    return { exitCode: 0, result };
  }

  const root = await findWorkspaceRoot(value(parsed, "root") || io.cwd);
  let command;

  switch (group) {
    case "migrate": {
      const migration = await migrateWorkspace(root);
      command = { data: migration, text: () => formatMigration(migration) };
      break;
    }
    case "validate": {
      const validation = await validateWorkspace(root);
      command = {
        data: validation,
        exitCode: validation.valid ? 0 : 2,
        text: () => formatValidation(validation)
      };
      break;
    }
    case "project":
      command = await projectCommand(root, action, positionals, parsed);
      break;
    case "relation":
      command = await relationCommand(root, action, positionals, parsed);
      break;
    case "role":
    case "skill":
    case "workflow":
      command = await capabilityCommand(root, group, action, positionals);
      break;
    case "task":
      command = await taskCommand(root, action, positionals, parsed);
      break;
    case "artifact":
      command = await artifactCommand(root, action, positionals, parsed);
      break;
    case "knowledge":
      command = await knowledgeCommand(root, action, positionals, parsed, io);
      break;
    case "memory":
      command = await memoryCommand(root, action, positionals, parsed, io);
      break;
    case "provider":
      command = await providerCommand(root, action, positionals, parsed, io);
      break;
    case "profile": {
      if (action === "status") {
        const status = await profileStatus(root);
        command = { data: status, text: () => formatProfileStatus(status) };
        break;
      }
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
      if (action !== "build") throw new Error("Usage: awb profile build|status|complete");
      const profile = await buildProfile(root);
      command = {
        data: profile,
        text: () =>
          `Profile generated: ${profile.path}\nProjects: ${profile.counts.projects}\nProviders: ${profile.counts.providers}\nActive tasks: ${profile.counts.activeTasks}`
      };
      break;
    }
    default:
      throw new Error(`Unknown command: ${group}. Run \`awb help\`.`);
  }

  emitResult(io, command.data, wantsJson, command.text);
  return { exitCode: command.exitCode ?? 0, result: command.data };
}

function assertKnownOptions(parsed, group, action) {
  const key = action ? `${group} ${action}` : group;
  const allowed = COMMAND_OPTIONS[key];
  // An unrecognised command or action falls through to its own usage error.
  if (!allowed) return;
  const known = new Set([...GLOBAL_OPTIONS, ...allowed]);
  const unknown = [...parsed.options.keys()].filter((name) => !known.has(name));
  if (unknown.length) {
    const list = unknown.map((name) => `--${name}`).join(", ");
    throw new Error(
      `Unknown option${unknown.length > 1 ? "s" : ""} for \`awb ${key}\`: ${list}. Run \`awb ${group} --help\`.`
    );
  }
}

async function projectCommand(root, action, positionals, parsed) {
  if (action === "add") {
    const id = positionals[0];
    const project = await addProject(root, {
      id,
      name: value(parsed, "name"),
      path: value(parsed, "path"),
      description: value(parsed, "description"),
      tags: values(parsed, "tag"),
      createPath: has(parsed, "create"),
      sourceMode: value(parsed, "mode"),
      externalPath: value(parsed, "external-path"),
      repositoryUrl: value(parsed, "repo")
    });
    return {
      data: project,
      text: () => `Project added: ${project.id}\nName: ${project.name}\nMode: ${project.sourceMode}\nPath: ${project.path}`
    };
  }
  if (action === "list") {
    const projects = await getProjects(root);
    return {
      data: projects,
      text: () =>
        projects.length
          ? projects.map((project) => `- ${project.id}: ${project.name} [${project.sourceMode || "managed"}] (${project.path})`).join("\n")
          : "No projects registered."
    };
  }
  if (action === "relations") {
    const id = positionals[0];
    if (!id) throw new Error("Usage: awb project relations <project-id>");
    const projectId = normalizeId(id, "Project ID");
    const projects = await getProjects(root);
    if (!projects.some((project) => project.id === projectId)) throw new Error(`Unknown project: ${projectId}`);
    const relationships = (await getRelationships(root)).filter(
      (item) => item.from === projectId || item.to === projectId
    );
    return {
      data: relationships,
      text: () =>
        relationships.length
          ? relationships
              .map((item) =>
                item.from === projectId
                  ? `- outgoing: ${item.from} --${item.type}--> ${item.to}`
                  : `- incoming: ${item.from} --${item.type}--> ${item.to}`
              )
              .join("\n")
          : `No relationships found for ${projectId}.`
    };
  }
  if (action === "resolve") {
    const id = positionals[0];
    if (!id) throw new Error("Usage: awb project resolve <project-id>");
    const project = await resolveProject(root, id);
    return {
      data: project,
      text: () =>
        `Project: ${project.id}\nMode: ${project.sourceMode || "managed"}\nAvailable: ${project.available}\nResolved path: ${project.resolvedPath || "unavailable"}${project.reason ? `\nReason: ${project.reason}` : ""}`
    };
  }
  throw new Error("Usage: awb project add|list|relations|resolve");
}

async function relationCommand(root, action, positionals, parsed) {
  if (action === "add") {
    const [from, type, to] = positionals;
    const relationship = await addRelationship(root, {
      from,
      type,
      to,
      id: value(parsed, "id"),
      description: value(parsed, "description"),
      contract: value(parsed, "contract"),
      tags: values(parsed, "tag"),
      lastVerified: value(parsed, "last-verified")
    });
    return {
      data: relationship,
      text: () => `Relationship added: ${relationship.from} --${relationship.type}--> ${relationship.to}`
    };
  }
  if (action === "list") {
    const relationships = await getRelationships(root);
    return {
      data: relationships,
      text: () =>
        relationships.length
          ? relationships.map((item) => `- ${item.from} --${item.type}--> ${item.to}`).join("\n")
          : "No relationships registered."
    };
  }
  throw new Error("Usage: awb relation add|list");
}

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

async function taskCommand(root, action, positionals, parsed) {
  if (action === "create") {
    const task = await createTask(root, {
      id: value(parsed, "id"),
      title: value(parsed, "title"),
      objective: value(parsed, "objective"),
      audience: value(parsed, "audience"),
      primaryRole: value(parsed, "role"),
      supportingRoles: values(parsed, "supporting-role"),
      primaryProject: value(parsed, "primary"),
      projects: values(parsed, "project"),
      skills: values(parsed, "skill"),
      workflows: values(parsed, "workflow"),
      browserTargets: values(parsed, "browser"),
      readScopes: values(parsed, "read"),
      writeScopes: values(parsed, "write"),
      deliverables: values(parsed, "deliverable"),
      qualityGates: values(parsed, "quality-gate"),
      constraints: values(parsed, "constraint"),
      doneWhen: values(parsed, "done"),
      skipOnboarding: has(parsed, "skip-onboarding")
    });
    return {
      data: task,
      text: () => `Task created: ${task.id}\nRole: ${task.primaryRole}\nProjects: ${task.projects.join(", ")}`
    };
  }
  if (action === "list") {
    const status = value(parsed, "status");
    const tasks = (await listTasks(root)).filter((task) => !status || task.status === status);
    return {
      data: tasks,
      text: () =>
        tasks.length
          ? tasks.map((task) => `- ${task.id} [${task.status}] ${task.title} · ${task.projects.join(", ")}`).join("\n")
          : "No tasks found."
    };
  }
  if (action === "context") {
    const id = positionals[0];
    if (!id) throw new Error("Usage: awb task context <task-id>");
    const context = await taskContext(root, id);
    return { data: context, text: () => formatTaskContext(context) };
  }
  if (action === "gate-pass") {
    const [taskId, gateId] = positionals;
    if (!taskId || !gateId) throw new Error("Usage: awb task gate-pass <task-id> <gate-id>");
    const result = await passQualityGate(root, taskId, gateId, { note: value(parsed, "note") });
    return { data: result, text: () => `Quality gate passed: ${result.gate.id}\nTask: ${result.taskId}` };
  }
  if (action === "verify") {
    const id = positionals[0];
    if (!id) throw new Error("Usage: awb task verify <task-id>");
    const verification = await verifyTask(root, id);
    return { data: verification, text: () => formatTaskVerification(verification) };
  }
  if (action === "close") {
    const id = positionals[0];
    if (!id) throw new Error("Usage: awb task close <task-id>");
    const result = await closeTask(root, id, { force: has(parsed, "force") });
    return { data: result, text: () => `Task closed: ${result.task.id}\nVerified: ${result.verification.valid}` };
  }
  throw new Error("Usage: awb task create|list|context|gate-pass|verify|close");
}

async function artifactCommand(root, action, positionals, parsed) {
  if (action === "add") {
    const taskId = positionals[0] || value(parsed, "task");
    if (!taskId) throw new Error("Usage: awb artifact add <task-id> --project <id> --path <path> --kind <id>");
    const artifact = await addArtifact(root, {
      id: value(parsed, "id"),
      taskId,
      projectId: value(parsed, "project"),
      path: value(parsed, "path"),
      kind: value(parsed, "kind"),
      title: value(parsed, "title"),
      verified: has(parsed, "verified"),
      verificationNote: value(parsed, "verification-note")
    });
    return {
      data: artifact,
      text: () => `Artifact registered: ${artifact.id}\nTask: ${artifact.taskId}\nProject: ${artifact.projectId}\nPath: ${artifact.path}\nVerified: ${artifact.verified}`
    };
  }
  if (action === "list") {
    const artifacts = await listArtifacts(root, { taskId: value(parsed, "task") || positionals[0] });
    return {
      data: artifacts,
      text: () =>
        artifacts.length
          ? artifacts.map((item) => `- ${item.id} [${item.kind}] ${item.projectId}/${item.path} · verified=${item.verified}`).join("\n")
          : "No artifacts found."
    };
  }
  throw new Error("Usage: awb artifact add|list");
}

async function knowledgeCommand(root, action, positionals, parsed, io) {
  if (action === "add") {
    const id = positionals[0];
    const text = await textInput(root, parsed, io);
    const item = await addKnowledge(root, {
      id,
      title: value(parsed, "title"),
      scope: value(parsed, "scope"),
      tags: values(parsed, "tag"),
      sourceTask: value(parsed, "task"),
      text,
      replace: has(parsed, "replace")
    });
    return {
      data: item,
      text: () => `Knowledge saved: ${item.id}\nScope: ${item.scope}\nPath: ${item.path}`
    };
  }
  if (action === "list") {
    const items = await listKnowledge(root, { scope: value(parsed, "scope") });
    return {
      data: items,
      text: () =>
        items.length
          ? items.map((item) => `- ${item.id}: ${item.title} [${item.scope}]`).join("\n")
          : "No knowledge items found."
    };
  }
  if (action === "read") {
    const id = positionals[0];
    if (!id) throw new Error("Usage: awb knowledge read <knowledge-id>");
    const item = await readKnowledge(root, id);
    return { data: item, text: () => item.content.trimEnd() };
  }
  if (action === "search") {
    const query = positionals.join(" ") || value(parsed, "query");
    const items = await searchKnowledge(root, query, { scope: value(parsed, "scope") });
    return {
      data: items,
      text: () =>
        items.length
          ? items
              .map((item) => `- ${item.id}: ${item.title} [${item.scope}]${item.snippet ? `\n  ${item.snippet}` : ""}`)
              .join("\n")
          : "No matching knowledge found."
    };
  }
  throw new Error("Usage: awb knowledge add|list|read|search");
}

async function memoryCommand(root, action, positionals, parsed, io) {
  if (action === "propose") {
    const proposal = await proposeMemory(root, {
      id: value(parsed, "id"),
      kind: value(parsed, "kind"),
      title: value(parsed, "title"),
      scope: value(parsed, "scope"),
      text: await textInput(root, parsed, io),
      taskId: value(parsed, "task"),
      tags: values(parsed, "tag"),
      sourceProvider: value(parsed, "source-provider"),
      sourceRef: value(parsed, "source-ref"),
      sourceTool: value(parsed, "source-tool")
    });
    return {
      data: proposal,
      text: () => `Memory proposal created: ${proposal.id}\nStatus: ${proposal.status}\nScope: ${proposal.scope}`
    };
  }
  if (action === "list") {
    const proposals = await listProposals(root, { status: value(parsed, "status") });
    return {
      data: proposals,
      text: () =>
        proposals.length
          ? proposals.map((item) => `- ${item.id} [${item.status}] ${item.title} · ${item.scope}`).join("\n")
          : "No memory proposals found."
    };
  }
  if (action === "approve") {
    const id = positionals[0];
    if (!id) throw new Error("Usage: awb memory approve <proposal-id>");
    const approved = await approveMemory(root, id, { knowledgeId: value(parsed, "knowledge-id") });
    return {
      data: approved,
      text: () => `Proposal approved: ${approved.proposal.id}\nKnowledge created: ${approved.knowledge.id}`
    };
  }
  if (action === "reject") {
    const id = positionals[0];
    if (!id) throw new Error("Usage: awb memory reject <proposal-id>");
    const proposal = await rejectMemory(root, id, { reason: value(parsed, "reason") });
    return { data: proposal, text: () => `Proposal rejected: ${proposal.id}` };
  }
  throw new Error("Usage: awb memory propose|list|approve|reject");
}

async function providerCommand(root, action, positionals, parsed, io) {
  if (action === "add") {
    const id = positionals[0];
    const provider = await addKnowledgeProvider(root, {
      id,
      name: value(parsed, "name"),
      type: value(parsed, "type"),
      knowledgeUrl: value(parsed, "knowledge-url"),
      coreUrl: value(parsed, "core-url"),
      serviceId: value(parsed, "service-id"),
      authEnv: value(parsed, "auth-env"),
      knowledgeAuthEnv: value(parsed, "knowledge-auth-env"),
      coreAuthEnv: value(parsed, "core-auth-env"),
      timeoutMs: value(parsed, "timeout-ms")
    });
    return {
      data: provider,
      text: () => `Knowledge provider added: ${provider.id}\nType: ${provider.type}\nKnowledge URL: ${provider.endpoints.knowledge}`
    };
  }
  if (action === "list") {
    const providers = await getKnowledgeProviders(root);
    return {
      data: providers,
      text: () => providers.length
        ? providers.map((provider) => `- ${provider.id} [${provider.enabled === false ? "disabled" : "enabled"}] ${provider.type} · ${(provider.bindings ?? []).length} bindings`).join("\n")
        : "No knowledge providers registered."
    };
  }
  if (action === "bind") {
    const providerId = positionals[0];
    const result = await bindKnowledgeProvider(root, providerId, {
      projectId: value(parsed, "project"),
      knowledgeId: value(parsed, "knowledge-id"),
      description: value(parsed, "description")
    });
    return {
      data: result,
      text: () => `Provider resource bound: ${result.providerId}\nProject: ${result.binding.projectId}\nKnowledge: ${result.binding.knowledgeId}`
    };
  }
  if (action === "enable" || action === "disable") {
    const providerId = positionals[0];
    const provider = await setKnowledgeProviderEnabled(root, providerId, action === "enable");
    return { data: provider, text: () => `Knowledge provider ${action}d: ${provider.id}` };
  }
  if (action === "status") {
    const provider = await getKnowledgeProvider(root, positionals[0]);
    const status = await probeProvider(provider);
    return {
      data: status,
      exitCode: status.ok ? 0 : 2,
      text: () => [
        `Provider: ${provider.id}`,
        `Healthy: ${status.ok}`,
        ...status.checks.map((check) => `- ${check.service}: ${check.ok ? `ok (${check.latencyMs} ms)` : check.error}`)
      ].join("\n")
    };
  }
  if (action === "tools") {
    const provider = await getKnowledgeProvider(root, positionals[0]);
    const result = await listProviderTools(provider, value(parsed, "knowledge-id"));
    return {
      data: result,
      text: () => (result?.tools ?? []).map((tool) => `- ${tool.name}: ${tool.description}`).join("\n") || "No tools returned."
    };
  }
  if (action === "call") {
    const [providerId, toolName] = positionals;
    const provider = await getKnowledgeProvider(root, providerId);
    const params = parseJsonObject(value(parsed, "params") || "{}");
    const result = await callProviderTool(provider, value(parsed, "knowledge-id"), toolName, params);
    return { data: result, text: () => JSON.stringify(result, null, 2) };
  }
  if (action === "search") {
    const [providerId, ...queryParts] = positionals;
    const provider = await getKnowledgeProvider(root, providerId);
    const query = queryParts.join(" ") || value(parsed, "query");
    const result = await searchProvider(provider, value(parsed, "knowledge-id"), query, {
      limit: value(parsed, "limit")
    });
    return { data: result, text: () => JSON.stringify(result, null, 2) };
  }
  if (action === "recall") {
    const query = positionals.join(" ") || value(parsed, "query");
    const rawProjectId = value(parsed, "project");
    if (!rawProjectId) throw new Error("Usage: awb provider recall <query> --project <project-id>");
    const projectId = normalizeId(rawProjectId, "Project ID");
    if (!(await getProjects(root)).some((project) => project.id === projectId)) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    const providerFilter = value(parsed, "provider");
    if (providerFilter) await getKnowledgeProvider(root, providerFilter);
    const providers = (await getKnowledgeProviders(root)).filter(
      (provider) => provider.enabled !== false && (!providerFilter || provider.id === providerFilter)
    );
    const targets = providers.flatMap((provider) =>
      (provider.bindings ?? [])
        .filter((binding) => binding.projectId === projectId)
        .map((binding) => ({ provider, binding }))
    );
    const results = await Promise.all(targets.map(async ({ provider, binding }) => {
      try {
        const data = await searchProvider(provider, binding.knowledgeId, query, { limit: value(parsed, "limit") });
        return { providerId: provider.id, projectId, knowledgeId: binding.knowledgeId, ok: true, data };
      } catch (error) {
        return { providerId: provider.id, projectId, knowledgeId: binding.knowledgeId, ok: false, error: error.message };
      }
    }));
    const failed = results.filter((item) => !item.ok);
    return {
      // A partial failure still means the caller did not receive everything it
      // asked for, so it is surfaced as a non-zero exit rather than buried.
      data: {
        query,
        projectId,
        resultCount: results.length,
        okCount: results.length - failed.length,
        failedCount: failed.length,
        results
      },
      exitCode: failed.length ? 2 : 0,
      text: () => {
        if (!results.length) return "No provider resources are bound to this project.";
        const body = JSON.stringify(results, null, 2);
        return failed.length
          ? `${body}\n${failed.length} of ${results.length} provider resources failed.`
          : body;
      }
    };
  }
  if (action === "memory-recall") {
    const [providerId, ...queryParts] = positionals;
    const provider = await getKnowledgeProvider(root, providerId);
    const result = await recallCoreMemory(provider, queryParts.join(" ") || value(parsed, "query"), {
      sessionKey: value(parsed, "session-key"),
      userId: value(parsed, "user-id")
    });
    return { data: result, text: () => JSON.stringify(result, null, 2) };
  }
  if (action === "propose") {
    const provider = await getKnowledgeProvider(root, positionals[0]);
    const proposal = await proposeMemory(root, {
      id: value(parsed, "id"),
      kind: value(parsed, "kind"),
      title: value(parsed, "title"),
      scope: value(parsed, "scope"),
      text: await textInput(root, parsed, io),
      taskId: value(parsed, "task"),
      tags: values(parsed, "tag"),
      sourceProvider: provider.id,
      sourceRef: value(parsed, "source-ref") || value(parsed, "knowledge-id"),
      sourceTool: value(parsed, "source-tool") || null
    });
    return {
      data: proposal,
      text: () => `Provider result proposed for review: ${proposal.id}\nSource: ${provider.id}/${proposal.sourceRef || "unspecified"}\nStatus: ${proposal.status}`
    };
  }
  throw new Error("Usage: awb provider add|list|bind|enable|disable|status|tools|call|search|recall|memory-recall|propose");
}

function parseJsonObject(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON in --params: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("--params must be a JSON object.");
  return parsed;
}

function parseArgs(argv) {
  const positionals = [];
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const equal = token.indexOf("=");
    const name = token.slice(2, equal >= 0 ? equal : undefined);
    let optionValue = true;
    if (equal >= 0) optionValue = token.slice(equal + 1);
    else if (!BOOLEAN_OPTIONS.has(name) && index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
      optionValue = argv[index + 1];
      index += 1;
    }
    const current = options.get(name) ?? [];
    current.push(optionValue);
    options.set(name, current);
  }
  return { positionals, options };
}

function has(parsed, key) {
  return parsed.options.has(key);
}

function values(parsed, key) {
  return (parsed.options.get(key) ?? []).filter((item) => item !== true).map(String);
}

function value(parsed, key) {
  const items = parsed.options.get(key) ?? [];
  const result = items.at(-1);
  return result === true || result === undefined ? undefined : String(result);
}

async function textInput(root, parsed, io) {
  const direct = value(parsed, "text");
  const file = value(parsed, "file");
  if (direct !== undefined && file !== undefined) throw new Error("Use only one of --text, --file, or --stdin.");
  if (has(parsed, "stdin") && (direct !== undefined || file !== undefined)) {
    throw new Error("Use only one of --text, --file, or --stdin.");
  }
  if (direct !== undefined) return direct;
  if (file !== undefined) {
    // Both sides are resolved through realpath so that a symlink inside the
    // workspace cannot be used to read a file outside it.
    const absolute = path.resolve(io.cwd, file);
    let resolvedFile;
    try {
      resolvedFile = await realpath(absolute);
    } catch {
      throw new Error(`Content file does not exist: ${file}`);
    }
    const resolvedRoot = await realpath(root);
    const relative = path.relative(resolvedRoot, resolvedFile);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Content files must be inside the Agent Workbench root.");
    }
    return readFile(resolvedFile, "utf8");
  }
  if (has(parsed, "stdin")) return readAllStdin();
  throw new Error("Content is required. Pass --text, --file, or --stdin.");
}

async function readAllStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function emitResult(io, data, json, textFactory) {
  emit(io, json ? JSON.stringify(data, null, 2) : textFactory());
}

// `--json` is a contract about the shape of everything this command writes, so
// failures are reported as JSON too rather than as a bare text line.
function emitError(io, error, json) {
  const text = json
    ? JSON.stringify({ error: { message: error.message } }, null, 2)
    : `Error: ${error.message}`;
  io.stderr(`${text}\n`);
}

function formatMigration(result) {
  const lines = [
    `Workspace migration complete: ${result.from} -> ${result.to}`,
    `Changed: ${result.changed}`,
    `Tasks updated: ${result.tasksUpdated}`,
    `Proposals updated: ${result.proposalsUpdated}`,
    `Catalog files installed: ${result.catalogFilesWritten}`
  ];
  const renames = { ...result.renamedTasks, ...result.renamedProposals };
  if (Object.keys(renames).length) {
    lines.push(
      "Identifiers canonicalized:",
      ...Object.entries(renames).map(([from, to]) => `- ${from} -> ${to}`)
    );
  }
  return lines.join("\n");
}

function emit(io, text) {
  io.stdout(String(text).endsWith("\n") ? String(text) : `${text}\n`);
}

function formatValidation(result) {
  const lines = [
    result.valid ? "Workspace is valid." : "Workspace is invalid.",
    `Name: ${result.workspace}`,
    `Format: ${result.formatVersion ?? "unknown"}`,
    `Counts: ${result.counts.projects} projects, ${result.counts.relationships} relationships, ${result.counts.knowledge} knowledge items, ${result.counts.artifacts} artifacts`
  ];
  if (result.errors.length) lines.push("Errors:", ...result.errors.map((item) => `- ${item}`));
  if (result.warnings.length) lines.push("Warnings:", ...result.warnings.map((item) => `- ${item}`));
  return lines.join("\n");
}

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
        (question.catalog
          ? `\n  Choose from ${question.catalog}: ${
              status.catalog[question.catalog].length
                ? status.catalog[question.catalog].join(", ")
                : "(none defined yet — run `awb migrate` to install the starter catalog)"
            }`
          : "")
    )
  ].join("\n");
}

function formatTaskContext(context) {
  const { task } = context;
  const lines = [
    `Task: ${task.id} — ${task.title}`,
    `Role: ${task.primaryRole}${(task.supportingRoles ?? []).length ? ` (+ ${task.supportingRoles.join(", ")})` : ""}`,
    `Primary project: ${task.primaryProject}`,
    `Audience: ${task.audience || "not specified"}`,
    `User profile: ${context.userProfile}`
  ];
  lines.push(
    "Project sources:",
    ...context.projects.map(
      (project) =>
        `- ${project.id} [${project.sourceMode || "managed"}] ${project.available ? project.resolvedPath : `unavailable: ${project.reason}`}`
    )
  );
  if ((task.browserTargets ?? []).length) lines.push("Browser targets:", ...task.browserTargets.map((item) => `- ${item}`));
  lines.push("Read scopes:", ...(task.readScopes ?? []).map((item) => `- ${item}`));
  lines.push("Write scopes:", ...(task.writeScopes ?? []).map((item) => `- ${item}`));
  if ((task.deliverables ?? []).length) lines.push("Deliverables:", ...task.deliverables.map((item) => `- ${item}`));
  if ((task.qualityGates ?? []).length) {
    lines.push("Quality gates:", ...task.qualityGates.map((item) => `- ${item.id}: ${item.status}`));
  }
  lines.push(`Secret policy: ${task.secretPolicy || "runtime-only"}`);
  if (context.roleFiles.length) lines.push("Role files:", ...context.roleFiles.map((item) => `- ${item}`));
  if (context.skillFiles.length) lines.push("Skill files:", ...context.skillFiles.map((item) => `- ${item}`));
  if (context.workflowFiles.length) lines.push("Workflow files:", ...context.workflowFiles.map((item) => `- ${item}`));
  if (context.relationships.length) {
    lines.push(
      "Relationships:",
      ...context.relationships.map((item) => `- ${item.from} --${item.type}--> ${item.to}`)
    );
  }
  if (context.relatedProjects.length) {
    lines.push(
      "Related projects outside task scope:",
      ...context.relatedProjects.map((project) => `- ${project.id}: ${project.resolvedPath || project.reason}`)
    );
  }
  if (context.knowledge.length) {
    lines.push(
      "Relevant knowledge references:",
      ...context.knowledge.map((item) => `- ${item.id}: ${item.title} [${item.scope}]`)
    );
  }
  if (!context.knowledge.length) lines.push("Relevant knowledge references: none");
  if (context.knowledgeTruncated) {
    lines.push(`Knowledge references truncated: showing ${context.knowledge.length} of ${context.knowledgeTotal}.`);
  }
  if (context.providerResources.length) {
    lines.push(
      "External knowledge resources (not loaded):",
      ...context.providerResources.map((item) => `- ${item.providerId}/${item.knowledgeId} -> project:${item.projectId} [${item.enabled ? "enabled" : "disabled"}]`)
    );
    lines.push("Use `awb provider recall <query> --project <id>` only when external recall is needed.");
  }
  lines.push("Full knowledge bodies were not loaded. Use `awb knowledge read <id>` when needed.");
  return lines.join("\n");
}

function formatTaskVerification(result) {
  const lines = [
    result.valid ? `Task is verified: ${result.taskId}` : `Task is not verified: ${result.taskId}`,
    `Artifacts: ${result.artifactCount}`
  ];
  if (result.missingDeliverables.length) lines.push("Missing deliverables:", ...result.missingDeliverables.map((item) => `- ${item}`));
  if (result.unverifiedArtifacts.length) lines.push("Unverified artifacts:", ...result.unverifiedArtifacts.map((item) => `- ${item}`));
  if (result.missingArtifacts.length) lines.push("Missing artifact files:", ...result.missingArtifacts.map((item) => `- ${item}`));
  if (result.pendingQualityGates.length) lines.push("Pending quality gates:", ...result.pendingQualityGates.map((item) => `- ${item}`));
  return lines.join("\n");
}

function helpFor(group) {
  const common = `Agent Workbench Core ${PACKAGE_VERSION}

Usage:
  awb [--root <path>] <command> [options]

Commands:
  init                         Create a workspace
  validate                     Validate workspace structure and references
  migrate                      Migrate a 0.2 workspace to 0.3
  project add|list|relations|resolve
                               Manage managed, submodule, and external sources
  relation add|list            Manage typed project relationships
  role|skill|workflow list|show
                               Inspect the capability catalog
  task create|list|context|gate-pass|verify|close
                               Manage multi-project task contracts
  artifact add|list            Register and verify task outputs
  knowledge add|list|read|search
                               Manage durable indexed knowledge
  memory propose|list|approve|reject
                               Manage the learning approval lifecycle
  provider add|list|bind|enable|disable|status|tools|call|search|recall|memory-recall|propose
                               Use optional external knowledge providers
  profile build|status|complete
                               Generate the HTML view; run onboarding
  version                      Print the CLI version

Global options:
  --root <path>                Workspace path or a child path
  --json                       Emit machine-readable JSON, errors included

Exit codes:
  0                            Success
  1                            Invalid usage or a failed operation
  2                            Command completed but reported a problem
                               (\`validate\` invalid, \`provider status\` unhealthy,
                               \`provider recall\` with a failed resource)
`;
  const details = {
    project: `Project commands:
  awb project add <id> --name <name> --path src/<path> [--mode managed|submodule] [--create]
  awb project add <id> --name <name> --external-path <absolute-path> [--repo <url>]
  awb project list
  awb project relations <id>
  awb project resolve <id>`,
    relation: `Relationship commands:
  awb relation add <from> <type> <to> [--description <text>] [--contract <path>]
  awb relation list`,
    role: `Role commands:
  awb role list
  awb role show <role-id>`,
    skill: `Skill commands:
  awb skill list
  awb skill show <skill-id>`,
    workflow: `Workflow commands:
  awb workflow list
  awb workflow show <workflow-id>`,
    task: `Task commands:
  awb task create --title <text> --role <id> --project <id> [--project <id>]
                  [--primary <id>] [--audience <text>] [--browser <url>]
                  [--read project:<id>] [--write project:<id>]
                  [--deliverable <id>] [--quality-gate <id>]
                  [--skip-onboarding]
  awb task list [--status active]
  awb task context <task-id>
  awb task gate-pass <task-id> <gate-id> [--note <text>]
  awb task verify <task-id>
  awb task close <task-id> [--force]`,
    artifact: `Artifact commands:
  awb artifact add <task-id> --project <id> --path <project-relative-path>
                   --kind <deliverable-id> [--verified]
  awb artifact list [--task <task-id>]`,
    knowledge: `Knowledge commands:
  awb knowledge add <id> --scope user|role:<id>|project:<id>|task:<id>
                         --title <text> --text <content> [--tag <tag>]
  awb knowledge list [--scope <scope>]
  awb knowledge read <id>
  awb knowledge search <query> [--scope <scope>]`,
    memory: `Memory commands:
  awb memory propose --scope <scope> --title <text> --text <content> [--task <id>]
  awb memory list [--status candidate]
  awb memory approve <proposal-id> [--knowledge-id <id>]
  awb memory reject <proposal-id> [--reason <text>]`,
    provider: `Provider commands:
  awb provider add <id> [--type tencentdb-agent-memory]
                   [--knowledge-url http://127.0.0.1:8424/v3]
                   [--core-url http://127.0.0.1:8420]
                   [--service-id default]
                   [--knowledge-auth-env ENV_NAME] [--core-auth-env ENV_NAME]
  awb provider list
  awb provider bind <id> --project <project-id> --knowledge-id <resource-id>
  awb provider enable|disable <id>
  awb provider status <id>
  awb provider tools <id> --knowledge-id <resource-id>
  awb provider call <id> <tool> --knowledge-id <resource-id> --params <json>
  awb provider search <id> <query> --knowledge-id <resource-id> [--limit 10]
  awb provider recall <query> --project <project-id> [--provider <id>] [--limit 10]
  awb provider memory-recall <id> <query> --session-key <key> [--user-id <id>]
  awb provider propose <id> --scope <scope> --title <text> --text <content>
                       [--source-ref <resource-ref>] [--source-tool <tool>]`,
    profile: `Profile commands:
  awb profile status
  awb profile complete --name <text> --role <role-id> --language <text>
                       --responsibility <text> [--responsibility <text>]
                       [--system <text>] [--skill <skill-id>]
                       [--principle <text>] [--constraint <text>] [--replace]
  awb profile build`
  };
  return group && details[group] ? `${common}\n${details[group]}\n` : common;
}

function defaultIo() {
  return {
    cwd: process.cwd(),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text)
  };
}
