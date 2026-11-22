# Pipflowtrade.site (Pipflowtrades) — Official Deriv API Trading Terminal, Bot Builder & Market Analyser

**Pipflowtrade.site** unifies four Deriv trading workspaces (Bot Builder, Accumulators, Digits, and Rise/Fall) alongside MT5 multi-asset charting (`lightweight-charts`) on one branded React + Express + PostgreSQL + WebSocket platform backed by `@deriv-com/smartcharts-champion`.

## Repository Structure

- `apps/web`: Unified React + Vite + TypeScript + Tailwind CSS frontend (`https://pipflowtrade.site`)
- `apps/api`: Node.js + Express + WebSockets + Official Deriv WS API backend
- `apps/deriv-bot`, `apps/deriv-accumulators`, `apps/deriv-digits`, `apps/deriv-rise-fall`: Extracted source modules from the original Deriv archives (originals preserved untouched in root)
- `database/`: PostgreSQL schema (`schema.sql`), incremental migrations (`migrations/001–003`), and seeds (`seeds/`)
- `docs/`: `ARCHIVE_MAPPING.md`, `ARCHITECTURE.md`, `DATABASE.md`, `API.md`, and `DEPLOYMENT.md`
- `render.yaml`: Render Blueprint for deploying `pipflowtrades` (`https://pipflowtrade.site`)

## Quick Start

1. Copy `.env.example` to `.env` and populate `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `DERIV_APP_ID`, `DERIV_CLIENT_SECRET`, `BREVO_API_KEY`, `JWT_SECRET`, and `ADMIN_PRIVATE_SLUG`.
2. Install dependencies and start the development server (`npm install && npm run dev`).
3. Refer to `docs/ARCHIVE_MAPPING.md` for archive provenance and `docs/DEPLOYMENT.md` for Render production deployment.
