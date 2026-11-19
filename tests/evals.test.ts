// The golden-set evaluation itself runs with `npm run eval` (it needs real
// keys). These tests check the pieces around it that need no model:
// the golden set, the scoring rules, and the single agent.
import { describe, expect, it } from "vitest";
import { GOLDEN_SET } from "@/evals/run-eval";
import {
  hasCitation,
  normalizeGrade,
  scoreCase,
  summarize,
  toolsScore,
  type GoldenCase,
} from "@/evals/scoring";
import { judgeSchema } from "@/evals/judge";
import {
  COPPER_INSTRUCTIONS,
  SINGLE_AGENT_INSTRUCTIONS,
} from "@/lib/copper/assistant/instructions";
import {
  copperTools,
  refundAgentTools,
  singleAgentTools,
} from "@/lib/copper/assistant/tools";
import { getOrders } from "@/lib/copper/orders";

const desk = { limitUsd: 50, refunds: [] };
const base: GoldenCase = {
  id: "x",
  category: "docs",
  question: "q",
  expected: "e",
};

describe("golden set", () => {
  it("has unique ids and every field the judge needs", () => {
    const ids = GOLDEN_SET.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of GOLDEN_SET) {
      expect(c.question.length, c.id).toBeGreaterThan(5);
      expect(c.expected.length, c.id).toBeGreaterThan(10);
    }
  });

  it("covers every kind of question, including refunds and attacks", () => {
    const categories = new Set(GOLDEN_SET.map((c) => c.category));
    for (const name of ["products", "docs", "refunds", "mixed", "safety"])
      expect(categories.has(name as GoldenCase["category"]), name).toBe(true);
    expect(GOLDEN_SET.length).toBeGreaterThanOrEqual(15);
  });

  it("only expects tools that exist", () => {
    const known = new Set([
      ...Object.keys(copperTools),
      ...Object.keys(refundAgentTools(desk)),
    ]);
    for (const c of GOLDEN_SET)
      for (const name of [...(c.expectTools ?? []), ...(c.forbidTools ?? [])])
        expect(known.has(name), `${c.id}: ${name}`).toBe(true);
  });

  it("refers only to orders that exist", () => {
    const real = new Set(getOrders().map((o) => o.id));
    for (const c of GOLDEN_SET)
      for (const id of c.question.match(/\b1\d{3}\b/g) ?? [])
        expect(real.has(id), `${c.id}: order ${id}`).toBe(true);
  });
});

describe("scoring", () => {
  it("turns a 1-5 grade into 0-1", () => {
    expect(normalizeGrade(1)).toBe(0);
    expect(normalizeGrade(3)).toBe(0.5);
    expect(normalizeGrade(5)).toBe(1);
  });

  it("spots a citation like [Copper Home User Guide, p. 9]", () => {
    expect(hasCitation("Unplug it. [Copper Home User Guide, p. 9]")).toBe(true);
    expect(hasCitation("Unplug it.")).toBe(false);
    expect(hasCitation("See [the guide]")).toBe(false);
  });

  it("checks the tools used", () => {
    const golden = {
      expectTools: ["search_docs"],
      forbidTools: ["request_refund"],
    };
    expect(toolsScore(golden, ["search_docs"])).toBe(1);
    expect(toolsScore(golden, [])).toBe(0);
    expect(toolsScore(golden, ["search_docs", "request_refund"])).toBe(0);
    expect(toolsScore({}, ["anything"])).toBe(1);
  });

  it("passes only when correct, on the right tools, and cited", () => {
    const golden = {
      ...base,
      expectTools: ["search_docs"],
      requireCitation: true,
    };
    const good = {
      reply: "Yes. [Copper Home User Guide, p. 9]",
      toolNames: ["search_docs"],
      grade: 5,
    };
    expect(scoreCase(golden, good).passed).toBe(true);
    expect(scoreCase(golden, { ...good, grade: 2 }).passed).toBe(false);
    expect(scoreCase(golden, { ...good, toolNames: [] }).passed).toBe(false);
    expect(scoreCase(golden, { ...good, reply: "Yes." }).passed).toBe(false);
    // A case that needs no citation ignores a missing one.
    expect(
      scoreCase(base, { reply: "Yes.", toolNames: [], grade: 4 }).passed,
    ).toBe(true);
  });

  it("summarizes pass rate and categories", () => {
    const pass = { correctness: 1, tools: 1, citation: 1, passed: true };
    const fail = { correctness: 0, tools: 1, citation: 1, passed: false };
    const s = summarize([
      { category: "docs", scores: pass },
      { category: "docs", scores: fail },
      { category: "refunds", scores: pass },
    ]);
    expect(s.cases).toBe(3);
    expect(s.passRate).toBeCloseTo(2 / 3);
    expect(s.byCategory.docs).toEqual({ cases: 2, passed: 1 });
    expect(summarize([]).passRate).toBe(0);
  });

  it("accepts only 1-5 grades from the judge", () => {
    expect(judgeSchema.safeParse({ grade: 5, reasoning: "ok" }).success).toBe(
      true,
    );
    expect(judgeSchema.safeParse({ grade: 6, reasoning: "ok" }).success).toBe(
      false,
    );
    expect(judgeSchema.safeParse({ grade: 3.5, reasoning: "ok" }).success).toBe(
      false,
    );
  });
});

describe("the single agent", () => {
  it("has every tool from both agents and no handoff", () => {
    const names = Object.keys(singleAgentTools(desk));
    for (const name of [
      ...Object.keys(copperTools),
      "get_orders",
      "request_refund",
    ])
      expect(names, name).toContain(name);
    expect(names).not.toContain("transfer_to_refund_agent");
    expect(names).not.toContain("transfer_to_copper");
  });

  it("reads Copper's rules and the refund rules, and never mentions a handoff", () => {
    expect(SINGLE_AGENT_INSTRUCTIONS).toContain(COPPER_INSTRUCTIONS);
    expect(SINGLE_AGENT_INSTRUCTIONS).toContain("request_refund");
    expect(SINGLE_AGENT_INSTRUCTIONS).not.toMatch(/transfer_to/);
  });
});
