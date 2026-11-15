# Changelog

All notable changes to `skillapt` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Minimum supported Node.js is now 22.12.0 (Node 20 is end-of-life and `commander` 15, `vitest` 5 and `tsup` 9 require it). CI now runs on Node 22 and 24.

### Security
- `skillapt remove` no longer deletes arbitrary paths listed in a lockfile's `syncedTargets`; only `<known agent target dir>/<skill>` is removed.
- Gzip decompression is capped before tar parsing (decompression-bomb protection) and extraction never applies archive-supplied ownership.
- Windows browser launch no longer goes through `cmd.exe` (URL `&` injection); existing config files are chmod `0600` before the token is written.
- Registry client: https-only manual redirects (max 5, token dropped on origin change), response size caps, timers always cleared, zod validation of responses.
- GitHub requests time out, path segments are URL-encoded and tarball downloads require a commit SHA.
- Dependency names from registry metadata are validated before use in URLs/paths.

### Added
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue and pull request templates, and a tag-triggered npm release workflow with provenance.
- `npm audit` for production dependencies in CI.

### Changed
- No default registry: the CLI has no built-in registry URL until one is deployed. Configure `SKILLAPT_REGISTRY` (or `skillapt login`); `doctor` and GitHub installs work without one.
- README rewritten; `SECURITY.md` now uses GitHub private advisories (the previous mailbox domain does not exist). Single `CODEOWNERS` in `.github/`.

### Fixed
- Intermittent test failures caused by `npm pack` re-running `prepare` and deleting `dist/` while e2e tests were executing the CLI.
- CI pack smoke test now installs the packed tarball into a clean project and runs the installed binary.

## [1.0.0] - 2026-11-15

### Security
- **Path Traversal Invariant (S1)**: Enforced strict boundary checks via `assertInside(baseDir, candidate)` across all install, update, rename, extraction, and removal code paths.
- **Archive Limits (S2)**: Stream tarball parser enforces size (5 MB compressed, 25 MB uncompressed), entry count (<= 500 files), depth (<= 10), and path length (<= 255 chars) limits, rejecting symlinks, hardlinks, and devices.
- **Checksum Verification (S3)**: Registry downloads verified against metadata SHA-256 and lockfile on reinstall; mismatches abort and leave no files behind.
- **Atomic Directory Swap (S4)**: Extraction unpacked to isolated temp directories and swapped atomically; failed installations never corrupt working previous installations.
- **Token Safety (S5)**: Tokens stored as origin-bound `{ origin, token }` with 0600 file permissions; tokens never sent cross-origin, never sent over plain HTTP (except localhost), never on anonymous endpoints, and `--token-stdin` provided to prevent shell history leakage.
- **Shell Injection Immunity (S6)**: Replaced string shell execution with `execFile`/`spawn` argument arrays; browser opening strictly validates `https:` protocol.
- **Zero Script Execution (S7)**: Zero lifecycle hooks executed during installation; skills with `scripts/` or `permissions` requiring `network: true` or `shell: true` require explicit interactive confirmation or `--yes`.
- **Content Rules & Magic Bytes (S8)**: Hard errors on registry installs and warnings on GitHub installs for disallowed extensions, hidden files, and binary executables (ELF, PE MZ, Mach-O, Java class `0xCAFEBABE`, WebAssembly `\0asm`).

### Added
- **Unified Agent Targets**: Added unified agent target synchronization table supporting `claude`, `cursor`, `codex`, `antigravity`, and `antigravity-cli`, with legacy detection notice for `.agent/skills` and `~/.gemini/antigravity/skills`, and `SKILLAPT_<TARGET>_DIR` environment overrides.
- **Flat Scoped Package Layout**: Package names `@scope/name` map to flat `scope--name` on-disk directories without double hyphens (D-003).
- **Frontmatter Invariant (D-004)**: Required `SKILL.md` frontmatter `name` to equal on-disk folder name without file rewriting, keeping cryptographic hashes valid.
- **Dependency Resolver & Lockfile V2**: Full multi-requirement diamond resolution, cycle detection, depth limit 10, child dependency re-resolution after common version swap, and orphaned dependency pruning on `remove`.
- **Reproducible Tarballs**: Deterministic archive creation sorting files alphabetically and normalizing `mtime` timestamps for identical SHA-256 output.
- **YAML Frontmatter Parser**: Robust block scalar parsing (`>` and `|`) for multi-line description fields.
- **Security Regression Suite**: Added comprehensive security regression tests (`tests/security/a01` through `a12`).
- **CI & Dependabot**: Added GitHub Actions workflow testing on Node 20 and 22 with pack-and-install smoke test, plus weekly Dependabot configuration.

## [0.1.0] - 2026-11-11

### Added
- Initial release of `skillapt` AI agent skill manager CLI.
- Registry client, manifest (`skills.json`), and lockfile support.
- GitHub repository skill installation.
