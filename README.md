# Evaluchess

A chess app built for learning. Play against the computer or find a live human opponent, then get instant feedback on every game.

**Live at [evaluchess.com](https://evaluchess.com)**

## Features

### A chess club built for progress

A midnight-and-lime interface puts the board first, with a responsive play lobby,
clear live-game states, compact leaderboard standings and a dedicated result card.
Twelve training badges include nine activity milestones and three skill badges.
Each badge shows its requirement and progress. Earned badges remain unlocked when
older games leave the 50-game history. Signed-in players sync games, practice
attempts and earned badges to their account; guests keep progress on this device.
An unfinished practice position is one click away from the lobby.

| Badge | Requirement |
| --- | --- |
| First finish | Complete a game |
| Analyst | Get a game analyzed |
| Tactician | Solve a practice position |
| Regular | Complete 5 games |
| Problem Solver | Solve 5 different positions |
| Deep Thinker | Get 10 games analyzed |
| Tactics Expert | Solve 15 different positions |
| Veteran | Complete 25 games |
| Practice Master | Solve 50 different positions |
| Steady Hand | Complete an analyzed game without blunders, with 20+ of your moves |
| Precision | Reach 90% accuracy in an analyzed game, with 20+ of your moves |
| On the Rise | Improve average accuracy by 5 points: latest 5 vs previous 5 analyzed games, each with 20+ of your moves |

The header and settings stay accessible on phones, and the layout supports 320px
screens. Move-review rows work with the keyboard; focus the accuracy chart and use
arrow keys, Home or End to choose a move. Decorative motion respects reduced-motion
preferences.

### Account progress and personal improvement

Sign in to automatically import existing guest games and badges from this browser.
The latest 50 saved games, their analysis and practice attempts, and all earned
badges sync privately through the existing DynamoDB service. A fresh device
restores them after sign-in. Account caches are separate: signing out or switching
accounts does not transfer the previous player's collection. Player settings are
still device-local.

Local saves continue offline. The lobby shows sync status and a retry action;
pending changes survive reloads and retry after reconnection. Concurrent saves
merge solved attempts without replacing finished games with stale unfinished
ones. Different move histories are never spliced together. Account records do
not expire when an online match's live record expires. Clearing browser data
removes unsynced changes, but synced progress restores from the account.

**My progress** charts accuracy across the latest 20 analyzed games and compares
accuracy and blunders per game for the latest 5 against the previous 5. It uses
only the player's own moves in completed games and shows an empty state until
analysis is available. Successful practice counts distinguish retried mistakes
and blunders; they do not claim that a weakness has been permanently eliminated.
Skill badges require at least 20 player moves per qualifying game. Progress and
badges are personal, client-analyzed achievements and do not alter Elo or the
competitive leaderboard.

### Learning-focused analysis

- **Live evaluation bar** — see the engine's assessment of the position update in real time as you play
- **Post-game review** — after every game, the app automatically jumps to your first mistake so you can practice it without seeing the answer. Arrows stay hidden for practice mistakes until you choose **Show answer**
- **Move classification** — every move is labeled as Best, Good, Inaccuracy, Mistake, or Blunder with centipawn loss
- **Move comparison arrows** — from move 2 onward, live play shows feedback only for your moves: the played move in its classification color and the optimal move in bright green. Post-game reviews cover both players. Moves graded Best show one bright green arrow for the move played, including alternatives with no measured evaluation loss.
- **Position-matched feedback** — labels and arrows use the evaluations immediately before and after the move; your arrows fade over five seconds, persist through opponent replies, and clear immediately on your next move. Post-game review arrows stay visible.
- **Speed Pair fallback** — humans match first; after 12 seconds, an available bot joins automatically. Idle bots remain on standby between scheduled games, and bot opponents are labelled.
- **Your analysis first** — game stats, the accuracy chart, and move review default to your moves. Use the **Your moves / Opponent moves** toggle to switch perspectives.
- **Accuracy score** — get an overall accuracy percentage for the game, modeled after Chess.com's formula

### Game modes

- **Computer** — play against Stockfish at four difficulty levels: Novice (~800), Enthusiast (~1200), Expert (~1800), or Master (~2200)
- **Speed Pair** — get matched with a live human opponent automatically, no account needed

### Player settings

Open your profile menu (or **Settings** when playing as a guest). Preferences
are saved in this browser and apply immediately:

- **Move feedback** — live accuracy labels and arrows; on by default. Post-game
  analysis remains available when this is off.
- **Sound** — off by default. When enabled, plays move, capture and check sounds,
  plus one warning per game when your active clock reaches 20 seconds.
- **Premoves** — on by default. Turning this off also cancels any queued move.
- **Confirm resignation** — on by default; the clock continues while you decide.
- **Board colors and pieces** — Forest, Walnut or Slate blue, with Classic or
  Modern pieces. Appearance also applies to review and practice boards.
- **Pawn promotion** — Queen by default, with Rook, Bishop and Knight available.

### Other

- Every new game uses 5+0: five minutes per player, with no increment
- Choose to play as White or Black against the computer
- Online player count shown in real time

## Tech stack

- React 19 + TypeScript + Vite
- Tailwind CSS v4
- Stockfish 18 (WASM) for engine analysis and computer moves
- Amazon DynamoDB (on demand) + Vercel serverless functions for accounts, matchmaking and ratings
- Deployed on Vercel

## Development and checks

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
[the DynamoDB migration guide](docs/DYNAMODB-MIGRATION.md) for infrastructure,
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

## Games, reviews, and practice

- **My games** stores the latest 50 games, including incomplete computer games,
  completed reviews and practice progress. Signed-in players sync this collection
  to their account; guests keep it in their browser. Export PGN for a portable copy.
- **Resume** restores a computer game with its saved clocks. Online clocks keep
  running on the server during disconnects; resuming fetches the accepted move
  history, current clocks and final result. Online game records expire after
  24 hours. Saved reviews remain available afterward, including synced account copies.
- **Try this position again** appears on your mistakes and blunders. Practice
  uses the main board, with controls beside it (below on mobile). It hides the
  answer, checks legal moves with Stockfish, accepts the engine move or a move
  within 20 centipawns, and plays the continuation automatically. **Try again**
  resets the position; **Back to review** restores the selected review move.
  Revealing the answer does not mark the exercise solved. Practice progress is
  recorded separately from the original game and its analysis.
- Analysis can be paused and retried. Worker startup, crashes and stalled searches
  settle with a visible error rather than hanging. Cancelling a game or analysis
  discards stale engine replies. Search results are cached within an engine session.

## Online game protocol and rollout

Online state is stored under `evaluchess:game:v3:<id>`. A DynamoDB transaction
pairs both players and creates the board together. Each move carries an expected
ply and a unique request ID; a versioned compare-and-set transaction commits the
move, full history, clocks and result together. Retries are idempotent. The server
checks membership, side-to-move and legality and ignores client clock claims.
Polling uses the same game token as moves and returns the whole authoritative
snapshot. A hidden tab or brief disconnect no longer triggers an automatic
five-second resignation; the game clock continues normally.

Terminal results update both verified players' ratings in that same atomic
commit, once per game, alongside the result used by the 24-hour leaderboard;
DynamoDB is authoritative and the browser never writes ratings. Transactions
check the game and both rating versions, including when two games involving the
same player finish concurrently.

DynamoDB TTL cleans up sessions, queues, presence and expired games. Every read
also checks expiry immediately because TTL deletion is asynchronous. Account
and rating records never expire.

Deploy the UI and API together **between online games**. Account IDs, password
hashes, usernames and ratings can be copied from the previous Redis backend
using `scripts/migrate-storage.mjs`; active matches and sessions are not copied.
Players sign in again after the cutover. Follow the migration guide for the
write freeze, verification and rollback limits.
