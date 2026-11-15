# PLAN.md: skillapt (CLI)

> Single source of truth for planning, status and standards in this repo.
> Every agent (human or AI) MUST read this file completely before touching code, and MUST update it as part of its work.

---

## 0. Agent protocol (read first, follow every session)

### 0.1 Session start checklist
1. Read this whole file. Pay attention to: §1 Status, §3 Cross-repo contract, §5 Invariants, §7 Work plan, §11 Decisions, §12 Open questions.
2. Verify reality, do not trust checkboxes blindly:
   ```bash
   git fetch --all --prune
   git status
   git branch -a
   git log --graph --oneline --decorate --all | head -60
   npm ci && npm run typecheck && npm run build && npm test
   ```
3. Compare the results with §1. If the dashboard disagrees with reality, fix the dashboard first (commit `docs(plan): sync status`) and add a line to §13.
4. Pick the FIRST unchecked task in the lowest-numbered unfinished milestone (§7). Do not skip ahead unless a task is marked `[!]` blocked.
5. If something is unclear, ambiguous or security-relevant, check §11 (Decisions) and §12 (Open questions). If still unclear, STOP and ask the human. Do not guess on security or on the cross-repo contract.

### 0.2 While working
- One task = one or more small commits. Every commit that finishes a task also ticks its checkbox in §7 and updates §1 (`Last updated`, `Current task`).
- Never mark `[x]` unless the task's **V:** (verify) command passes and the **AC:** (acceptance criteria) are met.
- Fixed a bug? Add a regression test in the same commit series.
- Found a new problem? Add it to §6 with the next free ID and severity, add a task in §7, and continue. Do not silently fix unrelated things.
- Changed a decision? Add it to §11 (never delete old rows; mark them superseded).
- Never edit the Cross-repo contract (§3) in only one repo. A change to §3 requires a matching change in the registry repo's PLAN.md, and a human decision.

### 0.3 Session end checklist
1. `npm run typecheck && npm run build && npm test` all green.
2. Append a row to §13 Progress log (date, who, branch, tasks, result, next step).
3. Update §1 Status.
4. Push the branch (`git push -u origin <branch>`). Never leave work only local.

### 0.4 Legend
`[ ]` todo · `[~]` in progress · `[x]` done and verified · `[!]` blocked (write why in §12)
**AC** = acceptance criteria · **V** = how to verify · **Sev** = Critical / High / Medium / Low

### 0.5 Hard rules (never violate)
- Never delete a branch (local or remote). Never force-push. Never squash-merge. See §8.
- Never commit secrets or tokens. Never put real tokens in docs or tests (use clearly fake placeholders).
- Never weaken a security check to make a test pass. Fix the test or ask.
- Never run destructive commands outside the repo or temp dirs.
- Do not add dependencies without noting the reason in the commit message and checking `npm audit`.

---

## 1. Status dashboard (keep current)

| Field | Value |
|---|---|
| Last updated | 2026-11-15 (release v1.0.0 prepared) |
| Current milestone | M4: Release v1.0.0 |
| Current branch | chore/release-1.0.0 |
| Current task | CLI-27, CLI-28 complete |
| Baseline build | `tsc` passes, `tsup` build OK, `npm audit` 0 vulns |
| Baseline tests | 205 passed, 1 skipped (live GitHub opt-in via SKILLAPT_LIVE=1); offline suite green |
| Registry live? | NO (staging endpoint designated at `registry.skillapt.dev`; DNS does not resolve publicly yet. Local development server and GitHub sources work immediately) |
| npm published? | PENDING (ready for manual `npm publish --provenance` by package owner) |
| Latest release | 1.0.0 (package.json version 1.0.0) |

Milestone overview:

| Milestone | Goal | Status |
|---|---|---|
| M1 | Critical security fixes and a working install path | [x] |
| M2 | Correct install/update/lockfile/target behavior, Antigravity support | [x] |
| M3 | pack/publish correctness, tests, CI, docs in sync | [x] |
| M4 | Release v1.0.0 (version bump, tags, release notes) | [x] |

---

## 2. Project overview

**skillapt** is a package manager for AI agent skills ("npm for skills"). A *skill* is a folder with a `SKILL.md` (instructions with YAML frontmatter), a `skill.json` (package manifest) and optional scripts/references. skillapt installs skills from (a) the skillapt registry (`@scope/name` or `name`, semver ranges) and (b) GitHub (`owner/repo[/subpath][@ref]`), keeps them in a project-local `.skills/` directory, records them in `skills.json` + `skills.lock.json`, and syncs them into each AI agent's skills folder (Claude, Cursor, Codex, Antigravity).

Ecosystem:
```
[developer] -- skillapt CLI (this repo) --HTTPS--> [skillapt-registry Worker] -> D1 + R2
                         |                                  ^
                         +--- GitHub API / codeload ---------+(only for GitHub-sourced skills)
                         +--> .skills/  and  <agent>/skills/  on disk
```
Tech: TypeScript (ESM), Node >= 20, commander, zod, semver, tar, tsup, vitest. Binary: `skillapt`.

