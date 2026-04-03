# Social Support SOP

## Objective

Reduce time to first response for public support inquiries without compromising accuracy. The system should help a support rep move from mention to informed reply in minutes, not hours.

## Target operating metrics

- First human review target: under 15 minutes during staffed hours
- First public response target: under 30 minutes for standard inquiries
- Escalation acknowledgment target: under 10 minutes for bugs, billing pain, or access blockers
- Citation requirement: every policy or billing answer should include the official Cursor URL used to support it

## Workflow

1. Intake the mention and capture permalink, author handle, timestamp, and raw text.
2. Retrieve the top official Cursor sources from the local knowledge base.
3. Generate internal operator guidance, a copy-pasteable reply draft, and the triage payload.
4. Human reviewer checks tone, verifies the citation, and either:
   - sends a public response,
   - asks one clarifying question, or
   - routes to a deeper human workflow.
5. If the AI does not have a strong source, do not guess. Escalate.

## Tone rules

- Sound like a capable support human, not a bot.
- Be short and direct.
- Do not over-apologize.
- If you cite policy, include the official link.
- If you are unsure, say you’re checking and move it to a human owner.

## X routing rules

- Keep simple doc-backed answers public when possible so the user gets a fast response in-thread.
- DM is appropriate for lightweight personal-account follow-up when one small private detail would unblock the answer.
- Use `hi@cursor.com` instead of DM for billing, refunds, charges after cancellation, invoices, account recovery or sign-in blockers, enterprise or team-admin issues, security-sensitive questions, or any thread that will need a longer investigation.
- Do not ask for billing details, private account data, or long repro logs in a public reply.
- If you route off-platform, still include the best official Cursor help link in the public reply when one exists.

## Category buckets

- `billing/pricing`: plan limits, charges, refunds, invoices, usage
- `account/access`: login, identity, invites, team/account state
- `product usage/how-to`: setup, install, features, where-to-click questions
- `bugs/incidents`: failures, regressions, networking issues, outage-like reports
- `docs gap/unclear policy`: ambiguity, stale docs, unsupported edge-case questions
- `escalation required`: no strong citation, risky guidance, or user harm if wrong

## Escalation triggers

- No strong official source found
- Mentions of incorrect charges or refund disputes
- User cannot access account or team seat
- Suspected bug affecting workflow or reliability
- Bugs or crashes where you need OS, Cursor version, exact error, Request ID, or repro steps
- Questions that sound like policy commitments but are not clearly documented
- Angry user or repeated unresolved thread

## Response patterns

### Citation-backed answer

Use when the retrieved source is strong.

- Give the shortest helpful answer possible.
- Include the official Cursor link in the draft.
- Ask at most one clarifying question if needed.

### Clarify then route

Use when you have partial signal but not enough to answer cleanly.

- Ask for one missing detail.
- Use DM only if this is still a small personal-account issue.
- Assign human owner immediately.
- Avoid policy claims.

### Escalate without guessing

Use when the knowledge base does not support a reliable answer.

- Tell the user you’re checking with the team.
- Send billing and higher-touch threads to `hi@cursor.com`.
- Use DM only for small personal-account follow-up.
- Capture repro steps or account context.
- For bug reports, collect OS, Cursor version, exact error, Request ID when available, and clear repro steps.
- Route internally with urgency and permalink.
