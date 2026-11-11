# Changelog

All notable changes to `skillapt` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-11

### Security
- **Path Traversal Hardening**: Enforced boundary checks via `assertInside` across extraction, sync, and removal paths. Blocked `..` as a path segment in manifests, lockfiles, and tarballs.
- **Token Safety & Origin Binding**: Registry authentication tokens are origin-bound; tokens are never sent to third-party endpoints or on anonymous requests. Added `--token-stdin` for `login` to prevent token leakage in shell history.
- **Install-time Content Verification**: Extracted trees are validated for file extensions, banned binaries/archives, ELF/Mach-O/PE/Java magic bytes, path lengths, and Unicode NFC duplicate collisions before installation.
- **Atomic Directory Swap**: Skills are extracted into a temporary directory and swapped atomically to protect existing installations on failure.
- **Permission Prompts**: Interactive prompt (or `--yes` flag) required when installing skills declaring `shell: true` or `network: true`.

### Added
- **Antigravity & Antigravity CLI Targets**: Added native target support for `antigravity` (`.agents/skills`, global `~/.gemini/config/skills`) and `antigravity-cli` (`.agents/skills`, global `~/.gemini/antigravity-cli/skills`) with automatic legacy detection for `.agent/skills` and `~/.gemini/antigravity/skills`.
- **Flat Layout for Scoped Packages**: Scoped packages (`@scope/name`) map to flat on-disk directories (`scope--name`) in `.skills/` and agent target directories, rewriting installed `SKILL.md` frontmatter.
- **Dependency Resolver**: Full multi-requirement reconciliation resolving common version dependencies, excluding removed versions, normalizing range `"latest"` to `"*"`, and enforcing maximum depth of 10.
- **Lockfile Version 2**: Added `lockfileVersion: 2` with explicit `source`, `sha256`, and GitHub commit `sha` fields.
- **Reproducible Tarballs**: Tarball creation sorts entries and normalizes modification timestamps (`mtime`) for deterministic SHA-256 archives.
- **YAML Frontmatter Parser**: Integrated `yaml` package supporting multiline folded (`>`) and literal (`|`) block scalars in `SKILL.md`.
- **CI Workflow**: Added GitHub Actions workflow testing on Node.js 20 and 22 with `pretest` build hook.

### Changed
- Removed deprecated `@types/tar` and legacy `skillpm` aliases.
- Installer script (`install.sh`) now verifies Node.js and npm presence, handles global `EACCES` gracefully, and verifies CLI installation before reporting success.
- End-to-end tests use mock GitHub fixtures to prevent rate-limiting and live network dependencies, with an opt-in live test behind `LIVE_GITHUB_TEST=1`.