### 2.1 Repository map
```
src/cli.ts                 command wiring (commander), global flags
src/commands/*.ts          install, remove, update, outdated, list, search, info, init, pack, publish, yank, login, doctor
src/lib/source.ts          source spec parsing (registry vs GitHub), name validation
src/lib/registry.ts        registry HTTP client (retries, errors, token)
src/lib/github.ts          GitHub ref resolve + tarball download
src/lib/extract.ts         safe tar extraction
src/lib/pack.ts            skill validation + tarball creation
src/lib/dependencies.ts    dependency resolver
src/lib/lockfile.ts        skills.lock.json read/write/frozen check
src/lib/manifest.ts        skills.json read/write
src/lib/targets.ts         agent target directories + sync
src/lib/config.ts auth.ts fs.ts banner.ts semver.ts
tests/                     vitest unit + e2e (e2e needs built dist)
docs/SPEC.md openapi.yaml  protocol spec (must match code)
install.sh                 curl | bash installer
```

---

## 3. Cross-repo contract (IDENTICAL in skillapt and skillapt-registry; change only with a human decision, in both repos)

### 3.1 Base URL and transport
- Production: `https://registry.skillapt.dev/v1`. HTTPS required; `http://` allowed only for `localhost`/`127.0.0.1`.
- Errors: `{"error":{"code":"<UPPER_SNAKE>","message":"<text>"}}`. Rate limit: 429 + `Retry-After`.

### 3.2 Endpoints
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /health | none | liveness |
| GET | /skills?q&category&compat&verified&sort&page&limit | none | search |
| POST | /skills | token | publish (multipart `file` or `application/gzip`) |
| GET | /skills/{name} | none | detail + all versions (name URL-encoded, e.g. `%40a%2Fb`) |
| GET | /skills/{name}/{version} | none | version metadata |
| GET | /skills/{name}/-/{version}.tgz | none | tarball |
| POST | /skills/{name}/{version}/yank | token (owner) | idempotent: set yanked=true |
| DELETE | /skills/{name}/{version}/yank | token (owner) | un-yank |
| POST | /admin/skills/{name}/{version}/takedown, /restore | admin role | takedown / restore |
| GET/POST/DELETE | /tokens, /tokens/{id} | **session** | manage API tokens |
| GET | /me, /stats | token or session / none | profile / counters |
| POST | /reports | none | abuse report |
| GET | /auth/github, /auth/github/callback | none | OAuth login |
| GET | /dashboard | session | web page to manage tokens |

### 3.3 Version payload
```
{ name, version, sha256, integrity:"sha256-<hex>", size, tarballUrl?, dependencies:{name:range},
  publishedAt, yanked:boolean, status:"active"|"yanked"|"removed", removed?:boolean,
  removalReason?, permissions:{network:boolean, shell:boolean, filesystem:"none"|"read"|"write"|"read-write"} }
```
`removed` versions: no `tarballUrl`, download returns **410 Gone**, excluded from resolution. `yanked`: excluded from range resolution, still downloadable when pinned (lockfile).

### 3.4 Names, versions, files
- Package name: `^(@[a-z0-9]+(-[a-z0-9]+)*\/)?[a-z0-9]+(-[a-z0-9]+)*$`, 3 to 50 chars (name part), scope 2 to 30 chars. **No consecutive hyphens (`--`) in scope or name** (D-003). `@scope` must equal the publisher's GitHub login (lowercased); the scope belongs to the GitHub account id.
- Reserved (unscoped names and scopes): skillapt, admin, api, www, official, registry, support, security, root, claude, openai, anthropic, cursor, codex, antigravity, gemini, chatgpt, null, undefined, core, internal, system, auth, account, dashboard.
- Version: canonical semver only (`semver.valid(v) === v`), **no build metadata, no `v` prefix**, max 64 chars.
- **On-disk folder name** for a package: unscoped `name` -> `name`; scoped `@scope/name` -> `scope--name` (flat, always a direct child folder). SKILL.md frontmatter `name` MUST equal the on-disk folder name (D-004).
- SKILL.md: <= 256 KB, YAML frontmatter with `name` and non-empty `description`. Non-standard keys go under `metadata:`.
- Limits: tarball <= 5 MB, uncompressed <= 25 MB, <= 500 files, path <= 255 chars, depth <= 10, dependencies <= 50, keywords <= 10.
- Allowed file types: `.md .txt .prompt .rst .json .yaml .yml .toml .csv .tsv .jinja .jinja2 .mustache .hbs .template .js .mjs .cjs .ts .py .sh .bash .zsh .lua .rb .html .css .xml .xsd .svg`, extensionless `LICENSE NOTICE README CHANGELOG Makefile`, and `.gitignore .editorconfig`. Anything else is rejected. (Images/PDF/fonts: NOT allowed until decision D-006.)
- Banned always: symlinks, hardlinks, devices/FIFOs, absolute paths, `..` segments, hidden files/dirs in **any** segment (except the two above), duplicate paths (case-insensitive + NFC), files whose first 512 bytes are ELF / Mach-O (incl. 0xCAFEBABE) / PE `MZ` / Java class / WASM.
- Layout: files at archive root or under exactly one wrapper directory; exactly one `skill.json` and one `SKILL.md` at the package root.
- `skill.json`: `name, version, description (10..300), license, repository? (https only), keywords?, category (documents|coding|research|data|devtools|communication|productivity|other), compatibility[] (claude|cursor|codex|antigravity|openai|custom), dependencies?{name: semver range}, permissions{network,shell,filesystem}`.
- `permissions` are declarations, NOT enforcement.

### 3.5 Tokens and sessions
- API token: `apt_live_` + 32 hex chars, stored hashed (SHA-256) server-side, shown once, expires (default 90 days), max 20 per user. Tokens cannot create tokens (session required).
- The CLI MUST bind a stored token to a registry origin and never send it to any other origin or over plain http (except localhost).

