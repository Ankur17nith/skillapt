export interface BaseSource {
  type: "github" | "registry";
  raw: string;
}

export interface GitHubSource extends BaseSource {
  type: "github";
  owner: string;
  repo: string;
  ref: string | null;
  subpath: string | null;
}

export interface RegistrySource extends BaseSource {
  type: "registry";
  name: string;
  range: string | null;
}

export type SkillSource = GitHubSource | RegistrySource;

// Backward-compatible alias for existing code
export type ParsedSource = GitHubSource;

/**
 * Validate a package name according to the registry specification:
 * 3 to 50 characters, lowercase alphanumeric and hyphens.
 * May optionally have a scope prefix: @<scope>/<name> (scope 2 to 30 chars).
 */
export const REGISTRY_NAME_REGEX =
  /^(@[a-z0-9-]{2,30}\/)?[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

/**
 * Checks if a string is a valid registry package name.
 */
export function isValidRegistryName(name: string): boolean {
  return REGISTRY_NAME_REGEX.test(name);
}

/**
 * Regex for GitHub repository sources: owner/repo format.
 */
export const GITHUB_SOURCE_REGEX = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

/**
 * Checks if a string is a valid GitHub repository source (owner/repo).
 */
export function isValidGitHubSource(source: string): boolean {
  return GITHUB_SOURCE_REGEX.test(source);
}

/**
 * Type guard for GitHubSource
 */
export function isGitHubSource(source: SkillSource): source is GitHubSource {
  return source.type === "github";
}

/**
 * Type guard for RegistrySource
 */
export function isRegistrySource(source: SkillSource): source is RegistrySource {
  return source.type === "registry";
}

/**
 * Parse an input string into either a GitHubSource or a RegistrySource.
 *
 * Rules:
 *   - "name" or "name@range" or "@scope/name" or "@scope/name@range" -> RegistrySource
 *   - "user/repo", "user/repo@ref", "user/repo/subpath@ref", or github.com URL -> GitHubSource
 */
export function parseSource(input: string): SkillSource {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Skill source cannot be empty.");
  }

  // URL format (e.g. https://github.com/user/repo)
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return parseUrl(trimmed);
  }

  // Scoped registry package: @scope/name or @scope/name@range
  if (trimmed.startsWith("@")) {
    return parseScopedRegistrySource(trimmed);
  }

  // If it contains a slash, it's a GitHub shorthand (user/repo or user/repo/subpath)
  if (trimmed.includes("/")) {
    return parseGitHubShorthand(trimmed);
  }

  // Otherwise, it's an unscoped registry package: name or name@range
  return parseUnscopedRegistrySource(trimmed);
}

function parseUrl(input: string): GitHubSource {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid URL: "${input}"`);
  }

  if (url.hostname !== "github.com") {
    throw new Error(
      `Only GitHub URLs are supported. Got: "${url.hostname}"`
    );
  }

  // Remove leading and trailing slashes, then split
  const parts = url.pathname.replace(/^\//, "").replace(/\/$/, "").split("/");

  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid GitHub URL — expected at least user/repo. Got: "${input}"`
    );
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, "");

  if (parts.length === 2) {
    return {
      type: "github",
      owner,
      repo,
      ref: null,
      subpath: null,
      raw: input,
    };
  }

  if (parts[2] !== "tree") {
    throw new Error(
      `Invalid GitHub URL — expected /tree/<ref>/... after repo. Got: "${input}"`
    );
  }

  if (parts.length < 4 || !parts[3]) {
    throw new Error(
      `Invalid GitHub URL — missing ref after /tree/. Got: "${input}"`
    );
  }

  const ref = parts[3];
  const subpathParts = parts.slice(4).filter(Boolean);
  const subpath = subpathParts.length > 0 ? subpathParts.join("/") : null;

  return {
    type: "github",
    owner,
    repo,
    ref,
    subpath,
    raw: input,
  };
}

function parseGitHubShorthand(input: string): GitHubSource {
  let ref: string | null = null;
  let rest = input;

  const atIndex = input.lastIndexOf("@");
  if (atIndex > 0) {
    ref = input.slice(atIndex + 1);
    rest = input.slice(0, atIndex);
    if (!ref) {
      throw new Error(`Invalid source — empty ref after @. Got: "${input}"`);
    }
  }

  const parts = rest.split("/").filter(Boolean);

  if (parts.length < 2) {
    throw new Error(
      `Invalid skill source — expected "user/repo" format. Got: "${input}"`
    );
  }

  const validNameRe = /^[a-zA-Z0-9._-]+$/;
  const owner = parts[0];
  const repo = parts[1];

  if (!validNameRe.test(owner)) {
    throw new Error(`Invalid owner name: "${owner}"`);
  }
  if (!validNameRe.test(repo)) {
    throw new Error(`Invalid repo name: "${repo}"`);
  }

  const subpathParts = parts.slice(2);
  const subpath = subpathParts.length > 0 ? subpathParts.join("/") : null;

  return {
    type: "github",
    owner,
    repo,
    ref,
    subpath,
    raw: input,
  };
}

function parseScopedRegistrySource(input: string): RegistrySource {
  // e.g. @scope/name or @scope/name@^1.0.0
  const slashIndex = input.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(
      `Invalid scoped skill name — expected "@scope/name". Got: "${input}"`
    );
  }

  // Look for @ version delimiter after the scope slash
  const versionAtIndex = input.indexOf("@", slashIndex);
  let name: string;
  let range: string | null = null;

  if (versionAtIndex !== -1) {
    name = input.slice(0, versionAtIndex);
    range = input.slice(versionAtIndex + 1).trim();
    if (!range) {
      throw new Error(`Invalid source — empty version range after @. Got: "${input}"`);
    }
  } else {
    name = input;
  }

  if (!isValidRegistryName(name)) {
    throw new Error(
      `Invalid scoped package name "${name}". Scope must be 2-30 chars and name 3-50 lowercase alphanumeric and hyphens.`
    );
  }

  return {
    type: "registry",
    name,
    range: range || null,
    raw: input,
  };
}

function parseUnscopedRegistrySource(input: string): RegistrySource {
  // e.g. "pdf-summarizer" or "pdf-summarizer@^1.0.0"
  const atIndex = input.indexOf("@");
  let name: string;
  let range: string | null = null;

  if (atIndex !== -1) {
    name = input.slice(0, atIndex);
    range = input.slice(atIndex + 1).trim();
    if (!range) {
      throw new Error(`Invalid source — empty version range after @. Got: "${input}"`);
    }
  } else {
    name = input;
  }

  if (!isValidRegistryName(name)) {
    throw new Error(
      `Invalid package name "${name}". Names must be 3-50 lowercase alphanumeric characters and hyphens.`
    );
  }

  return {
    type: "registry",
    name,
    range: range || null,
    raw: input,
  };
}
