# X Zone App

Member records, a roster, and account management for X Zone. Backend is Node/Express + PostgreSQL, frontend is React
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

Open `http://localhost:5173` and sign up. The first account, and any account
using the `OWNER_EMAIL` address, gets full access; everyone after that starts
with none until the owner puts them in a group on the Admin tab.

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
   - `OWNER_EMAIL` — the email that owns the instance (defaults to
     `ashtonhengyongxin@gmail.com`). That account is always an admin, whether
     it signs up before or after you set this.
   
   (You can find your domain under the service's **Settings → Networking**
   once Railway generates it — deploy once first, copy the domain, then set
   these two and redeploy.)
4. Railway will run `npm run build` (builds the frontend, installs the
   backend) and then `npm start` (`railway.json` already wires this up). One
   service serves both the API and the built frontend.

Face ID enrolment only works over `https://`, which Railway gives you by
default, so it works on real devices once deployed.

## 3. What's already built

- Email/password sign up and login (passwords hashed with bcrypt)
- Account groups — Owner, Admin, Leader, Member, and No access — defined in
  `backend/lib/groups.js`. Each group holds named permissions
  (`viewDirectory`, `editDatabase`, `manageAccounts`), the API guards every
  route with one, and the app hides what a permission does not allow. Add a
  group or move a permission between groups in that one file. New sign-ups
  land in No access until someone puts them in a group.
- An Admin tab: your own PIN and Face ID, plus — for anyone with
  `manageAccounts` — the list of everyone who can sign in, with add, remove,
  and change-group
- JWT-based sessions that end when the app is closed — the token lives in
  `sessionStorage`, so the next launch asks for a PIN rather than reopening an
  old session
- A 4-digit PIN: every new account is asked to choose one right after sign up,
  and returning to the app opens on the PIN screen instead of the sign-up card.
  Five wrong PINs locks PIN entry for 15 minutes; the password always still
  works. Manage or turn it off from the dashboard.
- An owner account (`OWNER_EMAIL`) that is always an admin
- The people database as an editable spreadsheet at `/database` — every column
  in one grid, colour-coded roles, add and remove rows, save the whole screen in
  one transaction. Roles and their colours are standardised in
  `frontend/src/lib/roles.js`; edit that one list and the whole app follows.
  (Bulk loading from a CSV is a terminal job now:
  `node backend/scripts/importPeople.js file.csv`.)
- Face ID / Touch ID / Windows Hello enrolment via WebAuthn, on the Admin tab.
  Signing in with it is not offered on the sign-in screen yet — the PIN is the
  way back in — but the backend routes are all there for when it is.
- A dashboard of stat cards and headed sections — Birthdays, Follow-ups — with
  the people they are about listed underneath; every row opens that person's
  scorecard on the Members tab
- Members: the member list beside the scorecard, searchable, deep-linkable as
  `/members?person=<id>`
- A personality quiz at `/personality`, asked of every account that has no type
  yet: right after sign-up, or on the next launch for anyone already here. 12
  two-sided questions written for the church family, one tap each.
  Scored on the server by `backend/lib/personality.js`, which also holds the
  questions and the sixteen types. The type is saved on the account, shown on
  the scorecard, the database grid and the accounts list; every sitting's answers
  are kept in `personality_results`. `npm test --prefix backend` checks the
  scoring and that the questions stay balanced.
- An Admin dashboard at `/admin`: a grid of tiles for everything in the app, each
  account seeing only what it can open. Leaders can also preview the whole app as a
  member from there (`X-View-As`, which only ever takes access away).
- Narnia BM, for cleaning the two big rooms together. `/narnia` is what everyone
  reads: each room's photos, logistics and tasks. Editing and running it is under
  `/admin/narnia`. A room keeps one logistics list and each task picks from it.
  A leader starts a session, which makes a QR code; people
  scan it with the phone's own camera and land on `/narnia/in/<code>`. That offers
  signing in first (an account already signed in is checked in without asking), and
  typing a name for as long as the leader leaves that switched on. The leader sends
  each person to a room and tasks by tapping or dragging, or with "Share out evenly",
  and their phone updates itself to show what to do and what to use. Who came and who didn't is under History, for leaders only, and is
  not part of the weekly registers.
  Leaders and admins run it (`RUN_NARNIA` in `backend/lib/groups.js`). The reasoning
  is in `backend/lib/narnia.js`, the routes in `backend/routes/narnia.js`.
- A small reusable design system in `frontend/src/styles/index.css`

## 4. Where to add your next features

- New backend routes: add a file under `backend/routes/`, mount it in
  `backend/server.js`, protect it with the `requireAuth` middleware.
- New database tables: add `CREATE TABLE IF NOT EXISTS` statements to
  `backend/db.js`'s `initSchema()`.
- New pages: add a file under `frontend/src/pages/` and a `<Route>` in
  `frontend/src/App.jsx`. Reuse the `.panel`, `.stat-card`, and `.btn` classes
  from the shared stylesheet to stay visually consistent.
