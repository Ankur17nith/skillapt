import { getRegistryUrl, validateRegistryUrl, PRODUCT_NAME } from "./config.js";
import { getVersion } from "./banner.js";
import { getAuthToken } from "./auth.js";
import { z } from "zod";

/** Maximum accepted size of a JSON/text response body from the registry. */
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/** Maximum number of redirects followed for a single request. */
export const MAX_REDIRECTS = 5;

// ── Response schemas (lenient: unknown fields are allowed, shape-critical fields are required) ──

const versionBase = {
  version: z.string(),
  sha256: z.string(),
  integrity: z.string().optional(),
  size: z.number().optional(),
  tarballUrl: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  yanked: z.boolean().optional(),
  status: z.string().optional(),
};
const versionDetailSchema = z.looseObject({ name: z.string(), ...versionBase });
const skillDetailSchema = z.looseObject({
  name: z.string(),
  latestVersion: z.string().nullable().optional(),
  versions: z.record(z.string(), z.looseObject(versionBase)),
});
const searchSchema = z.looseObject({
  skills: z.array(z.looseObject({ name: z.string() })),
  pagination: z.looseObject({}).optional(),
});
const userSchema = z.looseObject({ handle: z.string() });
const publishSchema = z.looseObject({ name: z.string(), version: z.string(), sha256: z.string() });

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
  integrity?: string;
  sha256: string;
  size: number;
  tarballUrl: string;
  dependencies: Record<string, string>;
  publishedAt: string;
  status?: "active" | "yanked" | "removed";
  yanked: boolean;
  removed?: boolean;
  removalReason?: string | null;
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
  integrity?: string;
  sha256: string;
  size: number;
  tarballUrl: string;
  dependencies: Record<string, string>;
  publishedAt: string;
  status?: "active" | "yanked" | "removed";
  yanked: boolean;
  removed?: boolean;
  removalReason?: string | null;
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

export interface HealthStatus {
  status: string;
  product: string;
  version: string;
  timestamp: string;
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

export class GoneError extends RegistryError {
  constructor(message: string = "Package version has been permanently removed.") {
    super(message, 410, "GONE");
    this.name = "GoneError";
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
    const rawUrl = options.baseUrl ?? getRegistryUrl();
    this.baseUrl = validateRegistryUrl(rawUrl).replace(/\/+$/, "");

    // SKILLAPT_TOKEN applies to the configured registry only
    const configuredOrigin = new URL(getRegistryUrl()).origin;
    const clientOrigin = new URL(this.baseUrl).origin;
    const envToken = clientOrigin === configuredOrigin ? process.env.SKILLAPT_TOKEN : undefined;

    this.token = options.token ?? envToken;
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
   * Search skills with query filters, sorting, and pagination (anonymous).
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
    return this.request<SearchSkillsResponse>(endpoint, { method: "GET", anonymous: true }, searchSchema);
  }

  /**
   * Retrieve full skill metadata including available versions (anonymous).
   */
  async getSkill(name: string): Promise<SkillDetail> {
    const encodedName = this.encodePackageName(name);
    return this.request<SkillDetail>(`/skills/${encodedName}`, { method: "GET", anonymous: true }, skillDetailSchema);
  }

  /**
   * Retrieve metadata for a specific skill version (anonymous).
   */
  async getSkillVersion(name: string, version: string): Promise<SkillVersionDetail> {
    const encodedName = this.encodePackageName(name);
    return this.request<SkillVersionDetail>(
      `/skills/${encodedName}/${encodeURIComponent(version)}`,
      { method: "GET", anonymous: true },
      versionDetailSchema
    );
  }

