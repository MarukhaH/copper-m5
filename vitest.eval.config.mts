// Settings for `npm run eval`: the golden-set evaluation. Separate from the
// unit tests because it calls real models and needs the keys from .env.local.
import { defineConfig, loadEnv } from "vite";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["evals/**/*.eval.ts"],
    env: loadEnv("test", process.cwd(), ""),
    fileParallelism: false,
  },
});
