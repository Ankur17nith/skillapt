import { getRegistryUrl, PRODUCT_NAME } from "./config.js";
import { getVersion } from "./banner.js";
import { getAuthToken } from "./auth.js";

// ── Types from openapi.yaml & SPEC.md ──

export type Category =
  | "documents"
  | "coding"
  | "research"
  | "data"
  | "devtools"
  | "communication"
  | "productivity"
  | "other";

export interface Permissions {
  network: boolean;
  shell: boolean;
  filesystem: "none" | "read" | "write" | "read-write";
}

export interface User {
  id: string;
  handle: string;
  name: string;
  email: string;
  avatarUrl: string;
  createdAt: string;
}

export interface TokenSummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
}

export interface CreateTokenResponse {
  id: string;
  name: string;
  token: string;
  createdAt: string;
  warning: string;
}

export interface SkillSummary {
  name: string;
  latestVersion: string;
  description: string;
  license: string;
  category: Category;
  compatibility: string[];
  downloads: number;
  verified: boolean;
  owner: {
    handle: string;
    avatarUrl: string;
  };
  updatedAt: string;
}

export interface SkillVersionSummary {
  version: string;
  sha256: string;
  size: number;
  tarballUrl: string;
  dependencies: Record<string, string>;
  publishedAt: string;
  yanked: boolean;
  permissions: Permissions;
}

export interface SkillDetail {
  name: string;
  description: string;
  license: string;
  repository?: string;
  keywords?: string[];
  category: Category;
  compatibility: string[];
  owner: {
    handle: string;
    avatarUrl: string;
  };
  latestVersion: string;
  downloads: number;
  versions: Record<string, SkillVersionSummary>;
  readme?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillVersionDetail {
  name: string;
  version: string;
  sha256: string;
  size: number;
  tarballUrl: string;
  dependencies: Record<string, string>;
  publishedAt: string;
  yanked: boolean;
  permissions: Permissions;
}

export interface PublishResponse {
  name: string;
  version: string;
  sha256: string;
  size: number;
  tarballUrl: string;
  message: string;
}

export interface YankResponse {
  name: string;
  version: string;
  yanked: boolean;
  message: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SearchSkillsResponse {
  skills: SkillSummary[];
  pagination: Pagination;
}

export interface SearchSkillsOptions {
  q?: string;
  category?: Category | string;
  compat?: string;
  verified?: boolean;
  sort?: "downloads" | "recent" | "name";
  page?: number;
  limit?: number;
}

export interface StatsResponse {
  totalSkills: number;
  totalVersions: number;
  totalDownloads: number;
  totalAuthors: number;
}

// ── Registry Error Classes ──

export class RegistryError extends Error {
  code: string;
  status: number;

