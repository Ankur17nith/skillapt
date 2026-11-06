export interface ParsedSource {
  owner: string;
  repo: string;
  ref: string | null;
  subpath: string | null;
}

/**
 * Parse a skill source string into its components.
 *
 * Supported formats:
 *   "user/repo"
 *   "user/repo@ref"            (branch, tag, or SHA)
 *   "user/repo/path/to/skill"
 *   "user/repo/path/to/skill@ref"
 *   "https://github.com/user/repo"
 *   "https://github.com/user/repo/tree/branch/path"
 */
export function parseSource(input: string): ParsedSource {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Skill source cannot be empty.");
  }

  // Try URL format first
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return parseUrl(trimmed);
  }

  // Shorthand format: user/repo, user/repo@ref, user/repo/subpath@ref
  return parseShorthand(trimmed);
}

function parseUrl(input: string): ParsedSource {
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

  // Remove leading slash and split: /user/repo/tree/branch/path
  const parts = url.pathname.replace(/^\//, "").replace(/\/$/, "").split("/");

  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid GitHub URL — expected at least user/repo. Got: "${input}"`
    );
  }

  const owner = parts[0];
  // Strip .git suffix from repo name
  const repo = parts[1].replace(/\.git$/, "");

  // Simple case: https://github.com/user/repo
  if (parts.length === 2) {
    return { owner, repo, ref: null, subpath: null };
  }

  // Must be /tree/<ref>/... format
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

  return { owner, repo, ref, subpath };
}

function parseShorthand(input: string): ParsedSource {
  // Split off @ref if present
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

  // Validate owner and repo (no weird characters)
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

  return { owner, repo, ref, subpath };
}
