# Changelog

## 0.3.1 — 2026-08-26

### Fixed

- Path traversal: separators are folded before normalization, so a
  backslash-separated `..` segment can no longer slip past the check on POSIX
  and register an artifact outside the project source root, bypassing task
  write scopes. Every join site re-verifies containment.
- Absolute paths are rejected under both platform conventions, so `C:\...` on
  POSIX and `/x` on Windows are refused everywhere.
- `schemas/artifact.schema.json` was not valid JSON: an invalid `\.` escape
  went unnoticed because nothing loaded the schemas.
- Task and memory-proposal IDs are folded to uppercase rather than merely
  accepted in either casing, so a workspace behaves the same on case-sensitive
  and case-insensitive filesystems.
- `validateScope` returns the canonical scope string, so a stored `task:<id>`
  scope matches the one `awb task context` derives.
- `awb artifact list --task <id>` accepts any casing of the task ID.
- Quality gates can no longer be passed on a closed task, matching the rule
  `awb artifact add` already enforced.
- Provider registry writes pass the provider array explicitly instead of
  relying on in-place mutation of the spread source.
- `awb <group> <action> --help` shows the group's help instead of the generic
  help.
- A test asserted against raw JSON text and therefore failed on Windows, where
  paths are backslash-escaped in the serialized descriptor.
- `awb knowledge list --scope` and `awb knowledge search --scope` compared the
  raw argument against stored scopes, which are canonicalized on write. Saving
  with `--scope task:my-task` and then filtering by the same string returned
  nothing. Filters now canonicalize identically, and name an unknown project or
  task instead of quietly matching none.
- `awb --version` printed the help text: the flag is parsed as an option, which
  leaves no positionals, and an empty command line defaults to help. All three
  spellings (`version`, `--version`, `-v`) now report the version.
- `awb project relations` and `awb provider recall` normalize the project ID
  before looking it up, so a wrongly cased argument reports the rule it broke
  rather than `Unknown project`.

### Changed

- Unknown options are rejected per command. A typo such as `--titl` previously
  consumed the following token as its value and silently left the intended
  option at its default.
- `--json` now applies to failures: errors are emitted as
  `{"error": {"message": ...}}` on stderr instead of a bare text line.
- Exit code 2 means "the command ran and reports a problem", now covering
  `provider status` on an unhealthy provider and `provider recall` when a bound
  resource fails; `provider recall` also reports `okCount` and `failedCount`.
- A provider that declares a credential environment variable and finds it unset
  fails before the request is issued instead of sending an unauthenticated one.
- The 2 MiB provider response cap is enforced while reading. A chunked or
  mislabelled body is abandoned at the limit rather than buffered in full.
- `awb migrate` backfills `secretPolicy` on tasks and `sourceMode` on projects,
  canonicalizes task and proposal identifiers, and repoints artifacts,
  knowledge scopes, and proposal sources at the renamed records. It stops and
  names both files if two differ only by case. It remains idempotent.
- `awb validate` checks records against the contracts in `schemas/` in addition
  to its own rules, so those files are enforced rather than documentation that
  drifts.
- Generated IDs carry 40 random bits instead of 16; a 16-bit suffix collided at
  roughly 300 IDs generated within one second.
- The profile stylesheet moved to `core/profile-styles.js`, and the generator
  metadata is derived from `PACKAGE_VERSION` instead of a hardcoded string.

### Added

- Regression coverage for project-path escapes, task ID casing, unknown
  options, JSON error output, exit codes, identifier migration, schema
  enforcement, credential fail-fast, and the streaming response cap.
- `core/schema.js`, a small JSON Schema checker covering the keywords used by
  `schemas/*.json`. Its `not` keyword is evaluated after the type check, so a
  value of the wrong type is not also reported as violating a string-only
  constraint.
- Documented exit codes in `awb help`, and a concurrency section in
  `docs/CORE_SPEC.md` stating that Core does not lock and its commands must be
  run one at a time.

## 0.3.0 — 2026-08-25

- Added `knowledge/providers.json` as the optional provider registry.
- Added project-to-provider-resource bindings and compact task context refs.
- Added direct read-only TencentDB MemoryKnowledge tool discovery, calls,
  search, and project-bound recall.
- Added explicit MemoryCore recall without automatic conversation capture.
- Added separate runtime-only credential variables for MemoryKnowledge and
  MemoryCore.
- Added provider timeouts, response-size limits, URL credential rejection, and
  disable/enable controls.
- Added provider result provenance to memory proposals; approval remains
  required before canonical knowledge is written.
- Added an explicit, idempotent migration from format 0.2 to 0.3.
- Added provider visibility to the static HTML profile.
- Expanded the automated test suite for provider contracts and migration.

## 0.2.0

- Established the single-root, Git-native workspace model.
- Added managed, submodule, and external source modes.
- Added multi-project task contracts, relationships, scoped artifacts, quality
  gates, approved knowledge, memory proposals, and the generated HTML profile.
