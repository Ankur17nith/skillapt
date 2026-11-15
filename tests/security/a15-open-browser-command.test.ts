import { describe, it, expect } from "vitest";
import { buildOpenCommand } from "../../src/lib/auth.js";

describe("A-15: browser launch never goes through a shell", () => {
  const evil = "https://example.com/login?a=1&calc.exe&b=2|whoami^x";

  it("uses rundll32 on Windows instead of cmd /c start", () => {
    const { cmd, args } = buildOpenCommand("win32", evil);
    expect(cmd).toBe("rundll32");
    expect(args).toEqual(["url.dll,FileProtocolHandler", evil]);
    expect(cmd.toLowerCase()).not.toContain("cmd");
  });

  it("passes the URL as a single argv entry on macOS and Linux", () => {
    expect(buildOpenCommand("darwin", evil)).toEqual({ cmd: "open", args: [evil] });
    expect(buildOpenCommand("linux", evil)).toEqual({ cmd: "xdg-open", args: [evil] });
  });
});
