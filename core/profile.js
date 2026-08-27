import { readFile } from "node:fs/promises";
import path from "node:path";
import { PROFILE_STYLES } from "./profile-styles.js";
import {
  PACKAGE_VERSION,
  exists,
  getKnowledgeItems,
  getKnowledgeProviders,
  getProjects,
  getRelationships,
  getWorkspace,
  listArtifacts,
  listDirectDirectories,
  listProposals,
  listTasks,
  nowIso,
  writeText
} from "./core.js";

export async function buildProfile(root) {
  const [workspace, projects, relationships, tasks, knowledge, providers, artifacts, proposals, roles, skills, workflows] =
    await Promise.all([
      getWorkspace(root),
      getProjects(root),
      getRelationships(root),
      listTasks(root),
      getKnowledgeItems(root),
      getKnowledgeProviders(root),
      listArtifacts(root),
      listProposals(root),
      listDirectDirectories(root, "roles"),
      listDirectDirectories(root, "skills"),
      listDirectDirectories(root, "workflows")
    ]);
  const profilePath = path.join(root, "user", "PROFILE.md");
  const profileMarkdown = (await exists(profilePath)) ? await readFile(profilePath, "utf8") : "# User Profile";
  const activeTasks = tasks.filter((task) => task.status === "active");
  const candidateProposals = proposals.filter((proposal) => proposal.status === "candidate");
  const generatedAt = nowIso();

  const projectCards = projects.length
    ? projects
        .map((project) => {
          const projectTasks = activeTasks.filter((task) => task.projects.includes(project.id)).length;
          const projectKnowledge = knowledge.filter((item) => item.scope === `project:${project.id}`).length;
          return `<article class="card project-card">
            <div class="card-head">
              <div>
                <p class="eyebrow">Project</p>
                <h3>${escapeHtml(project.name)}</h3>
              </div>
              <span class="pill">${escapeHtml(project.sourceMode || "managed")}</span>
            </div>
            <p class="muted">${escapeHtml(project.description || "No description yet.")}</p>
            <code class="path">${escapeHtml(project.path)}</code>
            <div class="tag-row">${(project.tags ?? []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
            <div class="mini-stats">
              <span><strong>${projectTasks}</strong> active tasks</span>
              <span><strong>${projectKnowledge}</strong> knowledge items</span>
            </div>
          </article>`;
        })
        .join("\n")
    : emptyState("No projects registered", "Use awb project add to register a source under src/.");

  const relationshipRows = relationships.length
    ? relationships
        .map(
          (item) => `<div class="relation-row">
            <span class="node">${escapeHtml(item.from)}</span>
            <span class="relation-arrow"><span>${escapeHtml(item.type)}</span> →</span>
            <span class="node">${escapeHtml(item.to)}</span>
            ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
          </div>`
        )
        .join("\n")
    : emptyState("No relationships registered", "Relationships make cross-project impact visible.");

  const taskRows = activeTasks.length
    ? activeTasks
        .map(
          (task) => `<article class="task">
            <div>
              <p class="eyebrow">${escapeHtml(task.id)}</p>
              <h3>${escapeHtml(task.title)}</h3>
              <p class="muted">${escapeHtml(task.objective || "No objective recorded.")}</p>
              ${task.audience ? `<p class="eyebrow">Audience · ${escapeHtml(task.audience)}</p>` : ""}
            </div>
            <div class="task-meta">
              <span class="pill accent">${escapeHtml(task.primaryRole)}</span>
              ${task.projects.map((project) => `<span class="pill">${escapeHtml(project)}</span>`).join("")}
            </div>
          </article>`
        )
        .join("\n")
    : emptyState("No active tasks", "Tasks connect a role to one or more projects.");

  const providerCards = providers.length
    ? providers.map((provider) => `<article class="card">
        <div class="card-head">
          <div><p class="eyebrow">Knowledge provider</p><h3>${escapeHtml(provider.name)}</h3></div>
          <span class="pill ${provider.enabled === false ? "" : "accent"}">${provider.enabled === false ? "disabled" : "enabled"}</span>
        </div>
        <p class="muted">${escapeHtml(provider.type)}</p>
        <code class="path">${escapeHtml(provider.endpoints?.knowledge || "No endpoint")}</code>
        <div class="mini-stats">
          <span><strong>${(provider.bindings ?? []).length}</strong> project bindings</span>
          <span><strong>${escapeHtml(provider.serviceId || "default")}</strong> service</span>
        </div>
      </article>`).join("\n")
    : emptyState("No external providers", "Git-backed Workbench knowledge remains the canonical default.");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="Agent Workbench Core ${escapeHtml(PACKAGE_VERSION)}">
  <title>${escapeHtml(workspace.name)} · Agent Workbench</title>
  <style>${PROFILE_STYLES}  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div>
        <div class="brand">Agent Workbench</div>
        <h1>${escapeHtml(workspace.name)}</h1>
        <p class="lede">${escapeHtml(workspace.description || "A persistent working point of view shared across projects and agent harnesses.")}</p>
      </div>
      <div class="hero-stats">
        <div class="stat"><strong>${projects.length}</strong><span>Projects</span></div>
        <div class="stat"><strong>${activeTasks.length}</strong><span>Active tasks</span></div>
        <div class="stat"><strong>${artifacts.length}</strong><span>Artifacts</span></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>User profile</h2>
        <p>The stable working identity represented by this workspace.</p>
      </div>
      <div class="profile-layout">
        <article class="profile-copy">${markdownToHtml(profileMarkdown)}</article>
        <aside class="capabilities">
          ${capability("Roles", roles)}
          ${capability("Skills", skills)}
          ${capability("Workflows", workflows)}
          <div class="capability"><strong>${candidateProposals.length}</strong><span>Learning proposals awaiting review</span></div>
        </aside>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>Projects</h2>
        <p>Every registered codebase, documentation source, or operational asset under src/.</p>
      </div>
      <div class="grid">${projectCards}</div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>Relationships</h2>
        <p>Typed, explicit links make cross-project impact visible without loading unrelated knowledge.</p>
      </div>
      <div class="relations">${relationshipRows}</div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>Knowledge providers</h2>
        <p>Optional read-only recall sources. Imported lessons still require approval before entering canonical knowledge.</p>
      </div>
      <div class="grid">${providerCards}</div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>Active work</h2>
        <p>Roles and projects are scoped per task, so several initiatives can run at the same time.</p>
      </div>
      <div class="tasks">${taskRows}</div>
    </section>

    <footer>
      <span>Generated from canonical Agent Workbench data.</span>
      <span>${escapeHtml(generatedAt)}</span>
    </footer>
  </main>
</body>
</html>`;

  await writeText(root, "profile/index.html", html);
  return {
    path: "profile/index.html",
    generatedAt,
    counts: {
      projects: projects.length,
      relationships: relationships.length,
      activeTasks: activeTasks.length,
      knowledge: knowledge.length,
      artifacts: artifacts.length,
      candidateProposals: candidateProposals.length,
      roles: roles.length,
      skills: skills.length,
      workflows: workflows.length,
      providers: providers.length
    }
  };
}

function capability(label, values) {
  const preview = values.slice(0, 4).join(", ");
  return `<div class="capability"><strong>${values.length}</strong><span>${escapeHtml(label)}${preview ? ` · ${escapeHtml(preview)}` : ""}</span></div>`;
}

function emptyState(title, message) {
  return `<div class="empty"><strong>${escapeHtml(title)}</strong>${escapeHtml(message)}</div>`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function markdownToHtml(markdown) {
  const lines = String(markdown ?? "").replaceAll("\r\n", "\n").split("\n");
  const output = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      output.push("</ul>");
      inList = false;
    }
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      if (!inList) {
        output.push("<ul>");
        inList = true;
      }
      output.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
      continue;
    }
    closeList();
    output.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  closeList();
  return output.join("\n");
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}
