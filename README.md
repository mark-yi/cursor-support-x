# Cursor Support X

Human-in-the-loop support triage demo for `@cursorsupport`: mention in, cited support brief out.

## At A Glance

This repo is a demo of how Cursor support on X could work with a human in the loop.

Current state:

- official X API polling is wired but not connected to the live `@cursorsupport` account yet
- the support workflow is fully demoable from fixtures and mock mentions
- the knowledge base is a local snapshot of the full Cursor help center
- outputs are Slack-style internal handoff payloads, not automated public replies

What this proves:

- a support rep can go from messy social post to doc-backed suggested reply quickly
- billing, refund, and account issues can be routed safely
- the system escalates instead of guessing when the docs are weak

## Why This Exists

The goal is not to auto-reply on X. The goal is to reduce time to first useful response.

This repo turns a messy support mention into:

- a category and urgency call
- a short internal recommendation for the support team
- a copy-pasteable suggested reply
- official Cursor help links that support the answer

That keeps the human in the loop while removing the slowest part of social support triage: reading the thread, figuring out the issue, finding the right docs, and deciding where to route it.

## See It Quickly

If you only have a minute, look at:

- [mark_thinking.md](/Users/markyi/repos/projects/cursor-support-x/mark_thinking.md)
- [docs/support_sop.md](/Users/markyi/repos/projects/cursor-support-x/docs/support_sop.md)
- [examples/README.md](/Users/markyi/repos/projects/cursor-support-x/examples/README.md)

If you want to run the demo:

```bash
npm run kb:seed-demo
npm run demo:final
```

That seeds the local help-center knowledge base from the bundled Cursor help snapshot and regenerates the curated example outputs in `examples/outputs/`.

## What Happens Next

The only meaningful integration step left is connecting the official X API to the real `@cursorsupport` account.

That means:

1. add the account credentials in `.env`
2. run `mentions:poll` against live mentions
3. keep the same retrieval and triage pipeline already shown in the examples

Everything else in this repo is already set up to support that flow.

## What The Demo Does

1. Takes an X mention or mock support message.
2. Rewrites the messy message into a cleaner support-search query.
3. Retrieves from a local copy of the official Cursor help center.
4. Uses hybrid retrieval:
   lexical match + local embeddings + reranking.
5. Produces a Slack-style handoff payload for a human support rep.

The system does not post to X and does not send to Slack. It prepares the work so a support engineer can respond quickly and accurately.

In one line:

`mention -> query rewrite -> help-center retrieval -> rerank -> suggested handling + suggested reply + sources`

## Example Output

```text
new mention: @cursorsupport wtf you charged me for april even though i canceled my subscription
suggested response: Public reply: note cancellation stops future charges and takes effect at end of current billing period. Route to hi@cursor.com for account-specific invoice review.
suggested reply: Cancellation stops future charges at the end of the current billing period. For an invoice-specific review of the April charge, email hi@cursor.com with your account email and the charge date.

link to post: https://x.com/angrycustomer/status/billing-dispute-april-cancel
sources: https://cursor.com/help/account-and-billing/refunds, https://cursor.com/help/account-and-billing/billing, https://cursor.com/help/account-and-billing/cancel
```

## Repo Map

- [mark_thinking.md](/Users/markyi/repos/projects/cursor-support-x/mark_thinking.md): why this matters and why the system is designed this way
- [docs/support_sop.md](/Users/markyi/repos/projects/cursor-support-x/docs/support_sop.md): operating rules for how the support team should use it
- [examples/README.md](/Users/markyi/repos/projects/cursor-support-x/examples/README.md): curated demo cases and saved outputs
- [src/cli.ts](/Users/markyi/repos/projects/cursor-support-x/src/cli.ts): entrypoints for KB sync, mock demos, and X polling
- [src/triage/pipeline.ts](/Users/markyi/repos/projects/cursor-support-x/src/triage/pipeline.ts): retrieval -> rerank -> draft pipeline
- [src/kb/](/Users/markyi/repos/projects/cursor-support-x/src/kb): local help-center indexing, embeddings, query rewrite, reranking

## Commands

Core demo commands:

```bash
npm run kb:seed-demo
npm run demo:final
npm run demo:message -- --text "@cursorsupport i got charged after canceling"
```

Other commands:

```bash
npm run kb:sync
npm run mentions:poll
npm run mentions:watch
npm run test
```

## Environment

Copy `.env.example` to `.env` if you want live integrations.

Optional:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_EMBEDDING_MODEL`
- `OPENAI_EMBEDDING_DIMENSIONS`

Required for live read-only X polling:

- `X_BEARER_TOKEN`
- `X_USERNAME` or `X_USER_ID`

Without `OPENAI_API_KEY`, the demo still works end-to-end using local heuristic drafting and lexical retrieval.

With `OPENAI_API_KEY`, it also uses OpenAI for:

- local help-doc embeddings
- query rewriting
- retrieval reranking
- final draft generation

## Notes

- The bundled knowledge base is a full rendered snapshot of `https://cursor.com/help`.
- Help docs are chunked by FAQ-style question boundaries when possible.
- Billing and higher-touch issues route to `hi@cursor.com` instead of DM.
- The output is intentionally built for a human support rep, not an autonomous bot.
- Live X polling is wired for the official X API but intentionally not exercised in this repo. The demo stays fixture-backed and mockable until the `@cursorsupport` account is connected.
