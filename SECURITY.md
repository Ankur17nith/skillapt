# Security Policy

## Reporting Security Vulnerabilities

The `skillapt` project takes the security of AI agent skill distribution seriously. If you discover a vulnerability or security issue, please report it privately.

**Email**: [security@skillapt.dev](mailto:security@skillapt.dev)

Alternatively, you can open a private draft security advisory via [GitHub Security Advisories](https://github.com/Ankur17nith/skillapt/security/advisories/new).

Please include:
- A detailed description of the vulnerability.
- Steps to reproduce or proof-of-concept exploit.
- The potential impact on users, workspaces, or agent target directories.

### Response Timeline
- **Initial Response**: Within 48 hours acknowledging receipt of the report.
- **Triage & Assessment**: Within 5 business days with severity rating and remediation plan.
- **Fix & Disclosure**: Coordinated public release and advisory once a patch is tested and verified.

---

## Supported Versions

| Version | Supported |
| :--- | :--- |
| `0.1.x` | :white_check_mark: |
| `< 0.1.0` | :x: |

---

## Security Model & Threat Model Summary

- **Integrity**: Skill packages are verified with SHA-256 before extraction. Note that SHA-256 provides integrity against the hash published in the registry/lockfile; it is not a cryptographic author signature.
- **Path Traversal Protection**: Archive paths are checked to prevent writing outside target directories (resolving paths, checking boundaries, blocking path traversal segments `..`, absolute paths, symlinks).
- **Execution**: The CLI never executes lifecycle scripts (such as `postinstall`) automatically during installation.
- **Permission Declarations**: Manifest permissions (`network`, `shell`, `filesystem`) are metadata declarations for user confirmation, not runtime sandbox enforcement. Agent runtimes are responsible for runtime isolation.
