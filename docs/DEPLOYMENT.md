# PIPFLOW Deployment Guide (Neon + Brevo + Deriv + GitHub + Render)

## 1. Neon PostgreSQL Setup
1. Create a database in Neon (`https://neon.tech`).
2. Run `database/schema.sql` and `database/seeds/seed.sql` using the Neon SQL Editor or `psql "$DATABASE_URL"`.
3. Create an administrator account by registering normally and promoting the user in SQL:
   ```sql
   UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'admin') WHERE email = 'your-admin@example.com';
   ```

## 2. Official Deriv App Registration
1. Visit `https://developers.deriv.com/` and register an application.
2. Copy your `app_id` into `DERIV_APP_ID` and `VITE_DERIV_APP_ID`.
3. Set the OAuth Redirect URL to `https://<your-api-domain>/api/deriv/oauth/callback`.

## 3. Brevo Transactional Email
1. Create an API key in Brevo (`https://app.brevo.com/`) and set `BREVO_API_KEY`.
2. Verify your sender email/domain (`BREVO_SENDER_EMAIL`).

## 4. Render Blueprint Deployment via GitHub
1. Push the repository to GitHub.
2. In Render Dashboard, click **New + -> Blueprint** and select your GitHub repository.
3. Render automatically reads `render.yaml` and provisions:
   - `pipflow-api` (Node Web Service rooted at `apps/api`)
   - `pipflow-web` (Static Site rooted at `apps/web`)
4. Configure all `sync: false` environment variables (`DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `DERIV_APP_ID`, `BREVO_API_KEY`, `FRONTEND_URL`, `VITE_API_URL`, `VITE_WS_URL`, `ADMIN_PRIVATE_SLUG`).
5. Verify `GET https://<your-api-domain>/api/health` returns `200 OK`.
