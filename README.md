# PIPFLOW — Official Deriv API Trading Terminal & Market Analyser

PIPFLOW is an independent trading analysis, MT5-inspired candlestick charting, and read-only Deriv account management platform built with React, TypeScript, Tailwind CSS, Node.js, Express, WebSockets, Neon PostgreSQL, and Brevo.

## Repository Structure

- `apps/web`: React + Vite + TypeScript + Tailwind CSS frontend (`pipflow.site` UI/UX)
- `apps/api`: Node.js + Express + WebSockets + Official Deriv WS API backend
- `database/`: Neon PostgreSQL schema (`schema.sql`), migrations (`migrations/`), and seed data (`seeds/`)
- `docs/`: Architecture, Database, API, and Render Deployment documentation
- `render.yaml`: Render Blueprint for deploying `pipflow-api` and `pipflow-web`

## Quick Start

1. Copy `.env.example` to `.env` and populate `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `DERIV_APP_ID`, `BREVO_API_KEY`, and `JWT_SECRET`.
2. Run `database/schema.sql` and `database/seeds/seed.sql` on your Neon PostgreSQL database.
3. Install dependencies and start the development server (`npm install && npm run dev`).
4. Refer to `docs/DEPLOYMENT.md` for GitHub + Render production deployment.
