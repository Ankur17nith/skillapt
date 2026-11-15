import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      // The CLI ships without a default registry (none is deployed yet); tests use a
      // placeholder origin. Tests that need the "unconfigured" state delete this variable.
      SKILLAPT_REGISTRY: "https://registry.skillapt.dev/v1",
    },
  },
});
