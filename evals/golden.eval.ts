// `npm run eval` runs this: the golden-set evaluation. It needs real keys
// (Google and Langfuse), so it is not part of `npm test`.
//   EVAL_AGENT=multi|single   which agent setup to test (default multi)
//   EVAL_ONLY=id1,id2         run just those questions
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { runEval } from "@/evals/run-eval";
import { REQUIRED_PASS_RATE } from "@/evals/scoring";
import type { AgentMode } from "@/lib/copper/assistant/run";
import { isAiConfigured } from "@/lib/ai/call";
import {
  isLangfuseConfigured,
  langfuseBaseUrl,
} from "@/lib/observability/langfuse";

/**
 * Checks Langfuse is reachable before the long run, and says why if not.
 * It never prints the URL: this log is public, and the URL is a secret.
 */
async function checkLangfuse() {
  try {
    const base = new URL(langfuseBaseUrl()!);
    const res = await fetch(`${base.origin}/api/public/health`);
    if (!res.ok) throw new Error(`health check returned ${res.status}`);
  } catch (error) {
    const reason =
      (error as { cause?: { code?: string } }).cause?.code ??
      (error instanceof TypeError ? error.message : "unknown error");
    throw new Error(
      `Can't reach Langfuse (${reason}). Check the LANGFUSE_BASE_URL secret: it should look like https://us.cloud.langfuse.com`,
    );
  }
}

const mode = (
  process.env.EVAL_AGENT === "single" ? "single" : "multi"
) as AgentMode;
const runId =
  process.env.EVAL_RUN_ID ??
  new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

it(
  `golden set passes (${mode} agent)`,
  async () => {
    expect(isAiConfigured(), "GOOGLE_GENERATIVE_AI_API_KEY is not set").toBe(
      true,
    );
    if (process.env.CI)
      expect(isLangfuseConfigured(), "LANGFUSE_* keys are not set").toBe(true);

    if (isLangfuseConfigured()) await checkLangfuse();

    const report = await runEval(mode, runId, {
      only: process.env.EVAL_ONLY?.split(",").filter(Boolean),
    });

    mkdirSync("evals/results", { recursive: true });
    writeFileSync(
      `evals/results/${report.runName}.json`,
      JSON.stringify(report, null, 2),
    );
    console.table(
      report.rows.map((r) => ({
        id: r.id,
        grade: r.grade,
        tools: r.scores.tools,
        cite: r.scores.citation,
        passed: r.scores.passed ? "yes" : "NO",
        usd: Number(r.turn.costUsd.toFixed(5)),
        ms: r.turn.latencyMs,
        agents: r.agents.join(">"),
      })),
    );
    const s = report.summary;
    console.info(
      `[eval] ${report.runName}: ${s.passed}/${s.cases} passed (${(s.passRate * 100).toFixed(0)}%), ` +
        `avg $${s.avgCostUsd.toFixed(5)} and ${Math.round(s.avgLatencyMs)} ms per question`,
    );
    for (const r of report.rows.filter((r) => !r.scores.passed))
      console.warn(
        `[eval] FAILED ${r.id}: ${r.reasoning}\n  reply: ${r.reply}`,
      );

    expect(s.passRate).toBeGreaterThanOrEqual(REQUIRED_PASS_RATE);
  },
  20 * 60 * 1000,
);