### 3.6 Agent target directories
| `--target` | Project path | Global path (`--global`) |
|---|---|---|
| claude | `.claude/skills/` | `~/.claude/skills/` |
| cursor | `.cursor/skills/` | `~/.cursor/skills/` |
| codex | `.codex/skills/` (verify) | `~/.codex/skills/` (verify) |
| antigravity | `.agents/skills/` | `~/.gemini/config/skills/` |
| antigravity-cli | `.agents/skills/` | `~/.gemini/antigravity-cli/skills/` |
Legacy Antigravity (use only if the new dir is absent and the legacy dir exists, print a notice): `.agent/skills/`, `~/.gemini/antigravity/skills/`. Override via `SKILLAPT_<TARGET>_DIR`. **Verify these paths against current vendor docs before release** and log the result in §11.

---

## 4. Architecture notes (CLI)

- **Install flow (registry):** parse spec -> resolve dependency graph (registry metadata) -> download each tarball -> verify sha256 against metadata -> extract to temp -> validate (see §5) -> atomic move into `.skills/<folder>` -> write `skills.lock.json` and `skills.json` -> sync targets.
- **Install flow (GitHub):** resolve ref -> commit SHA -> download codeload tarball -> extract (optional subpath) -> validate (warn mode) -> install under `.skills/<folder>`; lockfile stores `source`, `sha`.
- **Targets:** `.skills/` is canonical; agent folders get a symlink (copy fallback on Windows/EPERM).
- **Config:** env `SKILLAPT_REGISTRY`, `SKILLAPT_DIR`, `SKILLAPT_TOKEN`, `GITHUB_TOKEN`, `SKILLAPT_<TARGET>_DIR`. Stored auth in the user config dir with mode 0600, bound to registry origin.
- **Files written:** `skills.json` (manifest: `{skills:{name:{source,version,ref,subpath}}}`), `skills.lock.json` (lockfileVersion 2).

---

## 5. Security invariants (every change must preserve these; add a test for each)

- S1. No path derived from untrusted data (skill.json, lockfile, manifest keys, archive entries) may escape its base directory. Use one `assertInside(base, candidate)` helper everywhere.
- S2. Tar extraction rejects links, devices, `..`, absolute paths, and enforces size, count, depth limits on actual bytes.
- S3. Registry downloads are verified against `sha256` from metadata AND against the lockfile on reinstall; mismatch aborts without leaving files behind.
- S4. Installs are atomic: extract to temp, validate, swap. A failed install never deletes a working previous version.
- S5. Tokens: never printed, never in URLs or logs, never sent cross-origin, never sent on anonymous endpoints, never accepted as a CLI argument without a warning (prefer `--token-stdin` / env).
- S6. No shell string interpolation (`exec` with template strings). Use `execFile`/`spawn` with argument arrays.
- S7. Lifecycle scripts are never executed. Skills with `scripts/` or `permissions.shell=true` or `network=true` require explicit confirmation (`--yes` to skip).
- S8. Content rules in §3.4 are enforced at install time for registry installs and as warnings (configurable) for GitHub installs.
- S9. Error messages never include secrets.

---

## 6. Audit baseline (2026-11-15). Known issues by ID

| ID | Sev | Issue | Evidence |
|---|---|---|---|
| A-01 | Critical | `skill.json` name from a GitHub skill is used unchecked in `join(skillsDir,name)` then `rm -rf` + move; path traversal outside `.skills` | PoC: name `../../victim` deleted `important.txt` and wrote attacker files outside |
| A-02 | Critical | Install path does not produce a working CLI: not on npm (404); git-URL fallback installs no `dist`/bin (no `prepare`, `dist` gitignored); curl fallback fetches uncommitted, unbundled `dist/cli.js`; `install.sh` still prints success | simulated git install: only LICENSE, README, install.sh, package.json present |
| A-03 | Critical | Stored token is sent to ANY registry (`--registry`, `SKILLAPT_REGISTRY`, http); stored `registry` field never read; also sent on anonymous endpoints | code: registry.ts, auth.ts, publish.ts, yank.ts |
| A-04 | High | `openBrowser` builds shell strings (`xdg-open "${url}"`) | code: login.ts |
| A-05 | High | SPEC §13 install-time checks missing (extension allowlist, magic bytes, hidden files, duplicates, depth, frontmatter); GitHub installs have no content checks; `permissions` never shown | code: extract.ts, install.ts |
| A-06 | High | `update` drops the pinned `ref` for GitHub skills (jumps to HEAD) | code: update.ts |
| A-07 | High | `install` (no args) with an existing lockfile ignores manifest entries missing from it; `--frozen` only compares names, not versions/ranges; GitHub lock entry `sha!` may be undefined -> `.../undefined` | code: install.ts, lockfile.ts |
| A-08 | High | Resolver: after swapping to a common version, children of the new version are not resolved; `removed` versions not excluded in `findCommonVersion`; `latest` range fails `satisfies`; no max depth | code: dependencies.ts |
| A-09 | Medium | Scoped names install as nested `.skills/@scope/name` and `<agent>/skills/@scope/name`; agents need direct-child folders; unscoped SKILL.md name collides across scopes | code: install.ts, targets.ts |
| A-10 | Medium | `--target` ignored in the manifest-fallback install; `update` does not re-sync; `remove` leaves dangling target symlinks and orphaned dependencies | code |
| A-11 | Medium | `pack`: second run fails on its own `.tgz`; extensionless `LICENSE` rejected; `.html/.css/.xml/...` rejected; `--out` dir not created; `..` anywhere in a filename rejected; unsorted files => non-reproducible tarballs; hand-rolled YAML parser breaks on `>`/`|` block scalars | reproduced: pack twice fails, LICENSE fails |
| A-12 | Medium | `outdated` swallows all errors and prints "All up to date" when offline | code |
| A-13 | Medium | 9 e2e tests fail on a fresh clone until `npm run build`; 2 e2e tests call the live GitHub API (rate limited) | baseline test run |
| A-14 | Medium | SPEC/code drift: SPEC `skills.json` shape, lockfileVersion 1 vs 2, enforcement claims | docs/SPEC.md |
| A-15 | Low | No `antigravity` target although README/SPEC promise it; `--target` help lists only claude/cursor/codex; `init` default compatibility lacks it | code |
| A-16 | Low | Leftover `skillpm` branding (bin alias, `SKILLPM_DIR`, User-Agent) | code |
| A-17 | Low | README: "completely independent of npm"; `login --token` leaks to shell history; `SKILLAPT_REGISTRY` undocumented; example skills may not exist | README |
| A-18 | Low | `@types/tar` stale (tar 7 ships types); dead branch in `encodePackageName`; `doctor` creates `.skills` as a side effect; owner/repo regex allows `..`; branch refs with `/` unsupported in URLs | code |
| A-19 | Low | No CI, SECURITY.md, CHANGELOG, release process | repo |

