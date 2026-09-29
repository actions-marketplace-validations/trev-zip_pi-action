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
        // escape non-ascii characters so renovate doesn't flag hidden unicode in the bundle
        minify: { codegen: { asciiOnly: true } },
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
