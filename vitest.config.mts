import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // One jsdom fork per core ran the WSL machine (28 cores, 16 GB) out of memory: forks crashed at start (SIGTRAP)
    // and test files were silently skipped. Half the cores is stable and no slower.
    maxWorkers: "50%",
  },
});
