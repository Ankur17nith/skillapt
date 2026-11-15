import { describe, it, expect, vi } from "vitest";
import { execFile } from "node:child_process";
import { openBrowser } from "../../src/lib/auth.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (
      file: string,
      args: string[],
      cb: (err: Error | null, stdout: string, stderr: string) => void
    ) => {
      cb(null, "", "");
    }
  ),
}));

describe("A-04: Shell command injection safety", () => {
  it("rejects non-https URLs in openBrowser", async () => {
    expect(await openBrowser("http://example.com/login")).toBe(false);
    expect(await openBrowser("file:///etc/passwd")).toBe(false);
    expect(await openBrowser("javascript:alert(1)")).toBe(false);
  });

  it("passes URLs with command injection attempts as argument array to execFile, without shell execution", async () => {
    vi.mocked(execFile).mockClear();
    const maliciousUrl = 'https://registry.skillapt.dev/auth?q=$(touch /tmp/pwned)"';
    const success = await openBrowser(maliciousUrl);

    expect(success).toBe(true);
    expect(execFile).toHaveBeenCalled();
    const [, calledArgs] = vi.mocked(execFile).mock.calls[0];
    expect(Array.isArray(calledArgs)).toBe(true);
    expect(calledArgs).toContain(maliciousUrl);
  });
});
