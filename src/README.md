# User sources

This directory is reserved for sources managed by the user. Core implementation
code belongs in `core/`, never here.

Supported source modes:

1. `managed`: a normal folder tracked by the Agent Workbench Git repository.
2. `submodule`: a Git submodule that keeps its own repository history.
3. `external`: a portable `.source.json` descriptor plus a machine-local path
   beneath `src/.external/`. Local path files are ignored by Git.

Examples:

```text
src/hvh-user-guides/                 managed
src/HVH_FRONTEND_REACT/              submodule
src/legacy-system.source.json        external descriptor
src/.external/legacy-system.local.json
```
