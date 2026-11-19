// Runs one chat turn start to finish and returns everything that happened
// (Module 5). The evals use it to ask Ask Copper a question without a browser,
// and to run the same question through the two ways of building the agent:
//   "multi":  Copper hands refunds to the Refund agent (what the app does)
//   "single": one agent with all the tools and no handoff
// The agents, instructions and tools are the app's own, not copies.
import { hasToolCall, stepCountIs } from "ai";
import { callText } from "@/lib/ai/call";
import { defaultModel } from "@/lib/ai/models";
import { costUsd } from "@/lib/ai/pricing";
import {
  COPPER_HANDOFF,
  COPPER_INSTRUCTIONS,
  REFUND_AGENT_INSTRUCTIONS,
  SINGLE_AGENT_INSTRUCTIONS,
} from "@/lib/copper/assistant/instructions";
import type { Agent } from "@/lib/copper/assistant/progress";
import {
  copperTools,
  refundAgentTools,
  singleAgentTools,
  transferToRefundAgent,
} from "@/lib/copper/assistant/tools";
import type { Desk } from "@/lib/copper/orders";

export type AgentMode = "multi" | "single";

export type TurnMessage = { role: "user" | "assistant"; content: string };

export type ToolUse = { agent: Agent | "single"; name: string; input: unknown };

export type TurnResult = {
  reply: string;
  toolCalls: ToolUse[];
  /** Who spoke, in order: ["copper", "refund"] after a handoff. */
  agents: (Agent | "single")[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
};

const MAX_STEPS = 5;
const MAX_HANDOFFS = 2;

const HANDOFFS: Record<string, Agent> = {
  transfer_to_refund_agent: "refund",
  transfer_to_copper: "copper",
};

const STOP = [
  stepCountIs(MAX_STEPS),
  hasToolCall("transfer_to_refund_agent", "transfer_to_copper"),
];

function setup(agent: Agent | "single", desk: Desk) {
  if (agent === "single")
    return {
      feature: "single-agent",
      instructions: SINGLE_AGENT_INSTRUCTIONS,
      tools: singleAgentTools(desk),
    };
  if (agent === "refund")
    return {
      feature: "refund-agent",
      instructions: REFUND_AGENT_INSTRUCTIONS,
      tools: refundAgentTools(desk),
    };
  return {
    feature: "ask-copper",
    instructions: `${COPPER_INSTRUCTIONS}\n\n${COPPER_HANDOFF}`,
    tools: { ...copperTools, transfer_to_refund_agent: transferToRefundAgent },
  };
}

export async function runTurn({
  messages,
  desk,
  mode,
}: {
  messages: TurnMessage[];
  desk: Desk;
  mode: AgentMode;
}): Promise<TurnResult> {
  const started = performance.now();
  const out: TurnResult = {
    reply: "",
    toolCalls: [],
    agents: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    latencyMs: 0,
  };
  let current: Agent | "single" = mode === "single" ? "single" : "copper";

  for (let handoffs = 0; ; handoffs++) {
    const { feature, instructions, tools } = setup(current, desk);
    const result = await callText(
      { module: 5, feature },
      {
        messages,
        instructions,
        tools: tools as never,
        stopWhen: current === "single" ? stepCountIs(MAX_STEPS) : STOP,
      },
    );
    out.agents.push(current);
    out.inputTokens += result.totalUsage?.inputTokens ?? 0;
    out.outputTokens += result.totalUsage?.outputTokens ?? 0;
    let next: Agent | undefined;
    for (const step of result.steps)
      for (const call of step.toolCalls) {
        out.toolCalls.push({
          agent: current,
          name: call.toolName,
          input: call.input,
        });
        if (call.toolName in HANDOFFS) next = HANDOFFS[call.toolName];
      }
    out.reply = result.text;
    if (current === "single" || !next || next === current) break;
    if (handoffs >= MAX_HANDOFFS) break;
    current = next;
  }

  out.costUsd = costUsd(defaultModel(), out.inputTokens, out.outputTokens);
  out.latencyMs = Math.round(performance.now() - started);
  return out;
}
