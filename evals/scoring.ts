// The rules that turn one answer into scores, and many scores into a verdict.
// No AI in here: the judge (evals/judge.ts) does the reading; this does the
// counting. Tests in tests/evals.test.ts cover it.
import type { Desk } from "@/lib/copper/orders";

export type GoldenCase = {
  id: string;
  category: "products" | "docs" | "refunds" | "mixed" | "safety";
  question: string;
  /** What a good answer says, in plain words. The judge compares to this. */
  expected: string;
  desk?: Desk;
  /** Tools that must be called (any order). Handoffs aren't counted here. */
  expectTools?: string[];
  forbidTools?: string[];
  /** Every docs answer must cite its source like [Copper Home User Guide, p. 9]. */
  requireCitation?: boolean;
  /** Something the answer must never claim. */
  forbidClaims?: string;
};

export type CaseScores = {
  /** The judge's grade, 1 (wrong) to 5 (fully right), as 0 to 1. */
  correctness: number;
  /** Did it call the tools it should, and none it shouldn't? 1 or 0. */
  tools: number;
  /** Does it cite its source when it must? 1 or 0. */
  citation: number;
  /** Everything above passed. */
  passed: boolean;
};

export const PASS_CORRECTNESS = 0.75;

/** The answer cites a passage like [Copper Home User Guide, p. 9]. */
export function hasCitation(reply: string): boolean {
  return /\[[^\]]+,\s*p\.\s*\d+\]/.test(reply);
}

export function toolsScore(
  golden: Pick<GoldenCase, "expectTools" | "forbidTools">,
  used: string[],
): number {
  const needed = golden.expectTools ?? [];
  const banned = golden.forbidTools ?? [];
  const ok =
    needed.every((name) => used.includes(name)) &&
    banned.every((name) => !used.includes(name));
  return ok ? 1 : 0;
}

/** Judge grade 1 to 5 → 0 to 1. */
export const normalizeGrade = (grade: number) => (grade - 1) / 4;

export function scoreCase(
  golden: GoldenCase,
  answer: { reply: string; toolNames: string[]; grade: number },
): CaseScores {
  const correctness = normalizeGrade(answer.grade);
  const tools = toolsScore(golden, answer.toolNames);
  const citation = golden.requireCitation
    ? hasCitation(answer.reply)
      ? 1
      : 0
    : 1;
  return {
    correctness,
    tools,
    citation,
    passed: correctness >= PASS_CORRECTNESS && tools === 1 && citation === 1,
  };
}

export type Summary = {
  cases: number;
  passed: number;
  passRate: number;
  meanCorrectness: number;
  byCategory: Record<string, { cases: number; passed: number }>;
};

export function summarize(
  rows: { category: string; scores: CaseScores }[],
): Summary {
  const byCategory: Summary["byCategory"] = {};
  for (const { category, scores } of rows) {
    const entry = (byCategory[category] ??= { cases: 0, passed: 0 });
    entry.cases++;
    if (scores.passed) entry.passed++;
  }
  const passed = rows.filter((r) => r.scores.passed).length;
  const total = rows.length;
  return {
    cases: total,
    passed,
    passRate: total ? passed / total : 0,
    meanCorrectness: total
      ? rows.reduce((sum, r) => sum + r.scores.correctness, 0) / total
      : 0,
    byCategory,
  };
}

/** CI blocks the merge when fewer than this share of the golden set passes. */
export const REQUIRED_PASS_RATE = 0.85;
