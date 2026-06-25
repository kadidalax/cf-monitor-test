# CF VPS Monitor

Cloudflare Worker + Supabase HTTP Data API/RPC based VPS monitor.

## Architecture

- Cloudflare Worker provides all public, admin, agent, and live APIs.
- Supabase is accessed only from the Worker with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- The browser never receives Supabase keys.
- Durable Objects keep live viewer/agent state and reduce database writes.
- The Go agent stays small and policy driven.

## Quota Strategy

- Realtime page open: agent uploads every 3 seconds for live display.
- No realtime viewer: agent uploads every 120 seconds.
- Ping defaults to 120 seconds and is bundled into the nearest metrics report.
- Historical persistence keeps the 120 second grain by default.

## Required Worker Variables

Plain variables:

- `SUPABASE_URL`
- `SITE_TITLE`
- `SITE_DESCRIPTION`

Secrets:

- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

Put secrets in Cloudflare Worker secrets, not in frontend code or committed files.

## Supabase Setup

Apply every SQL file in `supabase/migrations` in filename order. The RPC functions explicitly revoke public execution and grant execution only to `service_role`.

Use the Supabase project URL for `SUPABASE_URL`. Use the service role key for `SUPABASE_SERVICE_ROLE_KEY`; do not use anon or publishable keys for the Worker backend secret.

For deployment automation, set `SUPABASE_ACCESS_TOKEN` only in your local shell or CI job before running `npm run deploy`. The deploy script pushes the Worker first, then runs `supabase db push --linked`. Do not store the Supabase personal access token in Worker secrets or frontend code.

## Development

Install dependencies in the root workspace, then run the frontend, Worker, or agent commands from the matching package.

Main checks:

- `npm --prefix frontend test`
- `npm --prefix worker test`
- `npm --prefix frontend run build`
- `npm --prefix worker run build`
- `cd agent && go test ./...`

## Agent

The agent can run in WebSocket mode or HTTP mode. It reads policy from the Worker and switches between realtime and background intervals automatically.

The report body may include metrics, basic info, GPU data, and ping results. Ping results are not sent as a separate high-frequency stream by default.

## Project Layout

- `frontend/`: React frontend, preserving the original page structure and routing.
- `worker/`: Cloudflare Worker API, Durable Objects, Supabase RPC facade.
- `agent/`: Lightweight Go agent.
- `supabase/`: SQL migrations and RPC definitions.
- `docs/superpowers/plans/`: implementation plans.
