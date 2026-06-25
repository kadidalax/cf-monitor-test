# cf-vps-monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the monitor project to a simple Cloudflare Worker + Supabase HTTP API/RPC architecture while preserving the original frontend layout and reducing Worker/Supabase usage.

**Architecture:** The Worker exposes REST v1 APIs, talks to Supabase only through `SUPABASE_URL` and a server-side API key, and uses Durable Objects for live state. The Go Agent switches between realtime and background collection based on live-page watchers. The React frontend keeps the existing page structure and only opens live watch connections from realtime pages.

**Tech Stack:** Cloudflare Workers, Hono, Supabase Data API/RPC, React, Vite, Radix Themes, Go.

---

## Summary
- Migrate the current `C:\工作区\monitor2` working tree to `C:\工作区\cf-vps-monitor`.
- Use Cloudflare Worker + Supabase HTTP Data API/RPC, without Hyperdrive and without direct Postgres connections.
- Preserve the original frontend structure and layout, only polishing color and details.
- Save quota with adaptive collection: realtime pages trigger 3 second upload/display; no viewers uses 120 second batch upload; ping defaults to 120 seconds and is included in reports.

## Implementation Steps
- Save this plan at `docs\superpowers\plans\2026-06-25-cf-vps-monitor-refactor.md`.
- Copy the current `monitor2` working tree into `cf-vps-monitor`, preserving uncommitted source changes.
- Refactor Worker:
  - Remove direct Postgres provider, `DATABASE_URL`, Hyperdrive-related config, and the `postgres` dependency.
  - Use only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for Supabase HTTP API/RPC.
  - Keep modules focused around `public`, `auth`, `admin`, `agent`, `live`, `db`, and `security`.
  - Use a consistent REST v1 response shape.
- Refactor Supabase:
  - Add missing RPC coverage for user management, login rate limits, audit logs, history cleanup, backup restore, and website monitor updates.
  - Explicitly revoke/grant function permissions and set a fixed `search_path` for required `security definer` functions.
- Refactor Agent:
  - Keep the lightweight Go implementation.
  - Separate collector, scheduler, reporter, and ping behavior.
  - Switch scheduler between 3 second realtime mode and 120 second background mode based on Worker config.
  - Default ping to 120 seconds and include ping results in the nearest metrics report.
- Refactor Frontend:
  - Preserve routes, pages, and layout structure.
  - Connect to `/api/v1/live/watch` only from realtime pages.
  - Refresh theme tokens with a neutral palette inspired by linux-do/cdk.
- Verify:
  - Run Worker, Frontend, and Agent tests.
  - Locally check public home, realtime page, admin login, settings, and Agent reporting.

## Assumptions
- Do not keep old API compatibility layers unless a tiny temporary route is required for an install script.
- Supabase keys stay server-side in Worker secrets and are never exposed to the browser.
- 3 second data is primarily for realtime display; persisted history remains 120 second granularity.
- Komari is reference material only; do not copy its larger architecture.
