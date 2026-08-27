# User sources

This directory is reserved for sources managed by the user. Core implementation
code belongs in `core/`, never here.

Nothing under `src/` is committed to the Agent Workbench repository except
this file and the portable `*.source.json` descriptors. See `.gitignore`.

Supported source modes:

1. `managed`: a working folder under `src/`. **No repository versions it** --
   not this one, and not its own. Use it only for scratch work you can afford
   to lose.
2. `submodule`: a Git submodule that keeps its own repository history. Use this
   when the work needs history and lives with the Workbench.
3. `external`: a portable `.source.json` descriptor here, plus a machine-local
   path stored under `src/.external/`. The code lives in its own repository
   somewhere else on the machine. Use this for existing projects.

Examples:

```text
src/scratch-notes/                   managed -- not versioned anywhere
src/HVH_FRONTEND_REACT/              submodule -- own history
src/legacy-system.source.json        external descriptor -- committed
src/.external/legacy-system.local.json   machine-local path -- ignored
```
