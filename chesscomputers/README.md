# Evaluchess chess-computer worker

An optional long-running Node process that keeps chess-themed accounts in the
Speed Pair pool. It uses the same public Evaluchess account and game APIs as a
browser. It has no direct database access and no Firebase dependency.

## Setup

Create `.env` from `.env.example` and set:

- `API_BASE` to the Evaluchess deployment.
- `CHESSCOMPUTER_PASSWORD` to one long random password used only for these accounts.

Create the accounts once, then start the worker:

```sh
# Install root dependencies too: the worker uses the project's Stockfish package.
npm ci --prefix ..
npm install
npm run setup:local
npm run start:local
```

The setup command is idempotent: existing accounts are verified with the configured
password and left in place. A password mismatch fails setup; it never resets an
existing account. Recover the correct credentials before restarting setup.

After creating accounts, initialize their starting ratings once with the operator
script below, from the repository root. This step needs the root dependencies and
AWS credentials for the intended table; the running worker does not. Omit
`--apply` to preview first.

```sh
AWS_PROFILE=skynetops DYNAMODB_REGION=us-west-2 DYNAMODB_TABLE=evaluchess-production \
  node --env-file=chesscomputers/.env \
  --import ./chesscomputers/node_modules/tsx/dist/loader.mjs \
  scripts/seed-bot-ratings.ts --apply
```

The ten `initialRating` values in `src/config.ts` span 400–1600. Initialization
verifies each configured account's password and shifts its 1200 starting point,
preserving earned rating changes and game statistics. A permanent marker prevents
repeat initialization, including concurrent runs. Account ratings and their
leaderboard entries update atomically. Ratings then change normally after games;
there is no daily reset.

The worker can run on any Docker host. Its only remote dependency is the
Evaluchess API configured by `API_BASE`; the API owns authentication, clocks,
moves, results and ratings.

## Tuning

Game frequency, time control, startup staggering and thinking time live in
`src/config.ts`.

Each bot's `initialRating` is also its fixed playing-strength target. The worker
uses the full Stockfish 18 engine already installed by the main project. Every
search enables `UCI_LimitStrength` and sets that bot's `UCI_Elo`. Stockfish's native
minimum is 1320; below that, a linearly increasing chance of a random legal move
adds mistakes (about 5% at 1250, up to 60% at 400). Targets are approximate, not
calibrated human Elo. See [Stockfish's strength controls](https://official-stockfish.github.io/docs/stockfish-wiki/Stockfish-FAQ.html#how-do-skill-level-and-uci-elo-work).

Strength stays fixed when an account's earned leaderboard rating changes. One
child engine serializes searches across bots, reapplies strength per move, and
limits each search to 250 ms. Engine failures are reported and retried on the next
tick; the worker does not silently switch everyone back to a shared weak engine.

| Bot | Strength target | Target games/day |
| --- | ---: | ---: |
| KasparovClone | 1600 | 25 |
| pawn.eater | 650 | 22 |
| Bishop-Bash | 950 | 19 |
| fianchetto | 1250 | 16 |
| Tal-hunter99 | 1450 | 13 |
| ZugZwang | 1350 | 11 |
| en.passant | 800 | 9 |
| Queen+Rook | 1100 | 7 |
| mattsquad | 550 | 5 |
| 64Squares | 400 | 3 |

These are averages for continuous uptime. Between-game waits have ±30% jitter;
opponent availability, actual game length and Mac sleep can reduce the totals.
All games are 5+0. Bots can pair with each other, so summing their individual game
counts double-counts those matches.

The schedule controls background games. During breaks, idle bots stay in a
standby queue and accept humans who have waited 12 seconds. A waiting human
always has priority over a bot; among available bots, the API chooses the closest
account rating. Standby bots do not pair with one another. The worker reserves
two idle bots from scheduled background games, and human matches can exceed the
daily targets. If all bots are playing or the worker is offline, matchmaking
continues waiting for an available opponent.

The server recognizes bots by their operator-created rating initialization
marker and authenticated account. Client-supplied names or bot flags cannot
grant standby access. Queue heartbeats expire after 20 seconds; polling preserves
the human's original wait time. Game creation and reservation are one DynamoDB
transaction, preventing two people from claiming the same bot.

## Supervised worker on this Mac

The worker is installed as `com.evaluchess.chesscomputers` in the user's
`~/Library/LaunchAgents/` directory. It starts at login and restarts after a
crash. Locking the screen does not stop it; sleep, logout, and shutdown pause
availability. Credentials are in the ignored `chesscomputers/.env` file with
owner-only permissions. Do not copy that file into a deployment or commit it.

Logs are in `~/Library/Logs/EvaluChess/chesscomputers.log` and
`chesscomputers-error.log`. All 10 accounts use the public account API and 5+0.
Their first background games are staggered 2–20 minutes after startup, then each
follows its configured games-per-day schedule. Standby starts immediately after
initialization and refreshes about every 6 seconds. Presence is refreshed every
50 seconds.

Account setup verifies the password for existing usernames and exits with an
error if any account cannot be configured. The worker refreshes authentication
before each new game and clears completed matches before rejoining the pool.

For an isolated end-to-end worker check, set `JAVA` and `DYNAMODB_LOCAL_JAR` as
in the main README, then run from the repository root:

```sh
node --import ./chesscomputers/node_modules/tsx/dist/loader.mjs tests/bots.mjs
node --import ./chesscomputers/node_modules/tsx/dist/loader.mjs tests/bot-ratings.mjs
node --import ./chesscomputers/node_modules/tsx/dist/loader.mjs tests/bot-engine.mjs
node tests/matchmaking-bots.mjs
```

This uses DynamoDB Local and a local API server; no live accounts are touched.
