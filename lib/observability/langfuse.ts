// Langfuse: where every AI call is traced (Module 5). Each chat turn becomes
// one trace; inside it you see each agent, its tool calls, tokens, cost and
// time. The AI SDK emits OpenTelemetry spans; Langfuse's span processor ships
// them. Nothing is sent unless the three LANGFUSE_* keys are set, so the app
// still runs with no setup.
import { OpenTelemetry } from "@ai-sdk/otel";
import { LangfuseClient } from "@langfuse/client";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  propagateAttributes,
  startActiveObservation,
  type LangfuseSpan,
} from "@langfuse/tracing";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { registerTelemetry } from "ai";

/** A key or URL from the environment without spaces, line breaks or invisible characters (they sneak in when you paste). */
const clean = (value: string | undefined) =>
  value?.replace(/[^\x21-\x7e]/g, "") || undefined;

export const langfusePublicKey = () => clean(process.env.LANGFUSE_PUBLIC_KEY);
export const langfuseSecretKey = () => clean(process.env.LANGFUSE_SECRET_KEY);

export function isLangfuseConfigured(): boolean {
  return Boolean(
    langfusePublicKey() && langfuseSecretKey() && langfuseBaseUrl(),
  );
}

/**
 * LANGFUSE_BASE_URL, tidied: spaces, line breaks and invisible or non-ASCII
 * characters (they sneak in when you paste) are removed, https:// is added if
 * you left it off, and there's no trailing slash. "us.cloud.langfuse.com" and
 * "https://us.cloud.langfuse.com/" both work.
 */
export function langfuseBaseUrl(): string | undefined {
  const raw = clean(process.env.LANGFUSE_BASE_URL);
  if (!raw) return undefined;
  return (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(
    /\/+$/,
    "",
  );
}

let tracing: { processor: LangfuseSpanProcessor } | undefined;

/**
 * Starts sending traces to Langfuse. Safe to call twice. Returns undefined
 * when Langfuse isn't configured.
 */
export function startTracing() {
  if (!isLangfuseConfigured()) return undefined;
  if (!tracing) {
    const processor = new LangfuseSpanProcessor({
      publicKey: langfusePublicKey(),
      secretKey: langfuseSecretKey(),
      baseUrl: langfuseBaseUrl(),
    });
    new NodeTracerProvider({ spanProcessors: [processor] }).register();
    registerTelemetry(new OpenTelemetry());
    tracing = { processor };
  }
  return tracing;
}

/** Sends any traces still waiting (the eval run calls this before it exits). */
export async function flushTraces(): Promise<void> {
  await tracing?.processor.forceFlush();
}

export type TraceInfo = {
  /** The trace's name in Langfuse, like "ask-copper-turn". */
  name: string;
  input?: unknown;
  /** Shown as filters in Langfuse, like ["agents:multi"]. */
  tags?: string[];
  metadata?: Record<string, string>;
  sessionId?: string;
};

/**
 * Runs `fn` as one Langfuse trace. Every AI call and tool call made inside it
 * becomes part of that trace. Without Langfuse it just runs `fn`.
 */
export async function withTrace<T>(
  info: TraceInfo,
  fn: (span: LangfuseSpan | undefined) => Promise<T>,
): Promise<T> {
  if (!isLangfuseConfigured()) return fn(undefined);
  return propagateAttributes(
    {
      traceName: info.name,
      tags: info.tags,
      metadata: info.metadata,
      sessionId: info.sessionId,
    },
    () =>
      startActiveObservation(info.name, async (span) => {
        span.update({ input: info.input });
        return fn(span);
      }),
  );
}

let client: LangfuseClient | undefined;

/** The Langfuse client, for scores. Undefined when Langfuse isn't configured. */
export function langfuseClient(): LangfuseClient | undefined {
  if (!isLangfuseConfigured()) return undefined;
  client ??= new LangfuseClient({
    publicKey: langfusePublicKey(),
    secretKey: langfuseSecretKey(),
    baseUrl: langfuseBaseUrl(),
  });
  return client;
}
