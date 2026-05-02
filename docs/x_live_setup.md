# Live X Setup for @cursorsupport

X's April 2026 pricing change makes this workflow practical because reads of an app owner's own data are $0.001 per resource when the app and authenticated account match. For this repo, the safest first pass is a read-only Free-tier flow with the app-only `X_BEARER_TOKEN`, then a later paid/user-context path for posting.

Primary docs:

- Pricing and owned reads: https://docs.x.com/x-api/getting-started/pricing
- OAuth 2.0 PKCE and refresh tokens: https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code
- Mention lookup endpoint: https://docs.x.com/x-api/posts/get-mentions
- Reply endpoint: https://docs.x.com/x-api/posts/manage-tweets/introduction
- Usage and billing: https://docs.x.com/x-api/fundamentals/post-cap

## Recommended setup

### Free-tier read-only pilot

1. Sign into X as `@cursorsupport` and create the developer Project/App from that account.
2. Generate the app-only Bearer token.
3. Add a small credit balance and set a hard spending limit.
4. Store the token in the runtime environment as `X_BEARER_TOKEN`.
5. Set `X_USERNAME=cursorsupport`.
6. Set `X_USER_ID` after resolving it once, if known. This avoids an extra username lookup.
7. Run `npm run x:probe` once to verify which read endpoints the token can access.
8. Run `npm run mentions:brief -- --save` to preview and save one Slack-ready support brief.

Do not run `npm run mentions:watch` during early testing unless you are comfortable spending credits on repeated polling.

### Paid/user-context posting path

1. Sign into X as `@cursorsupport` and create the developer Project/App from that account.
2. Switch the app to pay-per-use, add a small prepaid credit balance, and set a hard spending limit.
3. Enable OAuth 2.0 PKCE for the app.
4. Request these scopes for the first production pass:
   - `tweet.read`
   - `users.read`
   - `tweet.write`
   - `offline.access`
5. Authorize the app as `@cursorsupport`.
6. Store the resulting user access token in the runtime environment as `X_USER_ACCESS_TOKEN`.
7. Set `X_USERNAME=cursorsupport`.
8. Set `X_USER_ID` after resolving it once. This avoids an extra username lookup during startup.
9. Run `npm run kb:sync` to index the live Cursor help docs.
10. Run `npm run mentions:brief` to preview the latest mention as a Slack-ready support brief.
11. Run `npm run mentions:watch` to create Slack-ready support payloads continuously.

`X_BEARER_TOKEN` is preferred for the Free-tier read-only pilot. `X_USER_ACCESS_TOKEN` is for the later OAuth/user-context flow.

## Runtime environment

```bash
export X_USERNAME=cursorsupport
export X_USER_ID=...
export X_BEARER_TOKEN=...
export OPENAI_API_KEY=...
export X_POLL_INTERVAL_MS=300000
```

Use `X_POLL_INTERVAL_MS=300000` or higher while credits are tight.

Preview the latest visible mention without updating local processed state:

```bash
npm run mentions:brief
```

Preview only mentions newer than local state:

```bash
npm run mentions:brief -- --new
```

For human-approved replies:

```bash
npm run mentions:reply -- --mention-id 1234567890 --text "Thanks for flagging this. Please email hi@cursor.com from the email on your account so the team can review it."
```

Do not include URLs in routine replies unless the response really needs one. X now prices URL-bearing content creation much higher than plain content creation.

## Cost model

Owned mention reads are priced per returned post. A 60-second poll loop is cheap if most polls return no new mentions, because successful responses are billed by resource returned rather than by polling request.

Useful planning numbers:

- 100 new owned-read mentions/day: about $0.10/day.
- 1,000 new owned-read mentions/day: about $1/day.
- 100 public replies/day without URLs: about $1.50/day.
- 100 public replies/day with URLs: about $20/day.

X also deduplicates billable resources within a UTC day in most cases, but the docs call this a soft guarantee, so budget as if duplicated fetches can occasionally happen.

## Operating policy

Keep the first deployed version human-in-the-loop:

- Poll mentions and produce the existing Slack-ready payload.
- Let a support operator approve or edit the suggested reply.
- Post with `mentions:reply` only after approval.
- Route account-specific billing, subscription, privacy, and identity issues to private support channels.
- Avoid collecting email addresses, invoices, API keys, or account identifiers in public replies.

## Follow-up work

- Add OAuth refresh-token handling so the two-hour access token expiry does not interrupt polling.
- Add Slack webhooks or Slack app interactivity for one-click approved replies.
- Add a production state store instead of the local JSON state file.
- Add a usage monitor around `GET /2/usage/tweets` and alert before the spending limit is approached.
- Consider DM support later with `dm.read` and `dm.write`, but keep public mentions first because this repo's current triage flow is already built around mentions.
