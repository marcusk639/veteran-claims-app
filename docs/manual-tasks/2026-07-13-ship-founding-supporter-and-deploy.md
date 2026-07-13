# Ship the Founding Supporter Tier & Get the App Live

> **Date:** 2026-07-13
> **Author:** Claude Code (review before following)
> **Estimated time:** 60-90 minutes (excluding Vercel/Stripe account creation if you don't already have one)
> **Risk level:** Medium (production secrets, real payment links, and a first production deploy)

## Context

This session fixed the two Phase-0 shipping blockers (streamText lockup, `CRON_SECRET` gap)
and built the Founding Supporter tier (unlimited chat + priority model for $4.99/mo) end to
end in code — schema, gating logic, tests, and a `/support` page. None of it is committed,
merged, or deployed yet, and several pieces need things only you can do: real secrets, a
live Vercel project, and a Stripe account. This doc is the full list, in order.

## Prerequisites

Before starting, confirm:

- [ ] You have push access to `github.com/marcusk639/veteran-claims-app`
- [ ] You have (or are willing to create) a Vercel account/project
- [ ] You have (or are willing to create) a Stripe account
- [ ] You have production values ready for: Neon `DATABASE_URL`, Clerk production keys, `CLERK_WEBHOOK_SECRET`, `POSTHOG_API_KEY`

## Steps

### 1. Add `CRON_SECRET` to `.env.example`

**Where:** `veteran-claims-app/.env.example` (repo root)

Claude's own PreToolUse hook blocks any Edit/Write to a `.env*` file, so this one line has
to go in by hand. Append:

```
# Bearer secret for the retention cron (src/app/api/cron/cleanup/route.ts).
# When this env var is set on the Vercel project, Vercel Cron automatically
# sends it as `Authorization: Bearer $CRON_SECRET` on every scheduled
# invocation (see vercel.json's `crons` entry) -- generate a random value
# and set it in the Vercel dashboard, do not reuse this placeholder.
CRON_SECRET=changeme-generate-a-random-value
```

**Expected result:** `.env.example` documents `CRON_SECRET` alongside the other env vars.

---

### 2. Review and commit the `feat/founding-supporter-tier` branch

**Where:** `veteran-claims-app` repo, currently on branch `feat/founding-supporter-tier`

This branch has the streamText fix, the Founding Supporter schema/gating/tests, and the
`/support` page — all uncommitted. Review the diff (`git diff`), then commit and push:

```
git add -A
git commit -m "feat: fix streamText lockup, add Founding Supporter tier gating and /support page"
git push -u origin feat/founding-supporter-tier
```

Then open a PR against `main` and merge it (or merge locally if you prefer — see the
`finishing-a-development-branch` workflow for options).

> **Note:** this repo's working directory is shared with other concurrently-running Claude
> sessions (one was mid-rebase on `docs/phase7-documentation` during this session). Check
> `git branch --show-current` and `git status` before running any of the git commands
> above, in case the shared checkout has moved again.

**Expected result:** `main` has the streamText fix, Founding Supporter tier, and `/support`
page.

---

### 3. Create the Vercel project and deploy

**Where:** [vercel.com/new](https://vercel.com/new)

No Vercel project exists for this app yet (confirmed via the Vercel MCP — zero projects on
your account). Import `marcusk639/veteran-claims-app` from GitHub, framework preset
"Next.js" (should auto-detect).

Before the first deploy succeeds, add these environment variables in **Project Settings >
Environment Variables** (Production):

```
DATABASE_URL=<your production Neon connection string>
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<production pk_live_... key>
CLERK_SECRET_KEY=<production sk_live_... key>
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
CLERK_WEBHOOK_SECRET=<production whsec_... value>
POSTHOG_API_KEY=<your PostHog key>
RAG_MCP_URL=<your rag-system MCP server's public URL>
RAG_MCP_TOKEN=<a real, non-dev bearer token>
CRON_SECRET=<a freshly generated random value>
```

> **Warning:** do not reuse the dev/test Clerk keys or the `phase1-connectors-dev-token`
> RAG token in production — generate fresh values.

`COST_ALERT_THRESHOLD_USD` / `COST_ALERT_WEBHOOK_URL` and the two Stripe link env vars
(step 5 below) can be added later; the app runs without them.

**Expected result:** a production deployment succeeds and the app is reachable at your
`*.vercel.app` URL (or a custom domain if you attach one).

---

### 4. Extract `.full-review/` before it's lost (if not already done)

**Where:** `veteran-claims-app` repo root

`.full-review/` (the completed code-review audit trail: scope, findings, backlog) is
gitignored via `.worktrees/` and currently lives only in the working tree. Memory from this
session suggests this was already committed/preserved on 2026-07-13 — verify with:

```
git log --all --oneline -- .full-review/
```

If that returns nothing, copy `.full-review/` somewhere durable (or commit it to a docs
branch) before any worktree cleanup touches it again.

**Expected result:** `.full-review/`'s contents are safely tracked in git history somewhere,
not solely on disk.

---

### 5. Set up Stripe and create two Payment Links

**Where:** [dashboard.stripe.com](https://dashboard.stripe.com)

1. Create a Stripe account if you don't have one (or use an existing one).
2. **Payment Links > Create link** — a one-time or "customer's choice" donation amount, no
   recurring billing needed. Copy the resulting URL.
3. **Payment Links > Create link** again — a $4.99/mo recurring price for "Founding
   Supporter." Copy that URL too.
4. Add both to the Vercel project's environment variables:

```
NEXT_PUBLIC_DONATION_LINK=<donation Payment Link URL>
NEXT_PUBLIC_FOUNDING_SUPPORTER_LINK=<founding supporter Payment Link URL>
```

5. Redeploy (Vercel redeploys automatically on env var changes, or trigger one manually).

**Expected result:** `/support` shows live "Donate" and "Become a Founding Supporter"
buttons instead of the "coming soon" placeholders.

---

### 6. Activate a Founding Supporter (manual, until a webhook exists)

**Where:** a local shell with `DATABASE_URL` pointed at production, or the Neon SQL console

No Stripe webhook wires a payment to a user account yet (see `/support`'s own copy, which
tells payers to email you). When someone pays, get their Clerk `userId` (Clerk dashboard >
Users, or ask them to find it via their account settings) and run:

```sql
INSERT INTO founding_supporters (user_id) VALUES ('<their clerk user id>')
ON CONFLICT DO NOTHING;
```

Or, from the app's code, call `activateFoundingSupporter(userId)` from
`src/lib/founding-supporter.ts` in a one-off script.

**Expected result:** that user's chat requests skip the 40-msg/mo cap and use the priority
model (`openai/gpt-4.1`) on their next message.

> **Note:** building a real Stripe Checkout Session + webhook to automate this is the
> natural next engineering step once you have real Founding Supporters to justify it —
> not scoped in this pass.

---

## Verification

After completing all steps, verify:

- [ ] Production URL loads and `/sourcing-standard` + `/support` render
- [ ] Signing in and sending a chat message on `/dashboard/chat` gets a real response
- [ ] Triggering a forced network failure on `/dashboard/chat` shows the "Try again" recovery UI (not a permanently locked input)
- [ ] `/support` shows real Donate/Founding Supporter links once step 5 is done
- [ ] A manually-activated founding supporter's chat message uses the priority model (check Vercel function logs or add temporary logging)
- [ ] The retention cron (`/api/cron/cleanup`) shows a successful run in Vercel's Cron logs after `CRON_SECRET` is set

## Rollback

- Step 1 (env var doc) and step 4 (extracting review docs) are purely additive — nothing to roll back.
- Step 2 (git commit/merge): revert the merge commit or `git revert` if something's wrong post-merge.
- Step 3 (Vercel deploy): use Vercel's dashboard to roll back to the previous deployment instantly.
- Step 5 (Stripe links): Payment Links can be deactivated from the Stripe dashboard at any time without affecting past payments.
- Step 6 (manual activation): `DELETE FROM founding_supporters WHERE user_id = '<id>'` reverses it.

## Notes & Gotchas

- The chat route's per-minute rate limit (40 req/min) still applies to Founding Supporters — only the monthly message cap is lifted. This is intentional (abuse-floor, not a monetization gate).
- Don't set `NEXT_PUBLIC_FOUNDING_SUPPORTER_LINK` before you're ready to actually respond to activation emails — the CTA will be live the moment the env var is set.
- The synthesis doc (`docs/superpowers/findings/2026-07-13-product-strategy-synthesis.md`) gates all _further_ Document Workspace engineering on a real usage-signal checklist — don't start that work based on this deploy alone.
