# Cursor Support X

Hey Cursor team!

I noticed that Cursor support does not have much of a presence on X.

I have seen [@ReplitSupport](https://x.com/ReplitSupport) out in the wild, but I also noticed how slow that experience can feel, often taking more than 12 hours to respond. I have also seen complaints on Reddit about slow response times from Cursor support.

If I were thinking about building a world-class support experience for Cursor, one metric I would care a lot about is time to first response.

So I built a demo system around [`@CursorSupport`](https://x.com/CursorSupport), the X account I made for this idea.

The idea is simple:

- someone mentions `@cursorsupport`
- the system prepares a Slack-ready support brief for a human rep
- the brief includes the original post, a link to it, a thought from `gpt-5.4-nano`, a copy-pasteable reply, and the Cursor help docs used to support the answer

This repo does **not** auto-reply on X. It is meant to help a support team respond faster and more accurately.

## Live X Test

On May 2, 2026, I tested this with a real post to [`@CursorSupport`](https://x.com/CursorSupport):

> [@CursorSupport I paid for Pro but Cursor still says I'm on the free plan. I already tried signing out and back in. Can someone help?](https://x.com/himarkyi/status/2050708722662650323)

Running `npm run mentions:brief -- --save` produced a human-reviewable support brief in about 9.6 seconds:

```text
triage: billing/pricing / high
human review: yes
suggested action: route to a billing-support owner and ask the user to email hi@cursor.com with the account email and receipt/order info.
suggested reply: Please email hi@cursor.com so the team can check your subscription and entitlement. Include the email you used for Cursor and your receipt/order info.
sources: https://cursor.com/help/account-and-billing/billing, https://cursor.com/help/account-and-billing/pricing, https://cursor.com/help/account-and-billing/cancel
```

Full generated payload: [data/outputs/2026-05-02-himarkyi-2050708722662650323.json](data/outputs/2026-05-02-himarkyi-2050708722662650323.json)

Flow: X mention -> Cursor docs retrieval -> `gpt-5.4-nano` draft -> Slack-ready brief -> human-approved reply.

## Example Outputs

### 1. Billing dispute

```text
new mention: @cursorsupport wtf you charged me for april even though i canceled my subscription
suggested response: Public reply can cite that cancellation takes effect at the end of the current billing period, so a charge may still appear for the active period. Route to hi@cursor.com for invoice review.
suggested reply: Cancellation takes effect at the end of your current billing period, so you may still see a charge for that period even if you canceled. If you were billed after your cancellation, email hi@cursor.com and the team can review your April invoice against your cancellation timing.

link to post: https://x.com/angrycustomer/status/billing-dispute-april-cancel
sources: https://cursor.com/help/account-and-billing/refunds, https://cursor.com/help/account-and-billing/billing, https://cursor.com/help/account-and-billing/cancel
```

### 2. Refund request

```text
new mention: @cursorsupport i want a refund for last month can someone fix this
suggested response: Use the refund policy and cancellation docs as the public baseline. Because this is an account-specific refund request, route to hi@cursor.com and avoid asking for sensitive charge details in public.
suggested reply: Refunds for previous billing periods are not eligible under the current refund policy. If you believe there is an exception or billing error, email hi@cursor.com from the email on your account and the team can review it.

link to post: https://x.com/refundseeker/status/refund-last-month
sources: https://cursor.com/help/account-and-billing/refunds, https://cursor.com/help/account-and-billing/billing, https://cursor.com/help/account-and-billing/cancel
```

### 3. Account / IDE connection issue

```text
new mention: @cursorsupport i made an account but i can't connect in the IDE. it keeps failing when i try to sign in
suggested response: Start with doc-backed checks only: VPN/proxy, retry after a few minutes, different authentication method, and SSO assignment if relevant. If it still fails, escalate to hi@cursor.com with OS, Cursor version, exact error, and repro steps.
suggested reply: If you are using a VPN or proxy, turn it off and try again. Also try a different authentication method if possible. If you are using SSO, make sure your user is assigned to the Cursor app in your IdP. If it still fails, email hi@cursor.com with your OS, Cursor version, and the exact error message.

link to post: https://x.com/ideblocked/status/ide-connect-account
sources: https://cursor.com/help/troubleshooting/network, https://cursor.com/help/security-and-privacy/sso, https://cursor.com/help/troubleshooting/tab-issues
```

## How It Works

The system has all of `cursor.com/help` scraped locally and embedded so it can point `gpt-5.4-nano` at the right docs when forming an answer.

`gpt-5.4-nano` is also given a standard operating procedure so it knows when to:

- answer directly with docs
- suggest DM for small personal-account follow-up
- escalate to `hi@cursor.com`
- avoid guessing when the docs are weak

The live X integration is written against the official X API and is configured for the real [`@CursorSupport`](https://x.com/CursorSupport) account. It can poll mentions from X, normalize them into the same support workflow as the fixtures, and write Slack-ready JSON for human review.

It still does **not** auto-reply on X.

With X's April 2026 pricing changes, the practical first pass is a read-only Free-tier flow with `X_BEARER_TOKEN`: fetch public posts that mention `@cursorsupport`, generate a Slack-ready brief, and keep replies human-approved. See [docs/x_live_setup.md](docs/x_live_setup.md) for the setup checklist, pricing notes, and manual reply command.

## What I Would Add Next

- connect the Slack handoff to Cursor's actual Slack workspace
- expand the knowledge base beyond `cursor.com/help` so more involved product questions can be answered
- add broader evals around live mention categories, escalation decisions, and reply quality

## Repo

- [mark_thinking.md](mark_thinking.md)
- [docs/support_sop.md](docs/support_sop.md)
- [docs/x_live_setup.md](docs/x_live_setup.md)
- [examples/README.md](examples/README.md)

The repo is dependency-light and uses Node's built-in test runner. Use Node 22+ because the scripts rely on `node --experimental-transform-types`.

Run the automated tests:

```bash
npm test
```

Regenerate the checked-in demo outputs from bundled fixtures:

```bash
npm run kb:seed-demo
npm run demo:final
```

To see exactly what happens when `@cursorsupport` gets a mention:

```bash
npm run mentions:brief -- --fixture fixtures/x/mentions-response.json
```

Process the bundled X mentions fixture through the normal saved-output pipeline:

```bash
npm run demo:fixtures
```

Test one arbitrary mock mention without touching X:

```bash
npm run demo:message -- --text "@cursorsupport where do I check pricing?" --handle mockuser
```

With a live read-only X Bearer token:

```bash
export X_BEARER_TOKEN=<bearer-token>
export X_USERNAME=cursorsupport
npm run env:check
npm run x:probe
npm run mentions:brief -- --save
```

For a human-approved live reply after reviewing a generated support brief:

```bash
npm run mentions:reply -- --mention-id <post-id> --text "<approved reply>"
```

For batch polling instead of a single brief:

```bash
npm run mentions:poll -- --limit 5
```

For repeated polling:

```bash
npm run mentions:watch
```

Live runs write generated handoff payloads to `data/outputs/` and track processed mentions in `data/mentions-state.json`. The `data/` directory and `.env` are intentionally gitignored.

The CLI reads environment variables from the shell and also loads `.env` automatically. Shell values win when both are present.
