import { describe, it, expect } from "vitest";
import { getBanner, getVersion } from "../src/lib/banner.js";

describe("banner", () => {
  it("returns package version", () => {
    const version = getVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("contains skillpm and version in banner", () => {
    const banner = getBanner();
    expect(banner).toContain("skillpm");
    expect(banner).toContain(`v${getVersion()}`);
  });
});
