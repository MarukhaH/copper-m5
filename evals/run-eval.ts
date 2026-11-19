// Runs the golden set against one way of building the agent and records
// everything in Langfuse (Module 5).
//
//   1. The golden set is saved to Langfuse as a dataset ("copper-golden-set").
//   2. Each question goes through the agent (a traced "task").
//   3. The AI judge and the tool/citation checks score the answer; the scores
//      are saved on that question's trace.
//   4. The run's totals (pass rate, average cost and time) are saved on the run.
// Runs of "multi" and "single" are listed side by side under the dataset's
// Runs tab, so you can compare them.
import { LangfuseClient } from "@langfuse/client";
import goldenJson from "@/evals/golden-set.json";
import { judgeAnswer } from "@/evals/judge";
import {
  type CaseScores,
  type GoldenCase,
  scoreCase,
  summarize,
  type Summary,
} from "@/evals/scoring";
import { DEFAULT_LIMIT_USD, type Desk } from "@/lib/copper/orders";
import {
  type AgentMode,
  runTurn,
  type TurnResult,
} from "@/lib/copper/assistant/run";
import {
  flushTraces,
  isLangfuseConfigured,
  langfuseBaseUrl,
  startTracing,
} from "@/lib/observability/langfuse";

export const GOLDEN_SET = goldenJson as GoldenCase[];
export const DATASET_NAME = "copper-golden-set";

export type EvalRow = {
  id: string;
  category: string;
  question: string;
  reply: string;
  toolNames: string[];
  agents: string[];
  grade: number;
  reasoning: string;
  scores: CaseScores;
  turn: Pick<
    TurnResult,
    "inputTokens" | "outputTokens" | "costUsd" | "latencyMs"
  >;
};

export type EvalReport = {
  mode: AgentMode;
  runName: string;
  rows: EvalRow[];
  summary: Summary & {
    avgCostUsd: number;
    avgLatencyMs: number;
    avgTokens: number;
  };
};

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

function deskFor(golden: GoldenCase): Desk {
  return golden.desk ?? { limitUsd: DEFAULT_LIMIT_USD, refunds: [] };
}

async function ensureDataset(langfuse: LangfuseClient) {
  try {
    await langfuse.api.datasets.get(DATASET_NAME);
  } catch {
    await langfuse.api.datasets.create({
      name: DATASET_NAME,
      description: "Golden questions for Ask Copper and the Refund agent",
    });
  }
  // Items are upserted on id, so running this again changes nothing.
  for (const golden of GOLDEN_SET)
    await langfuse.api.datasetItems.create({
      datasetName: DATASET_NAME,
      id: `copper-golden-${golden.id}`,
      input: {
        id: golden.id,
        question: golden.question,
        desk: deskFor(golden),
      },
      expectedOutput: golden.expected,
      metadata: { category: golden.category },
    });
}

export async function runEval(
  mode: AgentMode,
  runId: string,
  { only }: { only?: string[] } = {},
): Promise<EvalReport> {
  const cases = GOLDEN_SET.filter((c) => !only?.length || only.includes(c.id));
  const byId = new Map(GOLDEN_SET.map((c) => [c.id, c]));
  const turns = new Map<string, TurnResult>();
  const rows = new Map<string, EvalRow>();
  const runName = `${mode}-${runId}`;
  const langfuse = isLangfuseConfigured()
    ? new LangfuseClient({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: langfuseBaseUrl(),
      })
    : undefined;
  startTracing();

  const task = async (item: { input?: unknown }) => {
    const input = item.input as { id: string; question: string; desk: Desk };
    const turn = await runTurn({
      messages: [{ role: "user", content: input.question }],
      desk: input.desk,
      mode,
    });
    turns.set(input.id, turn);
    return {
      reply: turn.reply,
      tools: turn.toolCalls.map((t) => t.name),
      agents: turn.agents,
      costUsd: turn.costUsd,
      latencyMs: turn.latencyMs,
      tokens: turn.inputTokens + turn.outputTokens,
    };
  };

  const evaluator = async ({ input }: { input: unknown }) => {
    const { id } = input as { id: string };
    const golden = byId.get(id)!;
    const turn = turns.get(id)!;
    const judged = await judgeAnswer(golden, turn.reply);
    const toolNames = turn.toolCalls.map((t) => t.name);
    const scores = scoreCase(golden, {
      reply: turn.reply,
      toolNames,
      grade: judged.grade,
    });
    rows.set(id, {
      id,
      category: golden.category,
      question: golden.question,
      reply: turn.reply,
      toolNames,
      agents: turn.agents,
      grade: judged.grade,
      reasoning: judged.reasoning,
      scores,
      turn: {
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
        costUsd: turn.costUsd,
        latencyMs: turn.latencyMs,
      },
    });
    return [
      {
        name: "correctness",
        value: scores.correctness,
        comment: judged.reasoning,
      },
      { name: "tools", value: scores.tools },
      { name: "citation", value: scores.citation },
      { name: "passed", value: scores.passed ? 1 : 0 },
    ];
  };

  if (langfuse) {
    await ensureDataset(langfuse);
    const dataset = await langfuse.dataset.get(DATASET_NAME);
    const wanted = new Set(cases.map((c) => `copper-golden-${c.id}`));
    dataset.items = dataset.items.filter((item) => wanted.has(item.id));
    await dataset.runExperiment({
      name: `Ask Copper golden set (${mode})`,
      runName,
      description:
        mode === "multi"
          ? "Copper hands refunds to the Refund agent"
          : "One agent with every tool and no handoff",
      metadata: { agents: mode },
      task,
      evaluators: [evaluator],
      maxConcurrency: 2,
      runEvaluators: [
        async ({ itemResults }) => {
          const passes = itemResults.map((r) =>
            r.evaluations.find((e) => e.name === "passed")?.value === 1 ? 1 : 0,
          );
          const outputs = itemResults.map(
            (r) =>
              r.output as {
                costUsd: number;
                latencyMs: number;
                tokens: number;
              },
          );
          return [
            { name: "pass_rate", value: mean(passes) },
            {
              name: "avg_cost_usd",
              value: mean(outputs.map((o) => o.costUsd)),
            },
            {
              name: "avg_latency_ms",
              value: mean(outputs.map((o) => o.latencyMs)),
            },
            { name: "avg_tokens", value: mean(outputs.map((o) => o.tokens)) },
          ];
        },
      ],
    });
    await langfuse.flush();
    await flushTraces();
  } else {
    // No Langfuse keys: still run and judge, just don't save anywhere.
    for (const golden of cases) {
      const input = {
        id: golden.id,
        question: golden.question,
        desk: deskFor(golden),
      };
      await task({ input });
      await evaluator({ input });
    }
  }

  const ordered = cases.map((c) => rows.get(c.id)!).filter(Boolean);
  const summary = summarize(
    ordered.map((r) => ({ category: r.category, scores: r.scores })),
  );
  return {
    mode,
    runName,
    rows: ordered,
    summary: {
      ...summary,
      avgCostUsd: mean(ordered.map((r) => r.turn.costUsd)),
      avgLatencyMs: mean(ordered.map((r) => r.turn.latencyMs)),
      avgTokens: mean(
        ordered.map((r) => r.turn.inputTokens + r.turn.outputTokens),
      ),
    },
  };
}
