# Incident-response runbook

## Checking MCP (rag-system) reachability

Chat works even when `rag-system`'s MCP server is unreachable — every question falls back to a grounded-refusal response instead of erroring, so a full outage is a **quality** problem (every answer becomes "I don't have relevant sourced information for that"), not a visible error to users. `/api/health` currently only checks the database, not MCP reachability.

To check manually:

```bash
# From wherever this app is running, replace $RAG_MCP_URL/$RAG_MCP_TOKEN
# with the actual configured values.
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $RAG_MCP_TOKEN" \
  "$RAG_MCP_URL"
```

A non-2xx/connection failure means `rag-system` is down, misconfigured, or the token doesn't match its `API_TOKENS` config. Check `rag-system`'s own logs/health endpoint next.

If this becomes a recurring on-call need, extend `/api/health`'s route (`src/app/api/health/route.ts`) to also probe MCP reachability and report both statuses — deliberately not done here, since that's a code change, not documentation.

## Rolling back a Vercel deployment

Two options, in order of speed:

1. **Vercel dashboard → Deployments → find the last-known-good deployment → "..." menu → Promote to Production** (a.k.a. Instant Rollback). Takes effect immediately, no rebuild.
2. **CLI**: `vercel rollback` (requires the Vercel CLI installed and authenticated against this project).

Rollback only reverts the deployed code/config — it does not revert database migrations. If the incident involves a migration, check whether it's backward-compatible with the prior code before rolling back; if not, coordinate a fix-forward instead.

## Troubleshooting rate limiting

There are two independent limits, both enforced in `src/app/api/chat/route.ts`:

- **Per-minute limiter** (`rate_limit_windows` table, key format `chat:<clerkUserId>`, 40 requests per 60-second window) — guards against abuse-scale bursts.
- **Monthly cap** (`usage_counters` table, `feature = 'knowledge_assistant_messages'`, keyed by `(user_id, feature, period_start)` where `period_start` is the first of the calendar month) — the actual free-tier "40 messages/month" limit.

If a user reports being incorrectly blocked, query directly (requires `DATABASE_URL` / a Neon SQL console):

```sql
-- Per-minute rate limit state for a specific user, most recent windows first
SELECT * FROM rate_limit_windows
WHERE key = 'chat:<their-clerk-user-id>'
ORDER BY window_start DESC
LIMIT 10;

-- Monthly usage count for the current period
SELECT * FROM usage_counters
WHERE user_id = '<their-clerk-user-id>'
  AND feature = 'knowledge_assistant_messages'
ORDER BY period_start DESC
LIMIT 3;
```

Both tables are cleaned up automatically by the retention cron (`/api/cron/cleanup`, runs daily at 03:00 UTC) — `rate_limit_windows` rows older than 1 day and `usage_counters` rows older than 90 days are deleted, so historical windows won't be queryable indefinitely.

If a `count` looks wrong (e.g., incremented without a corresponding real request), that's a correctness bug in `src/lib/rate-limit.ts` / `src/lib/usage.ts`, not a data problem — don't hand-edit these rows as a fix; treat a wrong count as a signal to investigate the increment logic.

## Escalation path

<!-- Fill in with your actual on-call/escalation contacts before relying on this runbook in production. -->

- Primary: _TODO — who owns this app in an incident_
- Secondary / backup: _TODO_
- `rag-system` on-call (for MCP-side outages): _TODO_