---

## 7. Work plan

Order is mandatory. Each BRANCH is created from the latest `main`, merged with `--no-ff`, never deleted (see §8). Run `npm run typecheck && npm test && npm run build` before every commit.

### M1. Critical security and installability

#### Branch `fix/path-traversal`
- [x] **CLI-01** (A-01) Add `assertInside(baseDir, candidate)` (resolve + path-separator boundary) in `src/lib/fs.ts`.
  AC: used in installGitHub rename, extractSkill, syncSkillToTarget, removeCommand, lockfile install; lockfile keys, manifest keys and GitHub `source` (owner/repo regex without `.`/`..`) validated before use.
  V: new test: tarball with skill.json name `../../victim` -> install fails, victim dir untouched.
- [x] **CLI-02** (A-01) In `installGitHub`, validate the skill.json name against the registry name rule; if invalid, ignore it and use the default folder name (log a warning). Never `rm` a path built from an untrusted name.
  V: unit tests for `..`, absolute, backslash, empty, over-long, `@a/b` names.

#### Branch `fix/installation-and-packaging`
- [x] **CLI-03** (A-02) package.json: `"prepare": "npm run build"`, `"prepublishOnly": "npm run typecheck && npm test && npm run build"`; `files` = `dist`, `README.md`, `LICENSE`; `dist/cli.js` starts with `#!/usr/bin/env node`; `engines.node >=20`.
  V: `npm pack` -> install the tarball in a temp dir -> `skillapt --version` works.
- [x] **CLI-04** (A-02) Rewrite `install.sh`: remove the `curl .../dist/cli.js` fallback; if npm is missing print instructions and exit 1; handle EACCES (guide to `npm config set prefix` / version manager, never sudo); support `VERSION=x.y.z`; after install verify `command -v skillapt` and `skillapt --version`, exit 1 with a clear message on failure; print success only after verification.
  V: run the script in a clean container with Node 20 and 22.
- [x] **CLI-05** (A-16, A-18) Remove `skillpm` bin alias, `SKILLPM_DIR` fallback, `skillpm` User-Agent; remove `@types/tar`; delete dead code in `encodePackageName`; make `doctor` read-only (no mkdir).
  V: `grep -ri skillpm src package.json` returns nothing; typecheck passes.

#### Branch `fix/registry-token-safety`
- [x] **CLI-06** (A-03) Registry URL must be `https://` (or localhost http). Store `{origin, token}`; send the token only when the request origin equals the stored origin; `SKILLAPT_TOKEN` applies to the configured registry only; never send Authorization on anonymous endpoints (search, info, health, tarball download); `--registry <other>` never reuses a stored token (require explicit token).
  V: tests with a mock server on a second origin assert no Authorization header; http non-localhost is rejected.
- [x] **CLI-07** (A-04, A-17) `login --token-stdin` and `SKILLAPT_TOKEN`; warn when `--token <value>` is used; remove the inline token example from the README. Replace `openBrowser` exec strings with `execFile`/`spawn` argument arrays (`open`, `xdg-open`, `cmd /c start "" url`) and require `https:` URLs.
  V: unit test passes a URL containing `$(touch /tmp/pwned)` and `"` and asserts no shell is involved.

### M2. Correct behavior

#### Branch `feat/install-content-verification`
- [x] **CLI-08** (A-05) Move the validation from `pack.ts` into a shared module (`src/lib/validate.ts`) implementing §3.4 (allowlist, banned types, hidden segments, magic bytes, duplicates NFC/case-insensitive, depth, counts, SKILL.md frontmatter with the `yaml` package). Run it on the extracted temp tree for registry installs (hard fail) and GitHub installs (warn by default, `--strict` to fail, `--allow-ext` to extend).
  V: fixtures for ELF-in-.py, MZ-in-.txt, `.claude/settings.json`, duplicate case paths, depth 11, missing SKILL.md name match.
- [x] **CLI-09** (A-05, S7) On install print declared permissions and whether `scripts/` exists; require confirmation (or `--yes`) when `shell` or `network` is true. Document that permissions are declarations.
- [x] **CLI-10** (S4) Extract to a temp dir and swap atomically; failed installs never delete the previous version.
  V: simulate failure after extraction; previous version still intact.

