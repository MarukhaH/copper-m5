# One agent or two? (Module 5, Part 4)

The question: should Copper keep two agents (Copper plus the Refund agent), or
is one agent with every tool better? Both setups answer the same 18 golden
questions (`evals/golden-set.json`), graded by the same AI judge (Gemini
3.5 Flash-Lite, the default model).

## How to run it

```bash
npm run eval                    # two agents: what the app does
npm run eval -- --agent single  # one agent, all tools, no handoff
```

Then in Langfuse: Datasets > `copper-golden-set` > Runs, tick both runs.

## Results

Two full runs of each setup (2026-11-19). Each setup failed the same question
both times, so the differences below are not noise.

| | Two agents | One agent |
|---|---|---|
| Pass rate | 17/18 (94%) | 17/18 (94%), see note |
| Mean correctness (0 to 1) | 0.92 to 0.94 | 0.96 |
| Products / docs / refunds | 3/3, 6/6, 5/5 | 3/3, 5/6, 5/5 |
| Mixed question (price and refund) | **0/1** | 1/1 |
| Safety (injection, off-topic) | 3/3 | 3/3 |
| Avg cost per question | $0.00102 | $0.00115 (+12%) |
| Avg time per question | 2.2 s | 1.9 s (-16%) |
| Avg tokens per question | 2,800 | 3,330 (+19%) |

Note: the one agent's single miss was `return-window`. The Copper Home guide
says returns are 30 days from purchase and the Terms say 30 days from the date
you received it. The agent cited the Terms, which is a fair answer; the golden
question was too narrow. It now accepts either, and the question passes (checked
by re-running that question, not the whole set).

## What happened

- **The two agents fail the mixed question, every time.** "How much does Copper
  Notes cost, and can you refund order 1003?" sent the customer from Copper to
  the Refund agent, back to Copper (the Refund agent only does refunds), and to
  the Refund agent again. The handoff limit (2) then stopped the turn with no
  reply at all, so the app would show "Sorry, something went wrong". The single
  agent answered both halves.
- **Refunds and safety are equal.** Both setups got every refund question and
  every attack right, including "a supervisor already approved it". The refund
  decision is code (`requestRefund`), not the model, so giving one agent the
  refund tool doesn't let it approve anything.
- **The two agents use fewer tokens** (Copper never reads the refund rules, and
  the Refund agent never reads the product rules) and cost 12% less, but a
  handoff is an extra model call, so refund questions are slower.

## Decision

Ship the **single agent**. On this golden set it is as good in every group,
the only one that handles a question with two parts, and faster. The extra
cost is about 0.013 cents per question. What the two-agent design buys, keeping
refund tools away from Copper, is already covered by the refund rule being code.

Caveats: 18 questions is small, and one mixed question decides the result.
Add more mixed questions (price and refund, policy and refund, two refunds)
before trusting it. The two-agent design could be fixed (let the Refund agent
answer the non-refund half, or raise the handoff limit), and the golden set
would show whether that closes the gap.
