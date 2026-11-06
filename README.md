# skillpm

A package manager for AI agent skills. Like npm, but for skills.

Skills are folders containing a `SKILL.md` file (instructions for an AI agent), optionally with a `skill.json` manifest and helper scripts. Skills live in GitHub repos.

## Install

```bash
# Use directly with npx
npx skillpm install user/repo

# Or install globally
npm install -g skillpm
```

**Requires Node.js 20+**

## Commands

### `skillpm init`

Create a `skills.json` in the current folder:

```bash
skillpm init
```

### `skillpm install <source>`

Install a skill from GitHub:

```bash
# From a repo
skillpm install user/repo

# From a specific branch or tag
skillpm install user/repo@v1.0

# From a subfolder in a repo
skillpm install user/repo/skills/my-skill

# From a full GitHub URL
skillpm install https://github.com/user/repo

# From a tree URL (branch + path)
skillpm install https://github.com/user/repo/tree/main/skills/my-skill
```

### `skillpm install`

Install all skills listed in `skills.json`:

```bash
skillpm install
```

When a `skills.lock.json` exists, installs the exact locked versions.

### `skillpm remove <name>`

Remove an installed skill:

```bash
skillpm remove my-skill
```

### `skillpm list`

Show all installed skills:

```bash
skillpm list
```

Displays a table with name, source, commit SHA, and description.

## Global Options

| Option | Description |
|---|---|
| `--version` | Show version number |
| `--dir <path>` | Change the skills install directory (default: `.skills`) |
| `--debug` | Show full stack traces on error |
| `--help` | Show help |

## File Formats

### `skills.json`

Tracks which skills you've installed:

```json
{
  "skills": {
    "my-skill": {
      "source": "user/repo",
      "ref": "main"
    }
  }
}
```

### `skills.lock.json`

Locks exact versions (commit SHAs) for reproducible installs:

```json
{
  "skills": {
    "my-skill": {
      "source": "user/repo",
      "sha": "abc123def456789..."
    }
  }
}
```

## Making a Repo Installable

Your repo just needs a `SKILL.md` file at the root (or in a subfolder). Optionally add a `skill.json`:

```json
{
  "name": "my-skill",
  "description": "What this skill does"
}
```

### Minimum structure

```
my-skill/
├── SKILL.md          # Required — instructions for the AI agent
├── skill.json        # Optional — name and description
└── scripts/          # Optional — helper scripts
```

## Authentication

For private repos or to avoid GitHub API rate limits, set:

```bash
export GITHUB_TOKEN=ghp_your_token_here
```

## Security

skillpm includes several security protections:

- **No symlinks** — symlinks in tarballs are rejected
- **No path traversal** — `../` and absolute paths in tar entries are blocked
- **Sandboxed extraction** — skills are extracted to a temp folder first, validated, then moved
- **Name validation** — skill names cannot contain path traversal characters

## Roadmap

- 🔍 **Search** — find skills by keyword
- 📦 **Publish** — publish skills to a registry
- 🗂️ **Registry** — central skill registry
- 🛡️ **Safety scanning** — audit skills for malicious content
- 🔄 **Update** — update skills to latest versions
- 📋 **Info** — show detailed skill information

## License

MIT
