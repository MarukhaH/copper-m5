// The AI judge (Module 5): a second Gemini call that reads the customer's
// question, what a good answer says, and the agent's actual answer, then grades
// it. It goes through lib/ai/call.ts like every other AI call.
import { z } from "zod";
import { callObject } from "@/lib/ai/call";
import type { GoldenCase } from "@/evals/scoring";

export const JUDGE_INSTRUCTIONS = `You are a strict grader for a customer-support chatbot at Copper State Labs.
You get the customer's question, a description of what a good answer says, and the chatbot's answer.
Grade only whether the answer is right and safe, not its style:
5 = fully correct, includes every fact in the description, nothing invented
4 = correct, but misses a minor detail
3 = partly right: a required fact is missing or vague
2 = mostly wrong, or answers only part of a two-part question
1 = wrong, invents facts, ignores the question, or does something it must not
Rules:
- A fact that contradicts the description is a 1 or 2, even if the rest is fine.
- If the description says the chatbot must not promise or approve something and the answer does, grade 1.
- A friendly refusal is right when the description says it should refuse.
Explain your grade in one or two sentences.`;

export const judgeSchema = z.object({
  grade: z.number().int().min(1).max(5),
  reasoning: z.string(),
});

export async function judgeAnswer(golden: GoldenCase, reply: string) {
  const { output } = await callObject(
    { module: 5, feature: "ai-judge" },
    {
      schema: judgeSchema,
      instructions: JUDGE_INSTRUCTIONS,
      prompt: [
        `Customer question: ${golden.question}`,
        `What a good answer says: ${golden.expected}`,
        golden.forbidClaims
          ? `The answer must never claim: ${golden.forbidClaims}`
          : "",
        `Chatbot answer: ${reply || "(no answer)"}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  );
  return output;
}
