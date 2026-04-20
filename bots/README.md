# Evaluchess Bot Worker

Long-running Node process that runs 10 chess-themed bot accounts. Each bot:

- Has its own **target games-per-day** ranging from ~25/day for the most active bot down to ~3/day for the least active. See `BOT_PROFILES` in `src/config.ts`.
- First game lands within 2–20 min of worker startup (staggered so they don't swarm the pool).
- Joins **Speed Pair 5+0** matchmaking via the same `/api/join` endpoint the web app uses.
- Plays with a **novice (~800 Elo) heuristic** engine — takes mates and hanging pieces, blunders occasionally, prefers the center slightly.
- Has its **Elo, wins, losses, draws reset to 0** each day at midnight UTC, with a fresh random Elo between **1225 and 1475**.
- Writes to `/users/<uid>` + `/gameEvents/<uid>` in Firebase so it shows up naturally on the 24h leaderboard.

## One-time setup

1. **Generate a Firebase service account**
   - Firebase Console → gear icon → **Project settings** → **Service accounts** tab → **Generate new private key** → download JSON.

2. **Copy the env template**
   ```bash
   cd bots
   cp .env.example .env
   ```

3. **Fill in `.env`** with values from the downloaded service-account JSON:
   - `FIREBASE_PROJECT_ID` = `project_id`
   - `FIREBASE_CLIENT_EMAIL` = `client_email`
   - `FIREBASE_PRIVATE_KEY` = `private_key` (wrap the whole multi-line string in `"…"` so the literal `\n` characters survive)
   - `FIREBASE_DATABASE_URL` = `https://<your-project>-default-rtdb.firebaseio.com`

4. **Install + create the 10 bot accounts**
   ```bash
   npm install
   npm run setup
   ```
   This creates each bot as a Firebase Auth user, claims its username, and seeds its profile with a random Elo in [1225, 1475].

## Running locally

```bash
npm start
```

Watch the logs — each bot announces when it joins the pool, makes a move, or finishes a game.

## Deploying on Railway (recommended)

1. Push the repo to GitHub (the `bots/` folder lives inside it).
2. On [Railway](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
3. In the project settings:
   - **Root directory**: `bots`
   - Railway will auto-detect the Dockerfile and build it.
4. Add the same four `FIREBASE_*` env vars from your local `.env` to Railway's variables panel.
5. Deploy.

Railway's Hobby plan is $5/mo and keeps the process running 24/7. Memory usage is negligible (<150 MB).

## Other hosts

- **Fly.io**: `fly launch` inside `bots/`, then `fly secrets set FIREBASE_PROJECT_ID=... FIREBASE_CLIENT_EMAIL=... FIREBASE_PRIVATE_KEY="..." FIREBASE_DATABASE_URL=...`
- **Render**: Background Worker → point at `bots/` → Docker → add secrets.
- **Any Docker host**: `docker build -t evaluchess-bots bots && docker run --env-file bots/.env evaluchess-bots`

## Tuning

All knobs live in `src/config.ts`:

| constant | default | effect |
| --- | --- | --- |
| `BOT_PROFILES` | 10 bots, 25 → 3 games/day | bot list + per-bot target rate |
| `TIME_CONTROL` | `'5+0'` | matchmaking time control |
| `INITIAL_*_WAIT_MS` | 2–20 min | delay before each bot's first game |
| `computeNextWaitMs` | `1d / rate - 4m`, ±30% jitter | between-games wait sampler |
| `THINK_*_MS` | 2.5–7.5 s | per-move "thinking" delay |
| `DAILY_ELO_MIN/MAX` | 1225–1475 | daily reset band |

## Manual reset

If you want to force a rating reset without waiting for midnight:
```bash
npm run reset
```