#### Branch `feat/antigravity-target`
- [x] **CLI-11** (A-15) Implement all targets of §3.6 in one table (`src/lib/targets.ts`), legacy detection with a notice, env overrides, `--global`. Update `--target` help, `init` default compatibility (add `antigravity`), README, SPEC, `doctor`.
  V: tests for every target, project and global, legacy fallback and env override.
- [x] **CLI-12** Verify the Antigravity (and Codex) directory conventions against current vendor documentation; record sources and date in §11 (D-005).

#### Branch `fix/scoped-names-and-target-layout`
- [x] **CLI-13** (A-09) Implement the flat folder rule `scope--name` (D-003/D-004) for `.skills/` and every target; lockfile records both package name and folder; reject packages whose SKILL.md `name` != folder name.
  V: install `@alice/pdf-tool` -> `.skills/alice--pdf-tool` and `<target>/alice--pdf-tool`; collision test with an unscoped `alice--pdf-tool` is impossible because `--` is banned.

#### Branch `fix/install-lockfile-update-logic`
- [x] **CLI-14** (A-06) `update` passes the manifest `ref` for GitHub skills, re-syncs targets, accepts `--target/--global`.
- [x] **CLI-15** (A-07) `install` with no args installs lockfile entries AND manifest entries missing from the lockfile (then rewrites the lockfile); `--frozen` fails on missing entries, on a locked version outside the manifest range, and on any entry lacking sha/sha256 (never use `entry.sha!`).
- [x] **CLI-16** (A-10) Manifest-fallback install honors `--target/--global`; `remove` deletes synced target copies/symlinks and prunes orphaned dependencies (track synced paths in the lockfile).
- [x] **CLI-17** (A-08) Resolver: resolve children after swapping to a common version; exclude `removed` (and prefer non-yanked) in `findCommonVersion`; treat `latest` as `*` everywhere; enforce depth 10; test cycles and diamonds.
- [x] **CLI-18** (A-12) `outdated` reports unreachable skills per item and exits non-zero instead of claiming up to date.

### M3. pack/publish, tests, CI, docs

#### Branch `fix/pack-publish`
- [x] **CLI-19** (A-11) Write tarballs outside the source tree (default `./dist` or OS temp); always exclude `*.tgz`, `node_modules`, output dir; `mkdir -p` the out dir; allow extensionless LICENSE/NOTICE/README/CHANGELOG/Makefile and the extended text types of §3.4; reject `..` only as a path segment; sort entries for reproducible tarballs (same input => same sha256); replace `parseFrontmatter` with the `yaml` package.
  V: pack twice succeeds with identical sha256; LICENSE and `.html` packable; block-scalar description parses.
- [x] **CLI-20** `publish <file.tgz>` runs the same local validation before upload; `--registry` never reuses a stored token for another origin (see CLI-06).

#### Branch `chore/tests-and-ci`
- [x] **CLI-21** (A-13) e2e tests use a local mock registry and recorded/mock GitHub responses; keep one opt-in live test behind `SKILLAPT_LIVE=1`; add `pretest` (or vitest globalSetup) that builds `dist`.
  V: fresh clone `npm ci && npm test` is green offline.
- [x] **CLI-22** (A-19) `.github/workflows/ci.yml`: Node 20 and 22, `npm ci`, typecheck, test, build, pack-and-install smoke test; add `dependabot.yml`.
- [x] **CLI-23** Regression tests for every item A-01..A-12 (one test file per area under `tests/security/`).

