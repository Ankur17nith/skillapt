import { describe, it, expect, afterEach, vi } from "vitest";
import { RegistryClient, MAX_REDIRECTS, readBodyLimited } from "../../src/lib/registry.js";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("A-16: registry client hardening", () => {
  it("refuses redirects to http:// on a non-local host", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://evil.example.com/x" } }))
    );
    const client = new RegistryClient({ baseUrl: "https://reg.example.com/v1", retries: 0 });
    await expect(client.getStats()).rejects.toThrow(/insecure or invalid URL/);
  });

  it("drops Authorization when a redirect crosses origins", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, auth: new Headers(init.headers).get("authorization") });
        if (calls.length === 1) {
          return new Response(null, { status: 302, headers: { location: "https://other.example.net/me" } });
        }
        return json({ id: "1", handle: "alice" });
      })
    );
    const client = new RegistryClient({ baseUrl: "https://reg.example.com/v1", token: "secret", retries: 0 });
    await client.getMe();
    expect(calls[0].auth).toBe("Bearer secret");
    expect(calls[1].url).toBe("https://other.example.net/me");
    expect(calls[1].auth).toBeNull();
  });

  it("stops after too many redirects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => new Response(null, { status: 302, headers: { location: "https://reg.example.com/loop" } }))
    );
    const client = new RegistryClient({ baseUrl: "https://reg.example.com/v1", retries: 0 });
    await expect(client.getStats()).rejects.toThrow(new RegExp(`more than ${MAX_REDIRECTS}`));
  });

  it("rejects responses with an unexpected shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ unexpected: true })));
    const client = new RegistryClient({ baseUrl: "https://reg.example.com/v1", retries: 0 });
    await expect(client.getSkill("some-skill")).rejects.toThrow(/Unexpected response shape/);
  });

  it("rejects oversized bodies, declared or streamed", async () => {
    const declared = new Response("x", { headers: { "content-length": "999999999" } });
    await expect(readBodyLimited(declared, 1024)).rejects.toThrow(/too large/);
    const streamed = new Response("y".repeat(5000));
    await expect(readBodyLimited(streamed, 1024)).rejects.toThrow(/too large/);
  });
});
