# Building The Best Support Experience In The World

## Strategy memo

I want this project to make a simple point: great support is not just about having a model that can answer questions. It is about designing a system that compresses the time between an inquiry arriving and a competent human being ready to respond.

The bar I care about most is time to first response. Public support on X is where product trust gets tested in front of everyone. If someone asks for help in the middle of the day and waits 12+ hours, the support system is already telling them something about the company. Even if the eventual answer is good, the experience feels slow, reactive, and under-owned.

What I like in the strongest support accounts is that the responses feel written by a real person. What I do not like is when that human feel comes at the cost of speed. The system I want for Cursor is human-in-the-loop by design, but operationally fast because intake, retrieval, and triage are already done before the rep opens the thread.

That is why this demo does not automate posting. Instead, it does the work that support teams usually lose time on:

- collecting the mention content and permalink
- routing the issue into a category
- pulling the most relevant official docs
- drafting a suggested followup
- flagging weak-answer cases for escalation instead of fabrication

If this exists, a support rep does not start from zero. They start from a structured brief with a likely answer and the source link already attached. That cuts the time to a first useful response dramatically without removing the judgment of the human support engineer.

The second principle is citation-backed accuracy. If the inquiry is about billing, pricing, rate limits, or policy, the answer should not just say what the rule is. It should point to the exact Cursor page that supports the answer. This protects the user experience and the support team. It also keeps the AI honest, because the system has to show its work.

The third principle is explicit escalation. A world-class support system should know when not to answer. If the docs do not clearly support a response, the AI should say this could be related to a few likely areas and hand the case to a human. Fast uncertainty is better than confident nonsense.

This is also why I think social support should be treated as an operating system problem, not only a prompting problem. The real win is:

- fast intake
- fast routing
- trustworthy citations
- clear escalation paths
- measurable response times

If I were running this for real, I would track:

- time to first human review
- time to first public response
- citation coverage rate
- escalation rate
- re-open / follow-up rate
- percent of inquiries resolved from official docs without extra back-and-forth

My thesis for Cursor is straightforward: a technical support engineer can create product leverage by building support systems that let a small team respond with the speed and precision of a much larger one. This repo is the first pass at that thesis.

## Working notes

- Replit support is a useful comp because the replies often feel human, which is the right instinct.
- The gap is response latency. Human-sounding support should not require half-day waits.
- Cursor has a strong docs surface already. That is an asset for support acceleration if it is turned into retrieval with source links.
- X support is especially high leverage because it is public and sets the tone for how technical users think about the company.
- The most important failure mode to avoid is authoritative-sounding wrong answers on billing, pricing, and policy.
- The right role for AI here is preparation and routing, not pretending to be the support engineer.

## Demo implementation choices

This demo is intentionally built as a support-assist system, not an autonomous support bot.

- It ingests a mention, keeps the permalink, and prepares a Slack-style support brief instead of posting publicly.
- It uses Cursor's official help center as the primary knowledge base and keeps source URLs attached so every suggestion can point back to the exact supporting page.
- It separates internal guidance from public-facing language. The support team gets a suggested response and a separate suggested reply they can copy, edit, and send.
- It treats billing and higher-touch cases differently from lightweight product questions. Simple doc-backed issues can stay on X. Account-specific or billing-sensitive issues should route to `hi@cursor.com` instead of DM.

The retrieval system is also deliberately conservative.

- The help center is scraped into local JSON docs so the demo works offline and is easy to inspect.
- Pages are chunked by FAQ-style question boundaries where possible, not only by raw character count. That keeps the retrieval units closer to how support reps actually reason about docs: one question, one answer block.
- Each chunk gets local token features for lexical ranking and, when an OpenAI API key is available, a local embedding for semantic retrieval.
- Messy user posts are rewritten into a cleaner support-search query before retrieval. This matters because real support messages are emotional, shorthand-heavy, and often do not use the same wording as the docs.
- Retrieval is hybrid. It blends lexical matches with cosine similarity over local embeddings instead of trusting either method alone.
- After the first retrieval pass, the system reranks the top candidates with a lightweight model call so the final source set is closer to "best answer for this issue" rather than just "most textually similar chunk."

This is the core design decision for the demo: retrieval first, writing second.

- The model is not trusted to browse the help center freely.
- The model is handed a constrained set of retrieved Cursor sources and asked to write from those.
- If the retrieved support is weak, the system should escalate instead of improvising policy.

That approach makes the system easier to trust, easier to debug, and easier to explain in an interview setting.

## Why these methods fit the demo

I do not think a demo like this needs a heavy external vector database, a Slack integration, or autonomous posting to prove the point.

- The help center is small enough that local indexing and brute-force retrieval are sufficient.
- Keeping embeddings and chunks on disk makes the whole pipeline inspectable.
- Human-in-the-loop support is the right operating posture for X, where tone and judgment matter.
- The biggest product win is not "AI writes the perfect answer." The win is "the team sees the issue, likely docs, and next action fast enough to respond like a world-class support org."

For an application demo, this is enough to show system taste:

- use the official docs surface instead of vague model memory
- optimize for time to first useful response
- keep citations attached
- route sensitive cases away from public guesswork
- make the workflow legible for a real support team

## What I would improve next

If this moved beyond demo stage, the next upgrades should focus on retrieval quality, support operations, and trust.

- Add a labeled retrieval eval set of real support-style messages mapped to the ideal help pages.
- Add better reranking and confidence calibration so escalation decisions are less heuristic.
- Expand the knowledge base beyond help docs into status/incidents, internal runbooks, and common edge-case billing policies.
- Add stronger support analytics around time to first human review, time to first public response, citation coverage, and escalation quality.
- Add a real X ingestion adapter and, later, a real Slack sink once the internal JSON format feels stable.
- Keep improving channel policy. Public X replies, DMs, and email escalation should follow explicit SOP rules rather than ad hoc rep judgment.

If I were pitching this to Cursor directly, the point would be:

- The support advantage is not just better answers.
- The support advantage is a better system for turning incoming noise into fast, accurate, human support.