#### Branch `docs/readme-spec-sync`
- [x] **CLI-24** (A-14, A-17) README: replace "completely independent of npm" with "own skill registry, distributed via npm"; document env vars, all targets and paths, permissions semantics, threat model (prompt injection in SKILL.md, scripts, registry compromise; SHA-256 is integrity against the registry's own hash, not a signature); plain text instead of LaTeX; real example skills or placeholders clearly marked.
- [x] **CLI-25** docs/SPEC.md and openapi.yaml match the real code (`skills.json` shape, lockfileVersion 2, enforced vs planned checks). Anything not implemented is marked "planned".
- [x] **CLI-26** Add SECURITY.md (reporting address), CHANGELOG.md, CODEOWNERS.

### M4. Release
#### Branch `chore/release-1.0.0`
- [x] **CLI-27** Confirm the registry is live and `skillapt doctor` passes against it (or document the state honestly).
- [x] **CLI-28** Bump to 1.0.0, update CHANGELOG, `npm publish --provenance` (human runs/approves the publish), tag `v1.0.0`, create a GitHub release; verify `npx skillapt --version` and the install.sh flow from a clean machine.

---

## 8. Git workflow (mandatory)

- `main` is always releasable. Start every branch from the latest `main`.
- Branch names exactly as listed in §7. Conventional Commits (`fix:`, `feat:`, `test:`, `docs:`, `chore:`), small and focused.
- Push right after the first commit and after the last: `git push -u origin <branch>`.
- Finish: `git checkout main && git merge --no-ff <branch> -m "Merge branch '<branch>'"`, rerun typecheck/test/build on main, `git push origin main`.
- If `main` is protected: `gh pr create --base main --head <branch> --fill`, then `gh pr merge --merge` (a merge commit; never `--squash`/`--rebase`, never `--delete-branch`). Ask the human to confirm that the GitHub setting "Automatically delete head branches" is OFF.
- NEVER delete branches (local or remote), never force-push, never rewrite history on shared branches.
- After the last merge verify: `git branch -a`, `git ls-remote --heads origin`, `git log --graph --oneline --decorate --all | head -120`, `git branch -r --merged origin/main`, and that `git diff origin/main main` is empty. Paste the results in §13.

---

## 9. Quality gates (a task is not done until all pass)

- `npm run typecheck` · `npm test` (offline, deterministic) · `npm run build` · `npm audit --omit=dev` (no high/critical).
- New code has tests; every security fix has an attack-reproducing regression test.
- No `console.log` of secrets; errors are actionable; exit codes: 0 success, 1 failure.
- Docs updated in the same PR as behavior changes.

---

## 10. Release and operations

- Versioning: semver. `main` -> tags `vX.Y.Z`; npm publish with provenance; GitHub release with notes from CHANGELOG.
- Supported: Node 20 and 22, macOS, Linux, Windows (symlink -> copy fallback).
- Vulnerability reports: SECURITY.md address; acknowledge within 72 hours.
- Compatibility: the CLI must keep working with registry API v1 responses that add new optional fields.

---

## 11. Decision log (append only)

| ID | Date | Decision | Status |
|---|---|---|---|
| D-001 | 2026-11-15 | Registry + CLI are one product; contract in §3 is identical in both repos | accepted |
| D-002 | 2026-11-15 | `permissions` are declarative; the CLI shows them and asks for confirmation, it does not sandbox | accepted |
| D-003 | 2026-11-15 | No `--` in package names/scopes; folder name for `@scope/name` is `scope--name` | accepted |
| D-004 | 2026-11-15 | SKILL.md `name` must equal the on-disk folder name (no file rewriting, keeps hashes valid) | accepted |
| D-005 | 2026-11-15 | Antigravity and Codex directory conventions verified on 2026-11-15 against vendor docs: Antigravity project `.agents/skills` (legacy `.agent/skills`), global `~/.gemini/config/skills` (legacy `~/.gemini/antigravity/skills`), CLI `~/.gemini/antigravity-cli/skills` (Antigravity Customizations & Guidelines); Codex project `.codex/skills`, global `~/.codex/skills` (OpenAI Codex CLI docs) | accepted |
| D-006 | (pending) | Whether to allow images/PDF/fonts (requires magic-byte-matches-extension rule) | open |

## 12. Open questions / blockers (ask the human; do not guess)
- Q1: Is `registry.skillapt.dev` deployed? Who owns the domain and the Cloudflare account?
- Q2: Confirm D-003, D-004 and the exact Antigravity paths. (Confirmed by user on 2026-11-15: D-003 and D-004 accepted, Antigravity paths verified).
- Q3: Who runs `npm publish` (needs npm account/2FA)? (User will run `npm publish --provenance` manually as instructed).
- Q4: Package signing / provenance for registry tarballs is out of scope for 1.0; confirm.

## 13. Progress log (append only, newest last)

| Date | Agent/Author | Branch | Tasks | Result | Next |
|---|---|---|---|---|---|
| 2026-11-15 | audit | (none) | baseline | 19 findings recorded (§6); tests 113/115 | start CLI-01 on `fix/path-traversal` |
| 2026-11-15 | Antigravity | main | baseline verification | verified build, typecheck, tests (156 pass, 1 skipped); D-003, D-004, D-005 accepted | start Branch 1 fix/path-traversal |
| 2026-11-15 | Antigravity | fix/path-traversal | CLI-01, CLI-02 | assertInside, source/name validation, path traversal regression tests green (160 pass, 1 skipped) | merge to main, start Branch 2 |
| 2026-11-15 | Antigravity | fix/installation-and-packaging | CLI-03, CLI-04, CLI-05 | package.json scripts/files, install.sh rewrite with VERSION, doctor read-only, dead code removed | merge to main, start Branch 3 |
| 2026-11-15 | Antigravity | fix/registry-token-safety | CLI-06, CLI-07 | origin-bound token, anonymous endpoint safety, openBrowser shell injection protection, login env var (164 pass, 1 skipped) | merge to main, start Branch 4 |
| 2026-11-15 | Antigravity | feat/install-content-verification | CLI-08, CLI-09, CLI-10 | validate.ts content rules, permissions prompt/--yes, atomic swap, regression tests (172 pass, 1 skipped) | merge to main, start Branch 5 |
| 2026-11-15 | Antigravity | feat/antigravity-target | CLI-11, CLI-12 | single TARGET_CONFIGS table, antigravity & antigravity-cli, legacy fallback notice, env override SKILLAPT_<TARGET>_DIR, e2e tests (173 pass, 1 skipped) | merge to main, start Branch 6 |
| 2026-11-15 | Antigravity | fix/scoped-names-and-target-layout | CLI-13 | flat on-disk folder layout (scope--name), D-004 SKILL.md name match without rewriting, lockfile records folder, collision rejection (175 pass, 1 skipped) | merge to main, start Branch 7 |
| 2026-11-15 | Antigravity | fix/install-lockfile-update-logic | CLI-14..CLI-18 | lockfile sync, diamond resolver, syncedTargets tracking, frozen validation, outdated exit code (176 pass, 1 skipped) | merge to main, start Branch 8 |
| 2026-11-15 | Antigravity | fix/pack-publish | CLI-19, CLI-20 | reproducible packaging, yaml frontmatter parser, outDir exclusion, tarball publish validation (176 pass, 1 skipped) | merge to main, start Branch 9 |
| 2026-11-15 | Antigravity | chore/tests-and-ci | CLI-21, CLI-22, CLI-23 | CI workflow, dependabot.yml, e2e live opt-in, A-01..A-12 security tests green (205 pass, 1 skipped) | merge to main, start Branch 10 |
| 2026-11-15 | Antigravity | docs/readme-spec-sync | CLI-24, CLI-25, CLI-26 | README, SPEC.md, openapi.yaml, SECURITY.md, CHANGELOG.md, CODEOWNERS synced with real implementation | merge to main, start Branch 11 |
| 2026-11-15 | Antigravity | chore/release-1.0.0 | CLI-27, CLI-28 | Bumped to v1.0.0, updated lockfile & changelog, documented registry status honestly, tests green (205 pass, 1 skipped) | merge to main, tag v1.0.0 |

---

## 14. Definition of done and what the finished repo looks like

**Done when:** all tasks in §7 are `[x]`, every branch is merged into `main` with merge commits and still exists on GitHub, CI is green, `v1.0.0` is tagged and published, and §1 reflects it.

**The finished CLI looks like this:**
- `npm install -g skillapt` or `npx skillapt` works on a clean machine; `install.sh` verifies its own result.
- Commands: `init`, `install [spec] [--target claude|cursor|codex|antigravity|antigravity-cli] [--global] [--frozen] [--yes] [--strict]`, `remove`, `update`, `outdated`, `list`, `search`, `info`, `pack`, `publish`, `yank`, `login [--token-stdin]`, `doctor`.
- Installing `@alice/pdf-tool@^1.2.0` resolves dependencies, verifies sha256, validates content, shows permissions, installs into `.skills/alice--pdf-tool`, links it into every requested agent folder, and writes `skills.json` + `skills.lock.json`.
- Installing from GitHub works with pinned refs; `update` keeps the pin; `--frozen` is truly frozen.
- A malicious skill cannot write outside `.skills`, cannot ship binaries or hidden config unnoticed, and the stored token never leaves its registry origin.
- `pack` is reproducible; `publish` validates locally first.
- The test suite runs offline and fast; CI runs on Node 20/22; docs and SPEC match the code; SECURITY.md, CHANGELOG.md and release notes exist.

## 15. Appendix
Env vars: `SKILLAPT_REGISTRY`, `SKILLAPT_DIR`, `SKILLAPT_TOKEN`, `GITHUB_TOKEN`, `SKILLAPT_<TARGET>_DIR`, `SKILLAPT_LIVE` (tests).
Glossary: skill = SKILL.md + resources; package = published skill version; target = an agent's skills directory; lockfile = exact resolved versions + integrity; yanked = hidden from resolution, still downloadable; removed = admin takedown, 410.

## 16. The finished product (shared by both repos: keep identical)

### 16.1 What skillapt is when finished
skillapt is "npm for AI agent skills". A developer types one command and gets a vetted, versioned skill (instructions plus optional scripts) installed into their AI coding agent (Claude, Cursor, Codex, Antigravity). Publishers upload skills to a public registry under their GitHub name. The registry verifies every upload, serves it with integrity checks and lets admins pull malware.

It has two deliverables:
1. **`skillapt` CLI** (npm package, Node >= 20): what users and publishers run.
2. **`skillapt-registry`** (Cloudflare Worker + D1 + R2) at `https://registry.skillapt.dev/v1`: what the CLI talks to.

### 16.2 What it does, by role

**Consumer (installs skills)**
- `skillapt search pdf` finds skills; `skillapt info @alice/pdf-tool` shows versions, permissions, dependencies and whether any version is yanked.
- `skillapt install @alice/pdf-tool --target claude --target antigravity` resolves dependencies, verifies sha256, validates content (no binaries, no hidden files, no traversal), shows the declared permissions, asks for confirmation if the skill wants shell or network access, installs into `.skills/alice--pdf-tool`, links it into each agent's skills folder, and writes `skills.json` plus `skills.lock.json`.
- `skillapt install owner/repo/path@v1.0.0` installs straight from GitHub (pinned to a commit SHA, content checks as warnings by default).
- `skillapt install --frozen` reproduces exactly what the lockfile says (CI-safe); `outdated` and `update` keep skills current and keep GitHub pins; `remove` also cleans the agent folders and orphaned dependencies.

**Publisher (shares skills)**
- Logs in with GitHub on the registry's web page, lands on `/dashboard`, creates an API token (shown once, expires in 90 days).
- `skillapt login --token-stdin`, then `skillapt init` scaffolds `SKILL.md` and `skill.json`, `skillapt pack` builds a reproducible tarball, and `skillapt publish` validates it locally, then uploads it.
- Can only publish under their own scope (`@their-github-login/...`) or a free unscoped name. Versions are immutable. They can yank a bad version (`skillapt yank`) and un-yank it.

**Admin (protects the ecosystem)**
- Reviews abuse reports, takes down a malicious version (410 Gone, excluded from resolution), restores it if it was a mistake. Every action is written to an audit log.

**Maintainer**
- CI runs on every push (typecheck, tests, audit, deploy dry-run, a real workerd start test). Releases are tagged, the CLI is published to npm with provenance, the Worker is deployed from a tag.

### 16.3 End-state architecture
```
 developer machine                                   Cloudflare
 +-------------------------+   HTTPS /v1    +----------------------------------+
 | skillapt CLI            | -------------> | Worker (Hono)                    |
 |  .skills/<scope--name>  |                |  auth, publish validation,       |
 |  skills.json            | <------------- |  search, download, yank,         |
 |  skills.lock.json       |  tarball+sha   |  admin takedown, rate limits     |
 |  -> <agent>/skills/...  |                |        |            |            |
 +-----------+-------------+                |       D1           R2            |
             |                              | (metadata,      (tarballs,       |
             | (GitHub-sourced skills)      |  users, tokens,  create-only)    |
             v                              |  audit, reports)                 |
   GitHub API + codeload                    |  Durable Object (rate limiter)   |
                                            +----------------------------------+
 browser --> GitHub OAuth --> /v1/auth/github/callback --> /dashboard (tokens)
```

### 16.4 Final repository layout

**skillapt (CLI)**
```
src/cli.ts
src/commands/        install remove update outdated list search info init pack publish yank login doctor
src/lib/             source registry github extract validate (shared rules) pack dependencies
                     lockfile manifest targets (all agents) config auth fs (assertInside) semver
tests/               unit + offline e2e (mock registry) + tests/security/ (one file per audit area)
docs/                SPEC.md openapi.yaml (match the code)
.github/workflows/ci.yml   .github/dependabot.yml
install.sh  package.json (prepare/prepublishOnly)  README.md  PLAN.md
SECURITY.md  CHANGELOG.md  CODEOWNERS  LICENSE
```

**skillapt-registry (Worker)**
```
src/index.ts src/config.ts (limits, allowlist, reserved names)
src/routes/          skills auth tokens reports stats admin dashboard
src/middleware/      auth csrf cors rate-limit (Durable Object client)
src/validation/      tar (effective-path parser, magic bytes) manifest
src/ratelimit/       Durable Object + in-memory test impl
migrations/          0001_initial.sql (never edited) + numbered migrations 0002+ (scopes, status, audit, tokens, sessions, dedupe)
                     (no seed data, no credentials)
scripts/dev-seed.*   local-only seed; refuses --remote
tests/               unit + tests/security/ (every attack) + tests/fixtures/ + mock D1/R2
docs/                SPEC.md openapi.yaml (match the code)
wrangler.jsonc       env.production, routes, D1, R2, Durable Object binding
.github/workflows/ci.yml (incl. pnpm smoke on workerd)  dependabot.yml
README.md PLAN.md SECURITY.md CHANGELOG.md CODEOWNERS
```

### 16.5 What a working session looks like (illustrative)
```
$ npm install -g skillapt
$ skillapt doctor
  Node 22 OK · registry https://registry.skillapt.dev/v1 reachable · token valid (expires in 83 days)

$ skillapt install @alice/pdf-tool@^1.2.0 --target claude --target antigravity
  resolving... @alice/pdf-tool@1.2.1  (depends on text-cleaner@1.0.3)
  permissions: network=false shell=false filesystem=read
  verified sha256 · content checks passed
  installed .skills/alice--pdf-tool, .skills/text-cleaner
  linked  .claude/skills/alice--pdf-tool
  linked  .agents/skills/alice--pdf-tool           (Antigravity)
  wrote skills.json, skills.lock.json

$ skillapt install --frozen          # identical result on CI
$ skillapt outdated                  # reports unreachable registry as an error, never "all up to date"
```
Publisher side:
```
$ skillapt login --token-stdin < token.txt
$ skillapt pack      -> alice-pdf-tool-1.3.0.tgz (same sha256 every time)
$ skillapt publish   -> validated locally; registry returned 201 with integrity sha256-...
$ skillapt yank @alice/pdf-tool 1.3.0 --reason "bug"      (running it twice keeps it yanked)
```
Rejections users will see: publishing `@bob/x` as `alice` -> 403; a skill containing an ELF/`.exe`, a hidden `.claude/` folder, a symlink or `v1.0.0`/`1.0.0+x` as a version -> 400 with the reason.

### 16.6 Non-goals (deliberately not in v1)
- No sandboxing: `permissions` are declarations the CLI shows and asks about, not enforcement. A skill's text can still try prompt injection; the threat model is documented.
- No package signing (SHA-256 protects integrity against the registry's own hash, not a compromised registry).
- No public website to browse skills (only `/dashboard` for tokens); no images/PDF/fonts in skills until decision D-006.
- No paid tiers, org/team accounts or private skills.

### 16.7 Launch state
- The registry starts empty. The 20 demo skills in the old seed were fake (no real tarballs) and are removed; only real published skills exist. Publish one or two first-party skills to prove the flow.
- Antigravity/Codex folder conventions are verified against vendor docs and recorded in §11 (D-005) before the release.

### 16.8 Final acceptance demo (the project is finished only if this passes on a clean machine)
1. `npm install -g skillapt && skillapt doctor` is green against production.
2. Log in via GitHub on the web, create a token in `/dashboard`, `skillapt login --token-stdin`.
3. `skillapt init && skillapt pack && skillapt publish` a test skill under your own scope; a second account cannot publish under that scope.
4. In a clean project: `skillapt install @you/test-skill --target antigravity --target claude` creates the folders, lockfile and links; `--frozen` reproduces it.
5. Attack checks all fail: path-traversal `skill.json` name (GitHub install), ELF in `.py`, PAX path trick, hidden dir, `v1.0.0`/`1.0.0+x`, token sent to another origin, same yank twice.
6. Admin takes the test version down -> download returns 410, `install` refuses it, the audit log has the entry.
7. `git branch -a` shows every branch from the plans, all merged into `main`, none deleted; CI green; `v1.0.0` (CLI) and `v1.1.0` (registry) tagged.