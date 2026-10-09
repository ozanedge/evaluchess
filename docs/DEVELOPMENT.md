# Develop and check Evaluchess

Run the browser app locally, configure a separate API when needed, and verify changes with deterministic and isolated integration checks.

[Project overview](../README.md) · [Architecture](ARCHITECTURE.md) · [Contributing](../CONTRIBUTING.md)

## Prerequisites and local setup

Use Node.js 22 and npm. Computer play and local saved progress run in the browser. Authentication, online matches and account sync require the API.

From the repository root, install dependencies and start Vite:

```sh
npm ci
npm run dev
```

Open the address printed by Vite. The root [.env.example](../.env.example) documents server-side configuration.

## Development commands and API configuration

```sh
npm ci
npm run dev
npm run build       # type-checks the browser AND API, then builds
npm run lint
npm test            # deterministic game, storage, analysis and worker tests
```

The UI dev server can proxy a local API server with
`EVALUCHESS_API_URL=http://127.0.0.1:<port> npm run dev`.
The production API needs `DYNAMODB_TABLE`, `DYNAMODB_REGION`, and `AWS_ROLE_ARN`.
Vercel OIDC supplies short-lived AWS credentials; no AWS access keys are stored in
Vercel. Use a separate table and role for preview deployments. See
[the DynamoDB migration guide](DYNAMODB-MIGRATION.md) for infrastructure,
account transfer, and production cutover. The code change alone does not move
production data or provision AWS resources.

Accounts, password hashes, sessions, matchmaking, games, ratings, presence and
rate limits live in DynamoDB. Passwords are hashed with scrypt; the browser
receives an HTTP-only, secure, same-site session cookie. Guests can play without
accounts; only games between two verified, distinct accounts affect ratings.
The leaderboard ranks the top ten by wins in the rolling last 24 hours. Wins,
losses, draws and rating change (Δ Elo) all use that window. Completed rated games
write dated results atomically with ratings; two UTC-day partitions cover the
window, with an exact timestamp filter independent of DynamoDB TTL cleanup.
The Elo column shows the current account rating; Δ Elo shows its change in the last 24 hours.
API responses are cached for 30 seconds, and the open leaderboard refreshes every
30 seconds. Database failures show an error and a Retry action.

### Integration tests

Download [DynamoDB Local](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html)
and a Java 17+ runtime. Install the matching Playwright headless browser with
`npx playwright-core install chromium --only-shell`, then run:

```sh
export DYNAMODB_LOCAL_JAR=/absolute/path/to/DynamoDBLocal.jar
export JAVA=/absolute/path/to/bin/java  # omit if java is already on PATH
npm run test:api
npm run test:ui
npm run build && node tests/premoves.mjs # production-build click/drag premoves through arrows
node tests/mobile-play.mjs               # touch premoves, slow confirmations and resignation recovery
node tests/review-board.mjs              # review board/arrow synchronization in both orientations
node tests/settings.mjs                  # saved preferences, sound, premoves and resignation
node tests/ui-redesign.mjs               # responsive layout, milestones and keyboard review
node tests/account-progress-ui.mjs       # import, second device, offline retry and account isolation
```

`PLAYWRIGHT_EXECUTABLE_PATH` can select an existing headless browser binary.
Tests create an **in-memory DynamoDB Local process** and use the actual AWS SDK,
real tables, indexes and transactions. They never contact the production table.
UI tests run Vite on port 41531, block non-local browser requests and stop their
own processes afterward. Chromium sandboxing stays enabled.

Coverage includes concurrent matchmaking, unauthorized requests, out-of-turn
moves, duplicate/retried moves, threefold repetition, server clocks, resignation,
exactly-once ratings, online reload/resume, real Stockfish analysis, mistake
practice, persistent progress, PGN downloads, failed worker recovery, analysis
cancellation, and mobile overflow.


## Repository layout

The main application and optional worker have separate entry points:

```text
src/App.tsx           Play, review and practice flows
src/components/      Boards, analysis, settings and progress views
src/hooks/           Engine, clocks, matchmaking and account sync
src/lib/             Engine wrapper, chess rules and saved progress
src/utils/           Analysis and move-feedback calculations
api/                 Authentication, online games and account storage
public/              Browser Stockfish assets and app icons
chesscomputers/      Optional Node.js worker for online opponents
scripts/             Operator migration and rating tools
tests/               Unit, API and browser checks
docs/                Player, developer and architecture guides
```

For worker setup and its focused tests, read the [chess-computer guide](../chesscomputers/README.md).
