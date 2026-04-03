# Demo Examples

These are the curated handoff examples for the demo.

Each JSON file shows the full internal payload the system would hand to a Cursor support rep:

- original mention
- triage category and priority
- suggested internal handling
- suggested user-facing reply
- official source links
- retrieval debug data

## Included Cases

- [billing-dispute-april-cancel.json](/Users/markyi/repos/projects/cursor-support-x/examples/outputs/billing-dispute-april-cancel.json)
  Charged after cancellation.

- [refund-last-month.json](/Users/markyi/repos/projects/cursor-support-x/examples/outputs/refund-last-month.json)
  Refund request for a past billing period.

- [ide-connect-account.json](/Users/markyi/repos/projects/cursor-support-x/examples/outputs/ide-connect-account.json)
  Account created, but sign-in/connection fails inside the editor.

- [email-slow-annual-switch.json](/Users/markyi/repos/projects/cursor-support-x/examples/outputs/email-slow-annual-switch.json)
  User wants to switch to annual billing and is frustrated by slow support response.

- [trial-charged-no-contact.json](/Users/markyi/repos/projects/cursor-support-x/examples/outputs/trial-charged-no-contact.json)
  Charged after trial and unsure how to contact support.

- [billing-reply-stalled-premium-prompts.json](/Users/markyi/repos/projects/cursor-support-x/examples/outputs/billing-reply-stalled-premium-prompts.json)
  Billing thread stalled and premium prompts are unusable.

## Regenerate

```bash
npm run kb:seed-demo
npm run demo:final
```
