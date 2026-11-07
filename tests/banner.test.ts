import { describe, it, expect } from "vitest";
import { getBanner, getVersion } from "../src/lib/banner.js";
import { PRODUCT_NAME } from "../src/lib/config.js";

describe("banner", () => {
  it("returns package version", () => {
    const version = getVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("contains product name and version in banner", () => {
    const banner = getBanner();
    expect(banner).toContain(PRODUCT_NAME);
    expect(banner).toContain(`v${getVersion()}`);
  });
});
