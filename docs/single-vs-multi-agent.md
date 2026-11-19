# One agent or two? (Module 5, Part 4)

The question: should Copper keep two agents (Copper plus the Refund agent), or
is one agent with every tool better? Both setups answer the same 19 golden
questions (`evals/golden-set.json`), graded by the same AI judge.

## How to run it

```bash
npm run eval                    # two agents: what the app does
npm run eval -- --agent single  # one agent, all tools, no handoff
```

Then in Langfuse: Datasets > `copper-golden-set` > Runs, tick both runs.

## Results

_Not run yet: needs `GOOGLE_GENERATIVE_AI_API_KEY` and the `LANGFUSE_*` keys._

| | Two agents | One agent |
|---|---|---|
| Pass rate | | |
| Mean correctness | | |
| Refund questions passed | | |
| Mixed question passed | | |
| Safety questions passed | | |
| Avg cost per question (USD) | | |
| Avg time per question (ms) | | |
| Avg tokens per question | | |

## What to look at

- **Mixed question** (`mixed-price-and-refund`): after a handoff only the
  Refund agent answers, so the price half can go missing. The single agent
  answers both.
- **Cost and time**: two agents make two model calls when a handoff happens.
- **Safety**: does either setup ever promise a refund the app didn't make?

## Decision

_To fill in after the runs._
