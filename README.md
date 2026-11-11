# skillapt

**A secure package manager for AI agent skills with its own skill registry, distributed via npm.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](https://nodejs.org/)

`skillapt` manages AI agent skills with its own dedicated skill registry while being conveniently distributed via npm. It discovers, resolves, installs, locks, packs, and publishes AI agent skills (for Claude, Cursor, Codex, Antigravity, and custom LLM frameworks) backed by registry and GitHub sources.

> **Registry Status**: `https://registry.skillapt.dev` is the designated public endpoint for the hosted registry service, currently in staging (pending public deployment; does not resolve publicly yet). You can use GitHub skill sources immediately or configure a local/self-hosted registry via `SKILLAPT_REGISTRY`.
>
> *(Note: Skill names like `pdf-summarizer` and `@alice/pdf-tool` in this documentation are placeholders for illustrative purposes. For a real skill from GitHub, see the GitHub install examples below).*

---

## ⚡ Installation

### Via Shell Script (Recommended)
```bash
curl -fsSL https://raw.githubusercontent.com/Ankur17nith/skillapt/main/install.sh | bash
```

### Via npm / npx
```bash
# Run directly with npx
npx skillapt install vercel-labs/skills/skills/find-skills

# Or install globally
npm install -g skillapt
```

> **Requirement**: Node.js **20.0.0** or higher.

---

## 🚀 Quick Start

```bash
# 1. Initialize a new skill package
skillapt init --name my-custom-skill

# 2. Install a real skill from GitHub
skillapt install vercel-labs/skills/skills/find-skills

# 3. Sync installed skill directly to your AI agent environment
skillapt install vercel-labs/skills/skills/find-skills --target antigravity

# 4. Check your setup health
skillapt doctor
```

---

## 🌐 Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `SKILLAPT_REGISTRY` | `https://registry.skillapt.dev` | Base URL for the skillapt registry API. Must use HTTPS (HTTP permitted only for `localhost` and `127.0.0.1`). |
| `SKILLAPT_DIR` | `.skills` | Project directory where skills are installed locally. |
| `SKILLAPT_TOKEN` | *(none)* | Registry authentication token. Used for publishing, yanking, or accessing private registry endpoints. Tokens are origin-bound to the configured registry. |
| `GITHUB_TOKEN` | *(none)* | GitHub personal access token used for GitHub API requests to avoid rate limits when installing GitHub-based skills. |
| `SKILLAPT_ANTIGRAVITY_DIR` | *(none)* | Overrides the target directory path for the `antigravity` target. |

---

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
Uninstalls a skill from `.skills/`, prunes orphaned dependencies, and cleans up synced copies from agent targets.
```bash
skillapt remove <skill-name>
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
- Extension allowlist (`.md`, `.txt`, `.json`, `.yaml`, `.html`, `.css`, `.xml`, `.xsd`, `.svg`, `.png`, `.jpg`, `.pdf`, and extensionless `LICENSE`, `NOTICE`, `README`, `Makefile`).
- Rejects prohibited binaries (`.exe`, `.dll`, `.so`) and inspects magic bytes (ELF, Mach-O, Windows PE, Java class).
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
- Node.js runtime version (>= 20.0.0)
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

## 🛠️ Development & Testing

```bash
# Clone repository
git clone https://github.com/Ankur17nith/skillapt.git
cd skillapt

# Install dependencies
npm install

# Run type check
npm run typecheck

# Run test suite (fully mocked e2e, no live GitHub calls)
npm test

# Build production bundle
npm run build
```

---

## 📄 License

MIT © [Ankur Gupta](https://github.com/Ankur17nith)
