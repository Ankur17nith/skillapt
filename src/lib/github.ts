function getApiBase(): string {
  return process.env.SKILLAPT_GITHUB_API_BASE || "https://api.github.com";
}

function getCodeloadBase(): string {
  return process.env.SKILLAPT_GITHUB_CODELOAD_BASE || "https://codeload.github.com";
}

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

/**
 * Resolve a ref (branch, tag, SHA) to a full commit SHA.
 * If no ref is given, resolves the default branch's HEAD.
 */
export async function resolveRef(
  owner: string,
  repo: string,
  ref?: string | null
): Promise<string> {
  const commitRef = ref ?? "HEAD";
  const url = `${getApiBase()}/repos/${owner}/${repo}/commits/${encodeURIComponent(commitRef)}`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3.sha",
      "User-Agent": "skillapt",
      ...authHeaders(),
    },
  });

  if (res.status === 404) {
    const what = ref ? `ref "${ref}"` : "repository";
    throw new Error(
      `GitHub: ${what} not found for ${owner}/${repo}. Check that the repo exists and is public (or set GITHUB_TOKEN).`
    );
  }

  if (res.status === 403) {
    throw new Error(
      "GitHub API rate limit exceeded. Set a GITHUB_TOKEN environment variable to increase the limit."
    );
  }

  if (!res.ok) {
    throw new Error(
      `GitHub API error: ${res.status} ${res.statusText} for ${owner}/${repo}`
    );
  }

  const sha = (await res.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`GitHub returned an unexpected response (not a SHA).`);
  }

  return sha;
}

/**
 * Download a tarball for a specific commit SHA.
 * Returns the response body as a ReadableStream.
 */
export async function downloadTarball(
  owner: string,
  repo: string,
  sha: string
): Promise<ReadableStream<Uint8Array>> {
  const url = `${getCodeloadBase()}/${owner}/${repo}/tar.gz/${sha}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "skillapt",
      ...authHeaders(),
    },
  });

  if (res.status === 404) {
    throw new Error(`GitHub: tarball not found for ${owner}/${repo}@${sha}.`);
  }

  if (res.status === 403) {
    throw new Error(
      "GitHub API rate limit exceeded. Set a GITHUB_TOKEN environment variable to increase the limit."
    );
  }

  if (!res.ok) {
    throw new Error(
      `GitHub download error: ${res.status} ${res.statusText}`
    );
  }

  if (!res.body) {
    throw new Error("GitHub returned an empty response body.");
  }

  return res.body;
}
