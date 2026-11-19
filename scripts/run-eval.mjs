// npm run eval: runs the golden-set evaluation (Module 5).
//   npm run eval                      the two-agent setup (what the app does)
//   npm run eval -- --agent single    one agent with every tool, no handoff
//   npm run eval -- --only price-home,error-c47    just those questions
// Needs GOOGLE_GENERATIVE_AI_API_KEY (and the LANGFUSE_* keys, to save scores)
// in .env.local. It sets the options as variables, so it works the same on
// Windows, macOS and Linux.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const agent = option("agent") ?? "multi";
if (!["multi", "single"].includes(agent)) {
  console.error('run-eval: --agent must be "multi" or "single".');
  process.exit(1);
}

const vitest = join(
  import.meta.dirname,
  "..",
  "node_modules",
  "vitest",
  "vitest.mjs",
);
const result = spawnSync(
  process.execPath,
  [vitest, "run", "--config", "vitest.eval.config.mts"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      EVAL_AGENT: agent,
      ...(option("only") ? { EVAL_ONLY: option("only") } : {}),
      ...(option("run") ? { EVAL_RUN_ID: option("run") } : {}),
    },
  },
);
process.exit(result.status ?? 1);
