# SUBAGENT-POLICY.md -- When to Spawn Subagents

> Policy for Clawd on when to delegate work to subagents vs. handle directly.

---

## Decision Framework

Before starting a task, evaluate two factors:

1. **Duration** -- Will this take more than 30 seconds of wall-clock time?
2. **Complexity** -- Does this require multiple sequential steps with branching logic?

If both are YES, use a subagent. If either is NO, work directly.

---

## Use Subagents When

### Research & Web Tasks
- Web searches (multiple queries needed to answer a question)
- Competitor analysis (scrape + analyze multiple listings)
- eRank keyword research sessions (login + navigate + extract)
- Price comparison across marketplaces
- Finding trending products or keywords

### Long-Running API Sequences
- Bulk listing updates (more than 3 listings at once)
- Cross-platform sync (Etsy -> Shopify -> Pinterest pipeline)
- Order processing across multiple marketplaces
- Image generation + upload + listing update chains
- Trendyol batch operations (create/update products, then poll batch-status)

### Multi-Step Workflows
- "Create a new listing" (draft -> images -> personalization -> review -> publish)
- "Pin our top 10 listings to Pinterest" (fetch listings -> generate descriptions -> create pins)
- "Audit listing SEO" (fetch listing -> eRank analysis -> generate recommendations -> update)
- Daily e-commerce council / idea machine runs
- Weekly memory synthesis

### Tasks That May Timeout
- Browser automation with page loads (eRank, Canva)
- Large data exports or imports
- Operations requiring retries on rate limits

---

## Work Directly When

### Simple Replies
- Answering questions about the business ("What is our Etsy store ID?")
- Confirming information from memory files
- Casual conversation, greetings, small talk
- Translating messages between languages

### Single File Operations
- Reading MEMORY.md, USER.md, or other workspace files
- Writing a daily note
- Updating a single field in a memory file
- Creating a learning file after a mistake

### Single Command Execution
- Checking order status: `etsy.sh orders --limit 5`
- Getting a single listing: `etsy.sh listing 4448583799`
- Weather lookups
- Sending a single email via gog
- Running cron-health.sh

### Quick Lookups
- Calendar check: `gog calendar list`
- Gmail inbox: `gog gmail list`
- Trello board status
- Single Pinterest pin creation
- Checking a single Shopify product

### Heartbeat Actions
- Prayer time check + send reminder
- Quick cron health scan
- Single observation written to daily notes

---

## Subagent Configuration

### When Spawning a Subagent

1. **Name it clearly** -- Use a descriptive name that explains the task (e.g., "etsy-seo-audit-4448583799")
2. **Set a timeout** -- Default 5 minutes. Extend to 10 minutes for browser automation. Never exceed 15 minutes.
3. **Pass context** -- Include the specific task, relevant IDs, and expected output format
4. **Request structured output** -- Ask for JSON or markdown with clear sections so the result is easy to relay to the user

### Subagent Instructions Template

```
Task: [What to do]
Context: [Relevant IDs, constraints, user preferences]
Steps:
  1. [Step 1]
  2. [Step 2]
  ...
Output: [Expected format -- JSON object, markdown summary, etc.]
Constraints:
  - Do not change prices without confirmation
  - Use absolute paths for all scripts
  - Report errors clearly, do not retry more than once
```

---

## Failure Handling

### Subagent Fails

1. **Read the error** -- Check the subagent output for the specific error message.
2. **Report clearly** -- Tell the user what failed and why, in plain language.
3. **Retry once** -- If the error is transient (network timeout, rate limit), retry the subagent once.
4. **Fall back to direct** -- If the subagent fails twice, attempt the task directly with simpler steps.
5. **Escalate** -- If direct attempt also fails, report the full error chain to the user and suggest manual intervention.

### Error Reporting Format

When reporting an error to the user:

```
[Task] failed: [one-line summary]

Details: [specific error message from the tool/API]

What I tried:
- [attempt 1 and result]
- [attempt 2 and result]

Suggested next step: [what the user can do]
```

### Never Do

- **Never silently swallow errors.** Every failure must be reported.
- **Never retry more than once** without telling the user.
- **Never make up data** if an API call fails. Say "I could not retrieve this."
- **Never attempt OAuth setup** if a script fails with auth errors. Report it and suggest checking env vars.
- **Never bypass scripts** with direct API calls when a script fails. The scripts handle auth that direct calls cannot.

---

## Examples

### Example 1: User asks "How are Etsy sales this week?"

**Decision:** Single command -> Work directly.

```
Run: etsy.sh orders --limit 20
Summarize results to user.
```

### Example 2: User asks "Audit our top 5 listings and optimize their SEO"

**Decision:** Multi-step research + updates -> Use subagent.

```
Spawn subagent: "etsy-seo-audit"
  1. etsy.sh listings --limit 5
  2. For each listing: etsy.sh listing <id> (get current tags/title)
  3. For each listing: node erank.cjs keyword "<main keyword>"
  4. Generate optimized titles/tags based on eRank data
  5. Return recommendations as markdown table
Then: Present recommendations to user for approval before updating.
```

### Example 3: User asks "What time is my next meeting?"

**Decision:** Single command -> Work directly.

```
Run: gog calendar list
Return next event.
```

### Example 4: User asks "Create pins for our 10 best sellers"

**Decision:** 10 sequential API calls with data fetching -> Use subagent.

```
Spawn subagent: "pinterest-bulk-pin"
  1. etsy.sh listings --limit 10
  2. For each: pinterest.sh pin-from-etsy <id>
  3. Collect results (success/failure per listing)
  4. Return summary
```

### Example 5: User sends a video via WhatsApp and says "upload to listing 4448583799"

**Decision:** Single command -> Work directly.

```
Run: etsy.sh upload-video 4448583799 "<video_path>"
Confirm result to user.
```
