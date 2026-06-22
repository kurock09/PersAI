import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "@persai/types": path.resolve(__dirname, "../../packages/types/src/index.ts"),
      "@persai/runtime-contract": path.resolve(
        __dirname,
        "../../packages/runtime-contract/src/index.ts"
      )
    }
  },
  test: {
    environment: "jsdom",
    include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"]
  }
});
