# Team App

A starter app with sign up, login, a protected dashboard, and Face ID / Touch ID
sign-in — built to grow. Backend is Node/Express + PostgreSQL, frontend is React
+ Vite, styled in a clean, Shopify-inspired UI.

## Project structure

```
backend/     Express API, Postgres access, auth (password + WebAuthn/Face ID)
frontend/    React app (Vite) — signup, login, dashboard
railway.json Deployment config for Railway
```

## 1. Run it locally in VS Code

You'll need Node.js 18+ and a local Postgres database (or a free one from
Railway/Neon/Supabase — grab its connection string).

```bash
# from the project root
npm run install:all
```

Create `backend/.env` from the example and fill it in:

```bash
cp backend/.env.example backend/.env
```

At minimum set `DATABASE_URL` (your Postgres connection string) and
`JWT_SECRET` (any long random string — `openssl rand -hex 32` works).

Then, in two terminals:

```bash
# terminal 1 — backend, http://localhost:4000
cd backend && npm run dev

# terminal 2 — frontend, http://localhost:5173
cd frontend && npm run dev
```

Open `http://localhost:5173`. Sign up, then from the dashboard try "Enable
Face ID" — it'll use your laptop's Touch ID / Windows Hello, since real Face ID
needs a phone.

**Note on WebAuthn locally:** it works fine on `localhost`, no HTTPS needed
there. The moment you deploy, though, the two settings below have to match
your real domain.

## 2. Deploy to Railway

1. Push this project to a GitHub repo, then in Railway: **New Project → Deploy
   from GitHub repo**.
2. **Add a PostgreSQL database** to the project (Railway → New → Database →
   PostgreSQL). Railway automatically injects `DATABASE_URL` into your app
   service — you don't need to set it yourself.
3. On your app service, open **Variables** and add:
   - `JWT_SECRET` — a long random string
   - `NODE_ENV` — `production`
   - `RP_ID` — your Railway domain with no protocol, e.g. `team-app.up.railway.app`
   - `ORIGIN` — the same domain with protocol, e.g. `https://team-app.up.railway.app`
   
   (You can find your domain under the service's **Settings → Networking**
   once Railway generates it — deploy once first, copy the domain, then set
   these two and redeploy.)
4. Railway will run `npm run build` (builds the frontend, installs the
   backend) and then `npm start` (`railway.json` already wires this up). One
   service serves both the API and the built frontend.

Face ID will only work over `https://`, which Railway gives you by default —
so it should work correctly on real devices once deployed.

## 3. What's already built

- Email/password sign up and login (passwords hashed with bcrypt)
- JWT-based sessions
- Face ID / Touch ID / Windows Hello sign-in via WebAuthn, once enabled from
  the dashboard
- A protected `/dashboard` route with a sidebar shell, stat cards, and one
  example authenticated API call (`GET /api/dashboard/summary`) — a template
  for adding real features
- A small reusable design system in `frontend/src/styles/index.css`

## 4. Where to add your next features

- New backend routes: add a file under `backend/routes/`, mount it in
  `backend/server.js`, protect it with the `requireAuth` middleware.
- New database tables: add `CREATE TABLE IF NOT EXISTS` statements to
  `backend/db.js`'s `initSchema()`.
- New pages: add a file under `frontend/src/pages/` and a `<Route>` in
  `frontend/src/App.jsx`. Reuse the `.panel`, `.stat-card`, and `.btn` classes
  from the shared stylesheet to stay visually consistent.
