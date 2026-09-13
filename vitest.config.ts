import { defineConfig } from "vitest/config";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";

/** Same component/hook-scoped compiler preset as vite.config.ts. */
function compilerPreset() {
  const preset = reactCompilerPreset();
  preset.rolldown.filter.code = /\/>|<\/|from\s*['"][^'"]*react/;
  return preset;
}
import path from "path";

export default defineConfig({
  plugins: [react(), babel({ presets: [compilerPreset()] })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Upstream this resolved through the workspace symlink npm creates for
      // `file:` deps, so it was never listed here. Aliasing it explicitly, the
      // way vite.config.ts already does, means the tests read the vendored
      // `apps/shared` in this repo rather than whatever npm happened to link.
      "@hermes/shared": path.resolve(__dirname, "./apps/shared/src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
