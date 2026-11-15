# Security Policy

`skillapt` installs content that AI agents trust (prompts, scripts, configuration), so we treat
security reports as a priority.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub:
**[Report a vulnerability](https://github.com/Ankur17nith/skillapt/security/advisories/new)**
(Security tab → *Advisories* → *Report a vulnerability*).

Please include:

- A description of the issue and its impact (what an attacker gains, who is affected).
- Steps to reproduce or a proof of concept (a crafted tarball, lockfile or manifest is ideal).
- The `skillapt` version (`skillapt --version`), Node.js version and operating system.

The same process applies to the sibling repositories
([skillapt-registry](https://github.com/Ankur17nith/skillapt-registry),
[skillapt-web](https://github.com/Ankur17nith/skillapt-web)); use that repository's *Security* tab.

### What to expect

| Step | Target |
| :--- | :--- |
| Acknowledgement | within 3 business days |
| Triage and severity assessment | within 7 days |
| Fix or mitigation plan | within 30 days for high/critical issues |
| Coordinated disclosure | after a fix is released; reporters are credited unless they prefer otherwise |

This is a volunteer-maintained project, so these are targets rather than guarantees.

## Supported versions

Only the latest minor release line receives security fixes.

| Version | Supported |
| :--- | :--- |
| `1.0.x` | ✅ |
| `< 1.0.0` | ❌ |

## Scope

In scope:

- Path traversal or arbitrary file write/delete via archives, manifests, lockfiles or skill names.
- Archive handling (symlinks, hardlinks, device files, decompression bombs, size/count limits).
- Integrity or lockfile bypass (installing content that does not match the recorded hash).
- Credential handling (token leakage, cross-origin token sending, insecure storage).
- Command injection, SSRF or unsafe redirects in the CLI.

Out of scope:

- Malicious *content* of a skill you chose to install (prompt injection in `SKILL.md`, a script an agent later runs).
  `skillapt` shows declared permissions and never runs scripts itself, but it cannot sandbox your agent.
- Permissions declared in `skill.json`: they are metadata for review, not an enforced sandbox.
- Vulnerabilities that require an already-compromised machine or an attacker-controlled `SKILLAPT_*` environment.
- Denial of service from unrealistically large inputs on your own machine.

## Security model summary

- **Integrity**: packages are verified with SHA-256 before extraction. This protects against corruption and
  registry-side tampering after publication; it is not an author signature.
- **Safe extraction**: bounded decompression (5 MB compressed, 25 MB uncompressed, 500 files, depth and
  path-length limits), no links/devices, path boundary assertions, content rules and magic-byte checks.
- **No script execution**: lifecycle scripts are never run during install.
- **Untrusted lockfiles and manifests**: `skills.json` and `skills.lock.json` are treated as untrusted input;
  recorded paths are only acted on inside known agent target directories.
- **Credentials**: tokens are stored with mode `0600`, bound to the registry origin, never sent over plain HTTP
  (except `localhost`) or to other origins (including across redirects), and never logged.
- **Transport**: HTTPS only for registries (HTTP only for localhost), response size limits and request timeouts.
