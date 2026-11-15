<div align="center">

# skillapt

**A secure package manager for AI agent skills.**
Install, lock, verify, pack and publish skills for Claude, Cursor, Codex, Antigravity and custom agents, from a registry or straight from GitHub.

[![CI](https://github.com/Ankur17nith/skillapt/actions/workflows/ci.yml/badge.svg)](https://github.com/Ankur17nith/skillapt/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.12-green.svg)](https://nodejs.org/)
[![Security Policy](https://img.shields.io/badge/security-policy-brightgreen.svg)](SECURITY.md)

[Quick start](#-quick-start) · [Commands](#-command-reference) · [Security](#%EF%B8%8F-threat-model--security-posture) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

</div>

---

## Why skillapt?

AI agent skills (`SKILL.md` plus helper files) are effectively *prompts and code that your agent trusts*. Copy-pasting them from random repositories gives you no versioning, no integrity checks and no review step. `skillapt` treats skills the way a package manager treats libraries:

- **Reproducible**: `skills.json` + `skills.lock.json`, with `install --frozen` for CI.
- **Verified**: SHA-256 integrity checks before extraction, strict archive limits, no symlinks/devices, no lifecycle scripts, ever.
- **Transparent**: declared permissions (`network`, `shell`, `filesystem`) are shown and need confirmation when elevated.
- **Agent-aware**: sync installed skills into Claude, Cursor, Codex and Antigravity skill directories.
- **Flexible sources**: a skillapt registry (self-hostable on free Cloudflare Workers) or any public GitHub repository.

## The skillapt project

| Repository | Purpose |
| :--- | :--- |
| **skillapt** (this repo) | The `skillapt` CLI, distributed via npm |
| [skillapt-registry](https://github.com/Ankur17nith/skillapt-registry) | Registry API on Cloudflare Workers + D1 + R2 |
| [skillapt-web](https://github.com/Ankur17nith/skillapt-web) | Website and documentation |

> **Registry status**: no public hosted registry is running yet, and `skillapt` ships with **no default registry URL**.
> GitHub installs work out of the box. To use a registry, deploy your own
> ([skillapt-registry](https://github.com/Ankur17nith/skillapt-registry) runs on Cloudflare's free tier) and point the CLI at it with
> `SKILLAPT_REGISTRY=https://<your-worker>.workers.dev/v1` (or run `skillapt login` once; the registry is remembered).
> Skill names such as `pdf-summarizer` and `@alice/pdf-tool` in this document are illustrative placeholders.

---

## ⚡ Installation

Requires **Node.js 22.12 or newer**.

```bash
# Run without installing
npx skillapt install vercel-labs/skills/skills/find-skills

# Or install globally
npm install -g skillapt
```

Shell installer (checks Node.js and installs the same npm package; read it first at [`install.sh`](install.sh)):

```bash
curl -fsSL https://raw.githubusercontent.com/Ankur17nith/skillapt/main/install.sh | bash
```

---

## 🚀 Quick Start

```bash
# 1. Scaffold a skill package (SKILL.md + skill.json) and/or a consumer skills.json
skillapt init --name my-custom-skill

# 2. Install a skill from GitHub (no registry needed)
skillapt install vercel-labs/skills/skills/find-skills

# 3. Sync it into your AI agent's skills directory
skillapt install vercel-labs/skills/skills/find-skills --target claude

# 4. Reproducible installs in CI
skillapt install --frozen

# 5. Check your setup
skillapt doctor
```

---

## 🌐 Configuration

| Variable | Default | Description |
| :--- | :--- | :--- |
| `SKILLAPT_REGISTRY` | *(none)* | Registry base URL including `/v1`, e.g. `https://<worker>.workers.dev/v1`. HTTPS required (HTTP only for `localhost`, `127.0.0.1`, `[::1]`). If unset, the registry saved by `skillapt login` is used. |
| `SKILLAPT_DIR` | `.skills` | Directory where skills are installed (also `--dir`). |
| `SKILLAPT_TOKEN` | *(none)* | Registry API token. Only ever sent to the configured registry's origin. |
| `GITHUB_TOKEN` | *(none)* | GitHub token for API requests (higher rate limits, private repos). |
| `SKILLAPT_<TARGET>_DIR` | *(none)* | Override an agent target directory: `SKILLAPT_CLAUDE_DIR`, `SKILLAPT_CURSOR_DIR`, `SKILLAPT_CODEX_DIR`, `SKILLAPT_ANTIGRAVITY_DIR`, `SKILLAPT_ANTIGRAVITY_CLI_DIR`. |
| `XDG_CONFIG_HOME` | `~/.config` | Location of `skillapt/config.json` (stored token and registry, mode `0600`). |

---

## Registry vs GitHub sources

| | Registry (`name[@range]`) | GitHub (`owner/repo[/subpath][@ref]`) |
| :--- | :--- | :--- |
| Versioning | SemVer ranges, yanking, dependencies | Pinned to a resolved commit SHA in the lockfile |
| Integrity | SHA-256 from registry metadata, re-checked from the lockfile | Tarball fetched by commit SHA |
| Content rules | Violations are errors | Violations are warnings (`--strict` makes them errors) |
| Needs | A configured registry | Nothing (set `GITHUB_TOKEN` for rate limits) |

## 📖 Command Reference

### `skillapt init`
Scaffolds a new AI agent skill package or workspace.
```bash
# Scaffolds SKILL.md, skill.json, and workspace skills.json
skillapt init

# Scaffold with custom package name
skillapt init --name my-super-skill

# Scaffold skill package files only (SKILL.md + skill.json)
skillapt init --skill

# Scaffold consumer workspace only (skills.json)
skillapt init --workspace
```

---

### `skillapt install`
Installs agent skills from the registry or GitHub repositories.

#### Registry Source (`name[@range]`) *(Placeholders for demonstration)*
```bash
# Install latest non-yanked version
skillapt install <skill-name>

# Install with SemVer range
skillapt install "<skill-name>@^1.2.0"
skillapt install "<skill-name>@~1.1.0"

# Install pinned exact version
skillapt install <skill-name>@1.2.3

# Install scoped package (installed to flat on-disk folder scope--skill-name)
skillapt install "@alice/pdf-tool@^2.0.0"
```

#### GitHub Source (`user/repo[@ref][/subpath]`)
```bash
# Install from default branch
skillapt install vercel-labs/skills/skills/find-skills

# Install specific tag or commit
skillapt install user/repo@v1.0.0

# Install subfolder containing a skill
skillapt install user/repo/skills/summarizer

# Install from full URL
skillapt install https://github.com/user/repo/tree/main/skills/my-skill
```

#### Agent Target Synchronization (`--target`)
Automatically symlinks or copies installed skills into your AI agent's skills folder so the agent can discover the prompt guide immediately:

| Target Name | Project Path | Global Path (`--global`) |
| :--- | :--- | :--- |
| `claude` | `.claude/skills` | `~/.claude/skills` |
| `cursor` | `.cursor/skills` | `~/.cursor/skills` |
| `codex` | `.codex/skills` | `~/.codex/skills` |
| `antigravity` | `.agents/skills` | `~/.gemini/config/skills` |
| `antigravity-cli` | `.agents/skills` | `~/.gemini/antigravity-cli/skills` |

```bash
# Sync to Claude (.claude/skills)
skillapt install vercel-labs/skills/skills/find-skills --target claude

# Sync to multiple targets (repeated flag or comma-separated)
skillapt install vercel-labs/skills/skills/find-skills --target claude --target antigravity
skillapt install vercel-labs/skills/skills/find-skills --target claude,antigravity

# Sync to Cursor (.cursor/skills)
skillapt install vercel-labs/skills/skills/find-skills --target cursor

# Sync to Codex (.codex/skills)
skillapt install vercel-labs/skills/skills/find-skills --target codex

# Sync to Antigravity (.agents/skills, global ~/.gemini/config/skills)
skillapt install vercel-labs/skills/skills/find-skills --target antigravity

# Sync to Antigravity CLI (.agents/skills, global ~/.gemini/antigravity-cli/skills)
skillapt install vercel-labs/skills/skills/find-skills --target antigravity-cli

# Sync to user's global home directory (~/.gemini/config/skills)
skillapt install vercel-labs/skills/skills/find-skills --target antigravity --global
```

Legacy Antigravity paths (`.agent/skills` and `~/.gemini/antigravity/skills`) are automatically detected if present when the new paths do not exist. You can also override the Antigravity target directory using the `SKILLAPT_ANTIGRAVITY_DIR` environment variable.

#### Deterministic & CI Installs (`--frozen`)
```bash
# Installs all skills declared in skills.json and skills.lock.json
skillapt install

# Fails if skills.lock.json is missing or out of sync (ideal for CI/CD)
skillapt install --frozen
```

---

### `skillapt search <query>`
Searches the registry index with optional filters.
```bash
skillapt search summarizer
skillapt search coding --category coding
skillapt search data --compat claude
skillapt search pdf --json
```

---

### `skillapt info <name>`
Shows metadata, latest release, compatibility, dependencies, and README for a skill.
```bash
skillapt info <skill-name>
skillapt info <skill-name> --json
```

---

### `skillapt outdated`
Checks installed skills against the registry for newer compatible versions.
```bash
skillapt outdated
skillapt outdated --json
```

---

### `skillapt update [name]`
Updates installed skills to their highest compatible SemVer releases.
```bash
# Update all outdated skills
skillapt update

# Update a single skill
skillapt update <skill-name>

# Update and sync to agent target(s) (repeated flag or comma-separated)
skillapt update <skill-name> --target claude,antigravity
```

---

### `skillapt list`
Lists all skills currently installed in `.skills/`.
```bash
skillapt list
skillapt list --json
```

---

### `skillapt remove <name>`
Uninstalls a skill from `.skills/`, prunes orphaned dependencies, and cleans up synced copies from agent targets. When `--target` is specified, the skill is only un-synced from the specified targets while leaving `.skills/` and `skills.json` intact.
```bash
# Remove a skill completely from .skills/, manifest, lockfile, and all agent targets
skillapt remove <skill-name>

# Remove/un-sync a skill ONLY from specified agent target(s)
skillapt remove <skill-name> --target claude --target antigravity
skillapt remove <skill-name> --target claude,antigravity
skillapt remove <skill-name> --target claude --global
```

---

### `skillapt login` & `skillapt logout`
Authenticates with the registry via browser OAuth or secure token input.
```bash
# Opens browser to authorize via GitHub
skillapt login

# Authenticate via stdin (prevents token leakage in shell history)
echo "$MY_TOKEN" | skillapt login --token-stdin

# Remove stored token
skillapt logout
```

> **Warning on Token Safety**: Avoid passing `--token <value>` directly on the command line, as doing so leaks your secret token to shell history files (`~/.bash_history`, `~/.zsh_history`) and system process listings (`ps`). Prefer `skillapt login` (browser OAuth), `--token-stdin`, or the `SKILLAPT_TOKEN` environment variable.
>
> Tokens are origin-bound and stored with `0600` permissions in `~/.config/skillapt/config.json`. Tokens are never transmitted to third-party endpoints or on unauthenticated requests.

---

### `skillapt pack [dir]`
Validates files and builds a deterministic, reproducible `.tar.gz` distribution archive.
```bash
skillapt pack
skillapt pack ./my-skill --out ./dist
skillapt pack --json
```
Tarballs default to `./dist/` outside the source files. Enforces:
- Extension allowlist (`.md`, `.txt`, `.prompt`, `.rst`, `.json`, `.yaml`, `.yml`, `.toml`, `.csv`, `.tsv`, `.jinja`, `.jinja2`, `.mustache`, `.hbs`, `.template`, `.js`, `.mjs`, `.cjs`, `.ts`, `.py`, `.sh`, `.bash`, `.zsh`, `.lua`, `.rb`, `.html`, `.css`, `.xml`, `.xsd`, `.svg`; extensionless `LICENSE`, `NOTICE`, `README`, `CHANGELOG`, `Makefile`; `.gitignore`, `.editorconfig`). All other extensions (including images and PDFs pending decision D-006) are rejected.
- Rejects prohibited binaries (`.exe`, `.dll`, `.so`, `.dylib`) and inspects magic bytes (ELF, Mach-O, Windows PE MZ, Java class, WASM).
- Reproducible tarballs: entries are sorted alphabetically and mtime timestamps are normalized to ensure identical SHA-256 for identical inputs.
- Excludes `node_modules`, `*.tgz`, and the output directory from the package walk.

---

### `skillapt publish [target]`
Publishes a skill package directory or pre-built tarball to the registry after local validation.
```bash
# Pack and publish current directory
skillapt publish

# Publish pre-built tarball (runs same local verification before upload)
skillapt publish ./dist/my-skill-1.0.0.tgz
```

---

### `skillapt yank <spec>`
Marks a published version as yanked so range queries skip it.
```bash
skillapt yank my-skill@1.0.1 --reason "Discovered critical bug"
```

---

### `skillapt doctor`
Runs comprehensive system diagnostics.
```bash
skillapt doctor
```
Checks:
- Node.js runtime version (>= 22.12.0)
- Registry server reachability (`/health` and `/stats`)
- Authentication token validity (`/v1/me`)
- Skills directory permissions

---

## 🛡️ Threat Model & Security Posture

When using and distributing AI agent skills, understand the following threat model:

### 1. Prompt Injection in `SKILL.md`
- **Threat**: Skill documentation (`SKILL.md`) is ingested directly into an AI agent's prompt context. A malicious or compromised skill could include adversarial prompt injections designed to hijack the agent's behavior, exfiltrate context, or manipulate tool invocation.
- **Mitigation**: Treat installed skills as code with corresponding trust levels. Review `SKILL.md` files before granting autonomous agent access. Only install skills from trusted authors or verified publishers.

### 2. Script Execution & Sandboxing
- **Threat**: Skills may contain executable scripts under `scripts/`. A rogue skill could attempt unauthorized disk access or network exfiltration if executed by an agent.
- **Mitigation**:
  - `skillapt` enforces zero automatic execution: the package manager never executes lifecycle hooks (`postinstall`, etc.) during installation.
  - On installation, `skillapt` displays declared permissions (`network`, `shell`, `filesystem`) and flags `scripts/` directories, requiring explicit confirmation (`--yes` or interactive confirmation) if dangerous capabilities are requested.
  - **Important**: Permissions declared in `skill.json` are author metadata declarations for awareness, not kernel sandboxes. Host environments and agent runtimes must enforce isolation (containers, seccomp, sandbox profiles).

### 3. Registry & Network Integrity
- **Threat**: Man-in-the-middle attacks or registry compromise attempting to tamper with downloaded packages.
- **Mitigation**:
  - All registry communication requires HTTPS (HTTP permitted only on `localhost`/`127.0.0.1`).
  - Tarballs are validated against SHA-256 integrity checksums *before* extraction.
  - **Note**: SHA-256 checksums verify that the downloaded tarball matches the hash published in the registry or recorded in `skills.lock.json`. They are integrity checks against the registry's recorded state, not cryptographic author signatures.

### 4. Path Traversal & Decompression Safety
- **Safe Extraction**: Extraction uses atomic temporary directories and enforces:
  - Boundary assertions (`assertInside`) preventing any writes outside the destination directory.
  - Rejection of path traversal (`..` path segments) and absolute paths.
  - Blocking symlinks, hardlinks, FIFOs, and device nodes.
  - Hard decompression limits (maximum 500 files, 25 MB uncompressed, 5 MB compressed, 255 char paths).
  - Magic byte detection rejecting disguised binary executables (ELF, Mach-O, PE, Java class).

---

---

## ❓ FAQ & Troubleshooting

**`No skillapt registry is configured`**: you used a registry command (`search`, `info`, registry installs, `login`, `publish`) with no registry set. Export `SKILLAPT_REGISTRY` or install from GitHub instead.

**`GitHub API rate limit exceeded`**: set `GITHUB_TOKEN` (any token with no scopes works for public repos).

**`Integrity check failed`**: the downloaded package does not match the hash in the registry or `skills.lock.json`. Nothing was installed. Do not bypass it; investigate the registry or lockfile change.

**`requires elevated permissions ... Pass --yes`**: the skill declares `network` or `shell` access and you are not on an interactive terminal. Review the skill, then re-run with `--yes`.

**Registry unreachable**: run `skillapt doctor` to see the exact URL, error and next steps.

**Node.js version errors**: skillapt needs Node.js 22.12+ (Node 20 is end-of-life).

**Where are credentials stored?** `~/.config/skillapt/config.json` (mode `0600`), bound to the registry origin they were issued for.

---

## 🛠️ Development

```bash
git clone https://github.com/Ankur17nith/skillapt.git
cd skillapt
npm ci
npm run typecheck
npm test        # fully offline, mocked GitHub and registry
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions, the PR checklist and the release process.

## 🔒 Security

Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## 📄 License

[MIT](LICENSE) © skillapt contributors
