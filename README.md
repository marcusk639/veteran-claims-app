# veteran-claims-app — Knowledge Assistant

A Next.js 16 App Router chat assistant that answers veteran disability-claims questions grounded in retrieved source documents, with citations. This app is the **consumer** half of a two-repo architecture — it owns auth, chat UI, conversation persistence, rate limiting, and cost tracking, but has no document store or retrieval logic of its own.

## Two-repo architecture

This app talks to a companion repo, **`rag-system`**, over MCP (Model Context Protocol). `rag-system` owns document ingestion (connectors for SharePoint, Google Drive, Gmail, git-markdown, eCFR, etc.), chunking, embeddings, and hybrid (dense + sparse) retrieval, and exposes it as an MCP server. This app vendors thin AI-SDK tool wrappers around that server's tools (`mcps/localhost/mcp/`) and calls them from the chat route (`src/app/api/chat/route.ts`) so the model can search documents and cite what it finds. Without `rag-system` running and reachable, chat still works but falls back to a grounded-refusal response for every question (see "Troubleshooting" in [`docs/runbook.md`](docs/runbook.md)).

## Prerequisites

- **Neon Postgres project** — this app uses `drizzle-orm/neon-http`, which speaks Neon's HTTPS proxy protocol, not the plain Postgres wire protocol. A generic local Postgres container will not work; you need a real Neon project (a free tier is fine for local dev).
- **Clerk application** (dev instance) — email/password or your preferred sign-in method enabled.
- **A running `rag-system` MCP server** — clone and run that repo separately; this app expects it at `RAG_MCP_URL` (default `http://localhost:3001/mcp`).

## Environment variables

Copy `.env.example` to `.env.local` and fill in real values. `.env.local` is gitignored — never commit real secrets.

| Variable                            | Purpose                                                                                                                                                          | Where to get it                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `DATABASE_URL`                      | Neon Postgres connection string                                                                                                                                  | Neon dashboard → Project → Connection Details                                           |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key                                                                                                                                            | Clerk dashboard → Configure → API Keys                                                  |
| `CLERK_SECRET_KEY`                  | Clerk secret key                                                                                                                                                 | Clerk dashboard → Configure → API Keys                                                  |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`     | Must be `/sign-in` — routes unauthenticated users to this app's own sign-in page instead of Clerk's hosted Account Portal                                        | Fixed value, not a credential                                                           |
| `CLERK_WEBHOOK_SECRET`              | Verifies Clerk webhook signatures (signup event → PostHog)                                                                                                       | Clerk dashboard → Webhooks → your endpoint                                              |
| `POSTHOG_API_KEY`                   | Server-side analytics events                                                                                                                                     | PostHog project settings                                                                |
| `RAG_MCP_URL`                       | `rag-system`'s MCP server HTTP endpoint                                                                                                                          | Wherever you're running `rag-system`; default `http://localhost:3001/mcp` for local dev |
| `RAG_MCP_TOKEN`                     | Bearer token for the `rag-system` MCP server                                                                                                                     | Must match an entry in `rag-system`'s own `API_TOKENS` config                           |
| `COST_ALERT_THRESHOLD_USD`          | Dollar threshold for the LLM-spend alert webhook                                                                                                                 | Your own choice                                                                         |
| `COST_ALERT_WEBHOOK_URL`            | Where the cost alert POSTs when threshold is crossed                                                                                                             | Your own webhook/incident endpoint                                                      |
| `CRON_SECRET`                       | Bearer token securing `/api/cron/cleanup` (Vercel Cron auth)                                                                                                     | Generate a random value yourself                                                        |
| `AI_GATEWAY_API_KEY`                | Vercel AI Gateway auth for local/non-Vercel dev — the Gateway resolves automatically via OIDC when deployed on Vercel, but needs this explicitly everywhere else | Vercel dashboard → AI Gateway                                                           |

## Setup

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Testing

- `pnpm test` — unit and integration tests (Vitest). Requires `DATABASE_URL` set in `.env.local`; several suites (rate limiting, usage tracking, cost alerts, the cron cleanup job) hit a real database rather than mocking it.
- `pnpm eval` — the golden-questions evaluation suite (`src/app/api/chat/golden-questions.eval.ts`), checking that the assistant grounds real answers in retrieval and correctly refuses when nothing relevant is found. Requires a live `rag-system` MCP server and a working AI Gateway connection. **Not** part of `pnpm test` and **not currently run in CI** — run it manually, or wire it up as a separate non-blocking CI job later.
- `pnpm lint` / `pnpm typecheck` / `pnpm build` — standard checks, all run in CI (see `.github/workflows/ci.yml`).

## Next.js 16 migration notes

This app runs on Next.js 16, which has real breaking changes from what most training data and older docs describe — see `node_modules/next/dist/docs/` for the vendored, version-accurate docs before assuming an API shape.

- **`middleware.ts` → `proxy.ts`**: Next 16 renamed the middleware convention. This app's routing/auth logic now lives in `src/proxy.ts`, not `src/middleware.ts`. If you're used to older Next.js versions, don't recreate a `middleware.ts` file — it won't be picked up.

## Operations

See [`docs/runbook.md`](docs/runbook.md) for incident response: checking MCP reachability, rolling back a deployment, and troubleshooting rate-limit reports.
