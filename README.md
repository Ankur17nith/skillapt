# skillapt

**A secure, independent package manager and registry for AI agent skills.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](https://nodejs.org/)

`skillapt` is completely independent of npm. It discovers, resolves, installs, locks, packs, and publishes AI agent skills (for Claude, Cursor, Codex, Antigravity, and custom LLM frameworks) backed by our dedicated registry and GitHub sources.

---

## ⚡ Installation

### Via Shell Script (Recommended)
```bash
curl -fsSL https://raw.githubusercontent.com/Ankur17nith/skillapt/main/install.sh | bash
```

### Via npm / npx
```bash
# Run directly with npx
npx skillapt install pdf-summarizer

# Or install globally
npm install -g skillapt
```

> **Requirement**: Node.js **20.0.0** or higher.

---

## 🚀 Quick Start

```bash
# 1. Initialize a new skill package
skillapt init --name my-custom-skill

# 2. Search for existing skills in the registry
skillapt search summarizer

# 3. Install a skill by name (SemVer resolved with dependencies)
skillapt install pdf-summarizer

# 4. Sync installed skills directly to your AI agent environment
skillapt install pdf-summarizer --target claude

# 5. Check your setup health
skillapt doctor
```

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
Installs agent skills from the official registry or GitHub repositories.

#### Registry Source (`name[@range]`)
```bash
# Install latest non-yanked version
skillapt install pdf-summarizer

# Install with SemVer range
skillapt install "pdf-summarizer@^1.2.0"
skillapt install "pdf-summarizer@~1.1.0"

# Install pinned exact version
skillapt install pdf-summarizer@1.2.3

# Install scoped package
skillapt install "@alice/pdf-tool@^2.0.0"
```

#### GitHub Source (`user/repo[@ref][/subpath]`)
```bash
# Install from default branch
skillapt install user/repo

# Install specific tag or commit
skillapt install user/repo@v1.0.0

# Install subfolder containing a skill
skillapt install user/repo/skills/summarizer

# Install from full URL
skillapt install https://github.com/user/repo/tree/main/skills/my-skill
```

#### Agent Target Synchronization (`--target`)
Automatically symlinks or copies installed skills into your AI agent's skills folder so the agent can discover the prompt guide immediately:
```bash
# Sync to Claude (.claude/skills)
skillapt install pdf-summarizer --target claude

# Sync to Cursor (.cursor/skills)
skillapt install pdf-summarizer --target cursor

# Sync to Codex (.codex/skills)
skillapt install pdf-summarizer --target codex

# Sync to user's global home directory (~/.claude/skills)
skillapt install pdf-summarizer --target claude --global
```

#### Deterministic & CI Installs (`--frozen`)
```bash
# Installs all skills declared in skills.json
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
skillapt info pdf-summarizer
skillapt info pdf-summarizer --json
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
skillapt update pdf-summarizer
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
Uninstalls a skill from `.skills/` and removes it from `skills.json` and `skills.lock.json`.
```bash
skillapt remove pdf-summarizer
```

---

### `skillapt login` & `skillapt logout`
Authenticates with the registry via browser OAuth or manual API token.
```bash
# Opens browser to authorize via GitHub
skillapt login

# Authenticate with personal access token directly
skillapt login --token apt_live_abcdef123456...

# Remove stored token
skillapt logout
```
Tokens are saved securely in OS config (`~/.config/skillapt/config.json`) with file mode `0600` (directory mode `0700`). You can also provide the token via the `SKILLAPT_TOKEN` environment variable. Tokens are never printed in logs or terminal output.

---

### `skillapt pack [dir]`
Validates files and builds a distribution `.tar.gz` archive.
```bash
skillapt pack
skillapt pack ./my-skill --out ./dist
skillapt pack --json
```
Strictly enforces:
- Valid `skill.json` and `SKILL.md` YAML frontmatter matching package name.
- Allowed file extension allow-list (documents, prompts, templates, scripts, config).
- Prohibits executable binaries (`.exe`, `.dll`, `.so`, ELF/Mach-O/PE magic bytes).
- Limits: 500 files, 255-char path length, 25 MB uncompressed, 5 MB compressed.

---

### `skillapt publish [target]`
Publishes a skill package or archive to the registry.
```bash
# Pack and publish current directory
skillapt publish

# Publish pre-built tarball
skillapt publish ./dist/my-skill-1.0.0.tgz
```

---

### `skillapt yank <spec>`
Marks a published version as yanked so range queries skip it.
```bash
skillapt yank my-skill@1.0.1 --reason "Fixed security regression in 1.0.2"
```

---

### `skillapt doctor`
Runs comprehensive system diagnostics.
```bash
skillapt doctor
```
Checks:
- Node.js runtime version ($\ge 20.0.0$)
- Registry server reachability (`/health` and `/stats`)
- Authentication token validity (`/v1/me`)
- Skills directory permissions

---

## 📦 Package Format Specification

Every skill package contains:

```text
my-skill/
├── skill.json       # Required: Package manifest
├── SKILL.md         # Required: Agent documentation and prompt guide
└── ...              # Optional: Helper templates, prompts, scripts, data
```

### `skill.json`
```json
{
  "name": "pdf-summarizer",
  "version": "1.0.0",
  "description": "Extracts text from PDF documents and generates structured agent summaries.",
  "license": "MIT",
  "category": "documents",
  "compatibility": ["claude", "cursor", "codex"],
  "dependencies": {
    "text-cleaner": "^1.0.0"
  },
  "permissions": {
    "network": false,
    "shell": false,
    "filesystem": "read"
  }
}
```

### `SKILL.md` (Agent Skills Open Standard)
Must begin with YAML frontmatter demarcated by triple dashes (`---`):
```markdown
---
name: pdf-summarizer
description: Extracts text from PDF documents and generates structured agent summaries.
category: documents
version: 1.0.0
---

# PDF Summarizer Skill

## Capabilities
- Reads text and metadata from PDF files.
- Generates section-by-section summaries.

## Usage Guidelines
When the user asks to summarize a PDF document...
```

---

## 🔒 Security Posture & Safe Extraction Rules

1. **Zero Execution**: The package manager never executes lifecycle scripts from downloaded skills (`postinstall`, etc.).
2. **SHA-256 Integrity Verification**: Cryptographic checksum is computed and validated *before* unpacking any archive.
3. **Decompression Bomb Protection**: Streaming decompression aborts immediately if cumulative uncompressed size exceeds 25 MB.
4. **Strict Path Traversal Prevention**: Tarball extraction rejects:
   - Any path segment containing `..`
   - Absolute paths (leading `/`, `\`, or Windows drive letters)
   - Symlinks, hardlinks, character devices, FIFOs
   - Paths exceeding 255 characters
5. **Magic Byte Inspection**: Prevents disguised binaries (ELF, PE, Mach-O, Java class) even if given a `.txt` or `.py` extension.

---

## 🛠️ Development & Testing

```bash
# Clone repository
git clone https://github.com/Ankur17nith/skillapt.git
cd skillapt

# Install development dependencies
npm install

# Run type check
npm run typecheck

# Run test suite
npm test

# Build production bundle
npm run build
```

---

## 📄 License

MIT © [Ankur Gupta](https://github.com/Ankur17nith)
