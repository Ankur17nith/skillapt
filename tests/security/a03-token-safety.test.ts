import { describe, it, expect, vi } from "vitest";
import { validateRegistryUrl, PRODUCT_NAME } from "../../src/lib/config.js";
import { RegistryClient } from "../../src/lib/registry.js";

describe("A-03: Token safety and origin isolation", () => {
  it("rejects non-localhost plain http registry URLs", () => {
    expect(() => validateRegistryUrl("http://evil.example.com/v1")).toThrow(/must use HTTPS/i);
    expect(() => validateRegistryUrl("http://192.168.1.100/v1")).toThrow(/must use HTTPS/i);
    // Localhost is allowed for development
    expect(() => validateRegistryUrl("http://localhost:3000/v1")).not.toThrow();
    expect(() => validateRegistryUrl("http://127.0.0.1:4000/v1")).not.toThrow();
  });

  it("never sends authorization on anonymous endpoints", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ skills: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const client = new RegistryClient({
      baseUrl: "https://mock.registry/v1",
      token: "secret-token-xyz",
      retries: 0,
    });

    await client.searchSkills({ q: "pdf" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, calledInit] = mockFetch.mock.calls[0];
    const headers = calledInit.headers as Headers;
    expect(headers.get("User-Agent")).toContain(PRODUCT_NAME);
    expect(headers.get("Authorization")).toBeNull();

    vi.restoreAllMocks();
  });
});
