import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    ssr: "src/index.ts",
    outDir: "build",
    emptyOutDir: true,
    minify: true,
    rolldownOptions: {
      output: {
        banner: "#!/usr/bin/env node",
      },
    },
  },
  ssr: {
    noExternal: true,
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
