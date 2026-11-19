// Next.js runs register() once when the server starts. It turns on Langfuse
// tracing (Module 5) when the LANGFUSE_* keys are set.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startTracing } = await import("@/lib/observability/langfuse");
  startTracing();
}
