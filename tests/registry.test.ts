import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  RegistryClient,
  NotFoundError,
  RateLimitError,
  AuthError,
  ForbiddenError,
  ConflictError,
  NetworkError,
} from "../src/lib/registry.js";
import { DEFAULT_REGISTRY_URL, PRODUCT_NAME } from "../src/lib/config.js";

describe("RegistryClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("uses default registry base URL when env is not set", () => {
    delete process.env.SKILLAPT_REGISTRY;
    const client = new RegistryClient();
    expect(client.getBaseUrl()).toBe(DEFAULT_REGISTRY_URL);
  });

  it("uses SKILLAPT_REGISTRY env var when set", () => {
    process.env.SKILLAPT_REGISTRY = "http://localhost:8787/v1";
    const client = new RegistryClient();
    expect(client.getBaseUrl()).toBe("http://localhost:8787/v1");
  });

  it("sends User-Agent and Authorization header with Bearer token", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ skills: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const client = new RegistryClient({
      baseUrl: "https://mock.registry/v1",
      token: "apt_live_test12345",
      retries: 0,
    });

    await client.searchSkills({ q: "pdf" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe("https://mock.registry/v1/skills?q=pdf");
    const headers = calledInit.headers as Headers;
    expect(headers.get("User-Agent")).toContain(PRODUCT_NAME);
    expect(headers.get("Authorization")).toBe("Bearer apt_live_test12345");
  });

  it("maps 404 response to NotFoundError with human-friendly message", async () => {
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "NOT_FOUND", message: "Skill 'nonexistent' does not exist." },
          }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const client = new RegistryClient({ baseUrl: "https://mock.registry/v1", retries: 0 });
    await expect(client.getSkill("nonexistent")).rejects.toThrow(NotFoundError);
    await expect(client.getSkill("nonexistent")).rejects.toThrow("Skill 'nonexistent' does not exist.");
  });

  it("maps 429 response to RateLimitError with retry-after value", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "RATE_LIMITED", message: "Rate limit exceeded. Please wait." },
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "30",
          },
        }
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const client = new RegistryClient({ baseUrl: "https://mock.registry/v1", retries: 0 });

    try {
      await client.getSkill("pdf-summarizer");
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfter).toBe(30);
    }
  });

  it("maps 401 response to AuthError", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "UNAUTHORIZED", message: "Invalid or expired token." },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const client = new RegistryClient({ baseUrl: "https://mock.registry/v1", retries: 0 });
    await expect(client.getMe("bad_token")).rejects.toThrow(AuthError);
  });

  it("maps 403 response to ForbiddenError", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "FORBIDDEN", message: "Not permitted to publish to this scope." },
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const client = new RegistryClient({ baseUrl: "https://mock.registry/v1", retries: 0 });
    await expect(client.publishSkill(new Uint8Array([1, 2, 3]), "token")).rejects.toThrow(ForbiddenError);
  });

  it("maps 409 response to ConflictError", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "CONFLICT", message: "Version 1.0.0 is immutable and already exists." },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const client = new RegistryClient({ baseUrl: "https://mock.registry/v1", retries: 0 });
    await expect(client.publishSkill(new Uint8Array([1, 2, 3]), "token")).rejects.toThrow(ConflictError);
  });

  it("retries on 5xx errors and succeeds if next attempt succeeds", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("Server Error", { status: 503 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: "pdf-summarizer",
            version: "1.0.0",
            sha256: "abc",
            size: 100,
            tarballUrl: "http://example.com/1.0.0.tgz",
            dependencies: {},
            publishedAt: "2026-11-01T00:00:00Z",
            yanked: false,
            permissions: { network: false, shell: false, filesystem: "none" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    const client = new RegistryClient({ baseUrl: "https://mock.registry/v1", retries: 1 });
    const versionInfo = await client.getSkillVersion("pdf-summarizer", "1.0.0");
    expect(versionInfo.version).toBe("1.0.0");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("wraps connection failures in friendly NetworkError", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:8787"));
    vi.stubGlobal("fetch", mockFetch);

    const client = new RegistryClient({ baseUrl: "http://127.0.0.1:8787/v1", retries: 0 });
    await expect(client.getSkill("test")).rejects.toThrow(NetworkError);
    await expect(client.getSkill("test")).rejects.toThrow("Failed to connect");
  });
});