  /**
   * Download package tarball stream and return as ReadableStream along with expected sha256/etag if present (anonymous).
   */
  async downloadTarball(name: string, version: string): Promise<{
    stream: ReadableStream<Uint8Array>;
    etag?: string;
  }> {
    const encodedName = this.encodePackageName(name);
    const endpoint = `/skills/${encodedName}/-/${encodeURIComponent(version)}.tgz`;
    const res = await this.rawRequest(endpoint, { method: "GET", anonymous: true });

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
    const authToken = token ?? this.token ?? (await getAuthToken(this.baseUrl)) ?? undefined;
    if (!authToken) {
      throw new AuthError("Authentication required to publish skills. Run 'skillapt login' or set SKILLAPT_TOKEN.");
    }

    const formData = new FormData();
    const blob = new Blob([tarballBuffer as unknown as BlobPart], { type: "application/gzip" });
    formData.append("file", blob, "package.tar.gz");

    return this.request<PublishResponse>(
      "/skills",
      { method: "POST", body: formData, token: authToken, anonymous: false },
      publishSchema
    );
  }

  /**
   * Yank a skill version from discovery and resolution.
   */
  async yankSkill(name: string, version: string, reason?: string, token?: string): Promise<YankResponse> {
    const authToken = token ?? this.token ?? (await getAuthToken(this.baseUrl)) ?? undefined;
    if (!authToken) {
      throw new AuthError("Authentication required to yank skills. Run 'skillapt login' or set SKILLAPT_TOKEN.");
    }

    const encodedName = this.encodePackageName(name);
    return this.request<YankResponse>(`/skills/${encodedName}/${encodeURIComponent(version)}/yank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
      token: authToken,
      anonymous: false,
    });
  }

  /**
   * Get current authenticated user.
   */
  async getMe(token?: string): Promise<User> {
    const authToken = token ?? this.token ?? (await getAuthToken(this.baseUrl)) ?? undefined;
    if (!authToken) {
      throw new AuthError("Authentication required. Run 'skillapt login' or set SKILLAPT_TOKEN.");
    }

    return this.request<User>("/me", { method: "GET", token: authToken, anonymous: false }, userSchema);
  }

  /**
   * Create a new API token.
   */
  async createToken(name: string, token?: string): Promise<CreateTokenResponse> {
    const authToken = token ?? this.token ?? (await getAuthToken(this.baseUrl)) ?? undefined;
    if (!authToken) {
      throw new AuthError("Authentication required to create tokens. Run 'skillapt login' or set SKILLAPT_TOKEN.");
    }

    return this.request<CreateTokenResponse>("/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      token: authToken,
      anonymous: false,
    });
  }

  /**
   * List API tokens.
   */
  async listTokens(token?: string): Promise<{ tokens: TokenSummary[] }> {
    const authToken = token ?? this.token ?? (await getAuthToken(this.baseUrl)) ?? undefined;
    if (!authToken) {
      throw new AuthError("Authentication required to list tokens. Run 'skillapt login' or set SKILLAPT_TOKEN.");
    }

    return this.request<{ tokens: TokenSummary[] }>("/tokens", {
      method: "GET",
      token: authToken,
      anonymous: false,
    });
  }

  /**
   * Revoke an API token by ID.
   */
  async revokeToken(id: string, token?: string): Promise<{ message: string }> {
    const authToken = token ?? this.token ?? (await getAuthToken(this.baseUrl)) ?? undefined;
    if (!authToken) {
      throw new AuthError("Authentication required to revoke tokens. Run 'skillapt login' or set SKILLAPT_TOKEN.");
    }

    return this.request<{ message: string }>(`/tokens/${encodeURIComponent(id)}`, {
      method: "DELETE",
      token: authToken,
      anonymous: false,
    });
  }

  /**
   * Platform statistics (anonymous).
   */
  async getStats(): Promise<StatsResponse> {
    return this.request<StatsResponse>("/stats", { method: "GET", anonymous: true });
  }

  /**
   * Health status of registry service (anonymous).
   */
  async getHealth(): Promise<HealthStatus> {
    try {
      return await this.request<HealthStatus>("/health", { method: "GET", anonymous: true });
    } catch {
      // Fallback: if /health is not implemented on server, test reachability via /stats
      await this.getStats();
      return {
        status: "ok",
        product: PRODUCT_NAME,
        version: getVersion(),
        timestamp: new Date().toISOString(),
      };
    }
  }

  // ── Private HTTP Helpers ──

  private encodePackageName(name: string): string {
    return encodeURIComponent(name);
  }

  private async request<T>(
    path: string,
    options: RequestInit & { token?: string; anonymous?: boolean } = {},
    schema?: z.ZodType
  ): Promise<T> {
    const res = await this.rawRequest(path, options);
    const text = await readBodyLimited(res, MAX_RESPONSE_BYTES);
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new RegistryError(
        `Invalid JSON returned from registry (${res.status}): ${text.slice(0, 100)}`,
        res.status
      );
    }
    if (schema) {
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const where = parsed.error.issues[0]?.path.join(".") || "(root)";
        throw new RegistryError(
          `Unexpected response shape from registry for ${path} (invalid field: ${where}).`,
          res.status,
          "INVALID_RESPONSE"
        );
      }
    }
    return json as T;
  }

  private async rawRequest(
    path: string,
    options: RequestInit & { token?: string; anonymous?: boolean } = {}
  ): Promise<Response> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    // Never send Authorization on anonymous endpoints (search, info, tarball download)
    const token = options.anonymous
      ? undefined
      : (options.token ?? this.token ?? (await getAuthToken(this.baseUrl)) ?? undefined);

    const headers = new Headers(options.headers);
    headers.set("User-Agent", `${PRODUCT_NAME}/${getVersion()}`);
    headers.set("Accept", "application/json, application/gzip");

    if (!options.anonymous && token) {
      const requestOrigin = new URL(url).origin;
      const baseOrigin = new URL(this.baseUrl).origin;
      if (requestOrigin === baseOrigin) {
        headers.set("Authorization", `Bearer ${token}`);
      }
    }

    let lastError: Error | null = null;
    let attempt = 0;
    const maxAttempts = 1 + Math.max(0, this.retries);

    while (attempt < maxAttempts) {
      attempt++;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        let res: Response;
        try {
          res = await this.fetchFollowingRedirects(url, { ...options, headers, signal: controller.signal });
        } finally {
          clearTimeout(timeout);
        }

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

  /**
   * fetch() with manual, validated redirect handling:
   * - only GET/HEAD requests follow redirects;
   * - every hop must satisfy the registry URL policy (https, or http on localhost);
   * - the Authorization header is dropped as soon as the origin changes.
   */
  private async fetchFollowingRedirects(url: string, init: RequestInit): Promise<Response> {
    let currentUrl = url;
    let headers = new Headers(init.headers);
    for (let hop = 0; ; hop++) {
      const res = await fetch(currentUrl, { ...init, headers, redirect: "manual" });
      const location = res.headers.get("location");
      if (res.status < 300 || res.status >= 400 || res.status === 304 || !location) {
        return res;
      }
      await res.body?.cancel().catch(() => undefined);
      const method = (init.method ?? "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        throw new RegistryError(
          `Registry responded with an unexpected redirect (${res.status}) to a ${method} request.`,
          res.status
        );
      }
      if (hop >= MAX_REDIRECTS) {
        throw new RegistryError(`Too many redirects (more than ${MAX_REDIRECTS}) contacting registry.`, res.status);
      }
      const next = new URL(location, currentUrl).toString();
      try {
        validateRegistryUrl(next);
      } catch {
        throw new RegistryError(`Refusing to follow redirect to insecure or invalid URL: ${next}`, res.status);
      }
      if (new URL(next).origin !== new URL(currentUrl).origin) {
        headers = new Headers(headers);
        headers.delete("authorization");
      }
      currentUrl = next;
    }
  }

  private async handleErrorResponse(res: Response, url: string): Promise<never> {
    let errorCode = "UNKNOWN_ERROR";
    let errorMessage = `Registry request failed with status ${res.status}`;

    try {
      const text = await readBodyLimited(res, 64 * 1024);
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

    if (res.status === 410) {
      throw new GoneError(errorMessage);
    }

    throw new RegistryError(errorMessage, res.status, errorCode);
  }
}

/**
 * Read a response body as UTF-8 text, aborting if it exceeds maxBytes.
 */
export async function readBodyLimited(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new RegistryError(`Registry response too large (${declared} bytes, limit ${maxBytes}).`, res.status);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RegistryError(`Registry response too large (limit ${maxBytes} bytes).`, res.status);
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}