  constructor(message: string, status: number, code: string = "REGISTRY_ERROR") {
    super(message);
    this.name = "RegistryError";
    this.status = status;
    this.code = code;
  }
}

export class NotFoundError extends RegistryError {
  constructor(message: string = "Resource not found on registry.") {
    super(message, 404, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends RegistryError {
  retryAfter: number;

  constructor(retryAfter: number = 60, message?: string) {
    super(
      message ?? `Rate limit exceeded. Please wait ${retryAfter} seconds before retrying.`,
      429,
      "RATE_LIMITED"
    );
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class AuthError extends RegistryError {
  constructor(message: string = "Authentication required or token is invalid.") {
    super(message, 401, "UNAUTHORIZED");
    this.name = "AuthError";
  }
}

export class ForbiddenError extends RegistryError {
  constructor(message: string = "You do not have permission to perform this action.") {
    super(message, 403, "FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends RegistryError {
  constructor(message: string = "Version already exists and is immutable.") {
    super(message, 409, "CONFLICT");
    this.name = "ConflictError";
  }
}

export class NetworkError extends Error {
  url: string;

  constructor(message: string, url: string) {
    super(`Network error: ${message}`);
    this.name = "NetworkError";
    this.url = url;
  }
}

// ── Registry Client Implementation ──

export interface RegistryClientOptions {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  retries?: number;
}

export class RegistryClient {
  private baseUrl: string;
  private token?: string;
  private timeoutMs: number;
  private retries: number;

  constructor(options: RegistryClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? getRegistryUrl()).replace(/\/+$/, "");
    this.token = options.token ?? process.env.SKILLAPT_TOKEN;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.retries = options.retries ?? 2;
  }

  setToken(token: string | undefined): void {
    this.token = token;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Search skills with query filters, sorting, and pagination.
   */
  async searchSkills(options: SearchSkillsOptions = {}): Promise<SearchSkillsResponse> {
    const params = new URLSearchParams();
    if (options.q) params.set("q", options.q);
    if (options.category) params.set("category", options.category);
    if (options.compat) params.set("compat", options.compat);
    if (options.verified !== undefined) params.set("verified", String(options.verified));
    if (options.sort) params.set("sort", options.sort);
    if (options.page !== undefined) params.set("page", String(options.page));
    if (options.limit !== undefined) params.set("limit", String(options.limit));

    const qs = params.toString();
    const endpoint = `/skills${qs ? `?${qs}` : ""}`;
    return this.request<SearchSkillsResponse>(endpoint, { method: "GET" });
  }

  /**
   * Retrieve full skill metadata including available versions.
   */
  async getSkill(name: string): Promise<SkillDetail> {
    const encodedName = this.encodePackageName(name);
    return this.request<SkillDetail>(`/skills/${encodedName}`, { method: "GET" });
  }

  /**
   * Retrieve metadata for a specific skill version.
   */
  async getSkillVersion(name: string, version: string): Promise<SkillVersionDetail> {
    const encodedName = this.encodePackageName(name);
    return this.request<SkillVersionDetail>(`/skills/${encodedName}/${encodeURIComponent(version)}`, {
      method: "GET",
    });
  }

  /**
   * Download package tarball stream and return as ReadableStream along with expected sha256/etag if present.
   */
  async downloadTarball(name: string, version: string): Promise<{
    stream: ReadableStream<Uint8Array>;
    etag?: string;
  }> {
    const encodedName = this.encodePackageName(name);
    const endpoint = `/skills/${encodedName}/-/${encodeURIComponent(version)}.tgz`;
    const res = await this.rawRequest(endpoint, { method: "GET" });

    if (!res.body) {
      throw new RegistryError("Registry returned an empty response body.", res.status);
    }

    const etag = res.headers.get("etag")?.replace(/^W\//, "").replace(/"/g, "");
    return {
      stream: res.body,
      etag: etag || undefined,
    };
  }

  /**
   * Publish a .tar.gz archive.
   */
  async publishSkill(tarballBuffer: Uint8Array, token?: string): Promise<PublishResponse> {
    const authToken = token ?? this.token;
    if (!authToken) {
      throw new AuthError("Authentication required to publish skills. Run 'skillapt login' or set SKILLAPT_TOKEN.");
    }

    const formData = new FormData();
    const blob = new Blob([tarballBuffer as unknown as BlobPart], { type: "application/gzip" });
    formData.append("file", blob, "package.tar.gz");

    return this.request<PublishResponse>("/skills", {
      method: "POST",
      body: formData,
      token: authToken,
    });
  }

  /**
   * Yank a skill version from discovery and resolution.
   */
  async yankSkill(name: string, version: string, reason?: string, token?: string): Promise<YankResponse> {
    const authToken = token ?? this.token;
    if (!authToken) {
      throw new AuthError("Authentication required to yank skills. Run 'skillapt login' or set SKILLAPT_TOKEN.");
    }

    const encodedName = this.encodePackageName(name);
    return this.request<YankResponse>(`/skills/${encodedName}/${encodeURIComponent(version)}/yank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
      token: authToken,
    });
  }

  /**
   * Get current authenticated user.
   */
  async getMe(token?: string): Promise<User> {
    const authToken = token ?? this.token;
    if (!authToken) {
      throw new AuthError("Authentication required. Run 'skillapt login' or set SKILLAPT_TOKEN.");
    }

    return this.request<User>("/me", {
      method: "GET",
      token: authToken,
    });
  }

  /**
   * Create a new API token.
   */
  async createToken(name: string, token?: string): Promise<CreateTokenResponse> {
    const authToken = token ?? this.token;
    if (!authToken) {
      throw new AuthError("Authentication required to create tokens. Run 'skillapt login' or set SKILLAPT_TOKEN.");
    }

    return this.request<CreateTokenResponse>("/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      token: authToken,
    });
  }

  /**
   * List API tokens.
   */
  async listTokens(token?: string): Promise<{ tokens: TokenSummary[] }> {
    const authToken = token ?? this.token;
    if (!authToken) {
      throw new AuthError("Authentication required to list tokens. Run 'skillapt login' or set SKILLAPT_TOKEN.");
    }

    return this.request<{ tokens: TokenSummary[] }>("/tokens", {
      method: "GET",
      token: authToken,
    });
  }

  /**
   * Revoke an API token by ID.
   */
  async revokeToken(id: string, token?: string): Promise<{ message: string }> {
    const authToken = token ?? this.token;
    if (!authToken) {
      throw new AuthError("Authentication required to revoke tokens. Run 'skillapt login' or set SKILLAPT_TOKEN.");
    }

    return this.request<{ message: string }>(`/tokens/${encodeURIComponent(id)}`, {
      method: "DELETE",
      token: authToken,
    });
  }

  /**
   * Platform statistics.
   */
  async getStats(): Promise<StatsResponse> {
    return this.request<StatsResponse>("/stats", { method: "GET" });
  }

  // ── Private HTTP Helpers ──

  private encodePackageName(name: string): string {
    // If scoped (e.g. @acme/foo), openapi specifies URL encoded or raw:
    // Encode slash as %2F if scoped, or let router handle:
    if (name.startsWith("@")) {
      return encodeURIComponent(name);
    }
    return encodeURIComponent(name);
  }

  private async request<T>(
    path: string,
    options: RequestInit & { token?: string } = {}
  ): Promise<T> {
    const res = await this.rawRequest(path, options);
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new RegistryError(
        `Invalid JSON returned from registry (${res.status}): ${text.slice(0, 100)}`,
        res.status
      );
    }
    return json as T;
  }

  private async rawRequest(
    path: string,
    options: RequestInit & { token?: string } = {}
  ): Promise<Response> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const token = options.token ?? this.token ?? (await getAuthToken()) ?? undefined;

    const headers = new Headers(options.headers);
    headers.set("User-Agent", `${PRODUCT_NAME}/${getVersion()}`);
    headers.set("Accept", "application/json, application/gzip");

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    let lastError: Error | null = null;
    let attempt = 0;
    const maxAttempts = 1 + Math.max(0, this.retries);

    while (attempt < maxAttempts) {
      attempt++;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        const res = await fetch(url, {
          ...options,
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        // Retry on 5xx server errors
        if (res.status >= 500 && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, attempt * 200));
          continue;
        }

        // Handle error status codes with friendly exceptions
        if (!res.ok) {
          await this.handleErrorResponse(res, url);
        }

        return res;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // If it's already a RegistryError, don't wrap it or retry unless 5xx
        if (err instanceof RegistryError) {
          throw err;
        }

        // Check if aborted via timeout
        if (lastError.name === "AbortError") {
          throw new NetworkError(
            `Connection timed out after ${this.timeoutMs}ms while contacting ${url}`,
            url
          );
        }

        // Retry on fetch/network failures if attempts left
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, attempt * 200));
          continue;
        }

        throw new NetworkError(
          `Failed to connect to ${PRODUCT_NAME} registry at ${this.baseUrl}: ${lastError.message}`,
          url
        );
      }
    }

    throw lastError ?? new NetworkError(`Request failed after ${maxAttempts} attempts.`, url);
  }

  private async handleErrorResponse(res: Response, url: string): Promise<never> {
    let errorCode = "UNKNOWN_ERROR";
    let errorMessage = `Registry request failed with status ${res.status}`;

    try {
      const text = await res.text();
      if (text) {
        const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
        if (parsed.error) {
          errorCode = parsed.error.code ?? errorCode;
          errorMessage = parsed.error.message ?? errorMessage;
        } else {
          errorMessage = text.slice(0, 200);
        }
      }
    } catch {
      // Body not JSON
    }

    if (res.status === 404) {
      throw new NotFoundError(errorMessage);
    }

    if (res.status === 429) {
      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) || 60 : 60;
      throw new RateLimitError(retryAfter, errorMessage);
    }

    if (res.status === 401) {
      throw new AuthError(errorMessage);
    }

    if (res.status === 403) {
      throw new ForbiddenError(errorMessage);
    }

    if (res.status === 409) {
      throw new ConflictError(errorMessage);
    }

    throw new RegistryError(errorMessage, res.status, errorCode);
  }
}
