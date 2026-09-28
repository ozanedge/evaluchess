# DynamoDB cutover status — 2026-09-24

## Provisioned

- AWS profile: `skynetops`; account: `488182247140`; region: `us-west-2`.
- CloudFormation stack and table: `evaluchess-production`.
- Table and leaderboard index are ACTIVE; on-demand billing, TTL, point-in-time
  recovery and deletion protection are enabled.
- Runtime role: `arn:aws:iam::488182247140:role/evaluchess-production-RuntimeRole-6F9poXkpaUy4`.
- Vercel project: `prj_aVuQqsPAmIZPxaEAjASm5HOJYe5E`, team `ozan-4084s-projects`.
- Production DynamoDB environment variables are configured. Vercel uses the
  team's OIDC issuer; role trust matches this project and production exactly.
- Current deployment: `dpl_FoZLEY4PHUxGVXPyCtdwnaNqXwaw` at
  <https://evaluchess-1eas42rvo-ozan-4084s-projects.vercel.app>.
  Deployed with `--prod --regions sfo1`; Vercel reports READY and assigns `evaluchess.com`.

## Live with fresh accounts

On 2026-09-24 the user explicitly authorized launching with fresh accounts and
ratings. Deployment `dpl_EcvRxbzeRQt3TPUdZDkwS94sMUFq` was promoted successfully;
then cleanup deployment `dpl_2xXvtLJkRhzWFkw1SZVZGsCXXkxc` rebuilt the app without
the unused Upstash variables. The Vercel alias API confirmed the cleanup deployment was live.

No source accounts or ratings were imported. Existing users must register again,
and ratings start from the default. Browser-local saved game history is unchanged.
The source Upstash database remains inaccessible due to its rate limit and has
not been deleted. Both Upstash project environment variables have been removed.
The new API uses DynamoDB only; there is no Redis fallback.

Do not later import old records over newly created accounts or ratings. Any
recovery would need an explicit reconciliation plan to preserve new activity.

Vercel CLI authentication refreshed successfully. No git commit or push was
performed. Verification used the successful Vercel build/promotion, domain alias
metadata, the active AWS table/index, and the prior local API/browser suites.
No live application requests were made for verification.

## Five-minute games

Deployment `dpl_9NitAKzZ1p7F12aGWc4eUkVzSnCR` is READY and assigned to
`evaluchess.com`. The time-control selector is removed. All new computer and
online games use 5+0; the server rejects other time controls. Bot configuration
also uses 5+0. Existing games retain their remaining clocks when resumed.

Validation passed: production build, lint, 7 core tests, DynamoDB Local API
suite, full browser suite, and the bot TypeScript check.

## Home link

Deployment `dpl_FoZLEY4PHUxGVXPyCtdwnaNqXwaw` is READY; the Vercel alias API
confirms `evaluchess.com` points to it. The header logo and Evaluchess name now
share an accessible link to `/`. Build and lint passed.

## Bot worker restored

All 10 configured bot accounts were recreated through the production account API
on 2026-09-24 and authenticated successfully. Initially all received the ordinary
1200 account rating; the correction below gives each its intended starting point. Their new
password is stored only in the ignored, mode-0600 `chesscomputers/.env` file.

The worker runs on this Mac under `com.evaluchess.chesscomputers` (user LaunchAgent),
with automatic restart and startup at login. Logs live in
`~/Library/Logs/EvaluChess/`. Screen locking does not stop the worker; sleep,
logout and shutdown interrupt it. Games follow the existing 2–20 minute startup
stagger and per-account daily schedule.

Worker repairs include API-compatible player IDs, account and presence rate-limit
retries, paced startup/heartbeats, session renewal before new games, clearing
finished matches before requeuing, and graceful shutdown. The worker integration
check passed against DynamoDB Local, including a legal move, scoring, a second
match, and presence retries. No web deployment was needed for worker changes.

## Bot rating spread corrected

On 2026-09-24, the operator-only `scripts/seed-bot-ratings.ts` initialized the
ten live bot accounts: 64Squares 400, mattsquad 550, pawn.eater 650, en.passant
800, Bishop-Bash 950, Queen+Rook 1100, fianchetto 1250, ZugZwang 1350,
Tal-hunter99 1450, and KasparovClone 1600. Account and leaderboard ratings
are updated together; game statistics and earned rating changes are preserved.
The worker continues running and reads fresh ratings when joining its next game.
Existing matches can retain their original displayed opponent-rating snapshot.
No worker restart or web deployment is necessary for this data correction.

The one-time initialization marker prevents repeated resets. At this point the
move engine was still shared; the strength update below supersedes it.
Build, lint, worker/operator TypeScript checks and the DynamoDB Local
rating tests passed, including concurrent initialization, preservation of results,
password checks, human-account protection and leaderboard consistency.

## Bot playing strengths

The worker now uses the project's existing full Stockfish 18 engine. Each bot
keeps a fixed strength target from its configured initial rating, independent of
its changing leaderboard rating. Every search reapplies `UCI_LimitStrength` and
`UCI_Elo`; targets below the engine's 1320 floor add progressively more random
legal moves. These are approximate difficulty levels, not calibrated human Elo.
The games-per-day schedules remain 25, 22, 19, 16, 13, 11, 9, 7, 5 and 3 with
±30% wait jitter, all at 5+0. Mac uptime and matchmaking affect actual totals.

Verification output:

```text
PASS: ten distinct strengths, real Stockfish moves/promotion, serialized settings, terminal positions, crash recovery, illegal moves and timeout cleanup
PASS: bot accounts, presence retry, legal moves, results, ratings, requeue and shutdown
```

Production build, lint and worker TypeScript checks passed. Four local games
alternating colors between the 1600 and 400 targets ended in four wins for the
1600 target (51, 52, 69 and 34 plies); this is a smoke check, not Elo calibration.

The supervised worker restarted at 2026-09-24 13:57 PDT after all active games
finished. Startup logs confirm all ten individual targets. At 13:59 PDT the
LaunchAgent was running (PID 82553) and DynamoDB showed ten fresh bot heartbeats.
No new worker errors were logged. No web deployment was needed for this change.

## Leaderboard ranks by wins

Deployment `dpl_4fLksX7voCcxJxAfw8ZhEDMyoQLs` is READY and promoted to
`evaluchess.com`. The heading is “Top 10 by wins · All time,” wins appear before
Elo, and the API queries the new `leaderboard-wins` DynamoDB index in descending
win order before limiting to ten. This selects winners across all accounts,
including players outside the previous Elo top ten.

CloudFormation change set `leaderboard-wins-20260924` updated the existing table
and query permissions without replacing resources. The index reached ACTIVE
before the site was promoted. All 13 existing rating records were backfilled
conditionally; ratings and game statistics were preserved. The old Elo index
remains for compatibility. The new index query placed ozanedge first with four
wins at verification. Vercel's alias API confirmed the live domain assignment.

Build, lint, worker/operator TypeScript checks, seven core tests, the full API
and browser suites, bot-rating tests, and the new leaderboard checks passed:

```text
PASS: global top ten by wins, low-Elo winner, legacy backfill, dry run, idempotency and preserved statistics
```

No git commit, push or branch operation was performed. Deployment verification
used local integration tests, AWS index queries and Vercel control-plane metadata.

## Live move comparison arrows

Deployment `dpl_3fG1bYeRdTLtFvRktQtyzBQFivgB` is READY and assigned to
`evaluchess.com`, confirmed through Vercel's deployment and alias metadata.
Starting at full move 2 (after both opening moves), live play and saved reviews
show the played move in its classification color and the optimal move in bright
green. An exact best-move match shows only the bright green arrow. The existing
live text classification remains visible and matches the played-arrow color.

Feedback now evaluates the exact before/after positions, reuses cached engine
results and suppresses stale feedback as the board advances. Online resumes
also evaluate their last saved move. Arrows support either board orientation,
knight paths and distinct promotions to the same square without blocking clicks
or dragging. No changes to live data or the bot worker were needed.

Build, lint, nine core tests and the full browser suite passed. Browser checks
cover real Stockfish feedback for both clients, matching label/arrow colors,
online resume, optimal-move deduplication and delayed evaluations. The board
was also visually inspected using a local browser screenshot.

```text
PASS: live move arrows, matching label colors, Black orientation, optimal-move deduplication and stale evaluation protection
```

## Best-grade arrow consistency

Deployment `dpl_5MuqxsYmYz6HAjYnSrPvck8jP4rN` is READY and assigned to
`evaluchess.com`, confirmed by Vercel inspect. Moves graded Best now show only
one bright green arrow for the move played, including alternatives with no
measured evaluation loss. Previously, the label accepted these alternatives
while the arrows collapsed only exact matches to the engine's preferred move.

Build, lint, all nine core tests and the full browser suite passed. Regression
coverage checks no-loss alternatives for both colors and the rendered browser
arrows, while retaining two arrows for lower grades.

```text
PASS: live move arrows, matching label colors, Black orientation, exact and no-loss Best deduplication and stale evaluation protection
```

## Speed Pair bot fallback

Deployment `dpl_HWswhTuLawVcLFuUDqEnDPQ7WpfP` is READY and assigned to
`evaluchess.com`, confirmed by Vercel inspect. The server preserves each player's
wait start across polls, prioritizes humans, and pairs with an available bot
after 12 seconds. Available bots are ordered by proximity to the player's
account rating. Reservation and game creation are atomic; stale heartbeats and
cancelled searches cannot create a new match.

Idle bots now remain in standby during their scheduled breaks, and two idle
bots are reserved from background games. Their configured playing strengths
remain unchanged. The waiting screen explains the fallback and matched bots
are labelled. Bot eligibility comes from authenticated, operator-initialized
accounts, not a client-supplied flag. Worker availability and the number of idle
bots still bound capacity; offline or fully occupied pools keep waiting.

Validation: production build, lint, worker TypeScript check, nine core tests,
API integration suite, dedicated matchmaking tests, worker integration tests,
and the full browser suite passed.

The idle worker was restarted gracefully with SIGTERM after deployment; launchd
started PID 11345. A strongly consistent production DynamoDB query confirmed
all ten bots had fresh standby queue entries. The worker log reported all ten
accounts initialized, with no new errors.

```text
PASS: 12-second bot fallback, human priority, closest rating, standby, stale heartbeat, cancellation, atomic reservation and authenticated bot identity
PASS: idle worker accepts the 12-second fallback during cooldown and plays a rated-strength move
PASS: browser automatically pairs with a labelled bot after 12 seconds, without another click
```

## Waiting-screen copy removal

Deployment `dpl_3Qx6Nc49GJ4S7NcJ45qxdUnkqgsz` is READY and assigned to
`evaluchess.com`, confirmed by Vercel inspect. Removed the sentence explaining
the 12-second bot fallback from the waiting screen. Updated the existing UI
test to wait for the remaining search heading. Build and lint passed.

## Start Game after a completed match

Deployment `dpl_AghK6iAZZBEZxrcpsLUj9qb6HhpQ` is READY; Vercel's alias API
confirmed it serves `evaluchess.com`. Matchmaking now releases completed or
expired assignments before searching again, including timeouts that have not
yet been finalized. Active games still resume, and session ownership and atomic
queue updates remain enforced. The client clears its previous match and ignores
late polling responses when a new search starts.

Build, lint, API integration, bot fallback tests and the full browser suite
passed. Browser coverage reproduces Start Game after both home navigation and
refresh and checks that the next match has a new ID, starting board and no result.

```text
PASS: Start Game releases completed, timed-out and expired matches; active games and retry safety are preserved
PASS: Start Game after home navigation or refresh creates a fresh match instead of reopening the old result
```

## Live feedback for the player's moves

Deployment `dpl_D2RvvxY3KEF6cJXhhyvwFKT7aS3Z` is READY and assigned to
`evaluchess.com`, confirmed by Vercel inspect. Live comparison arrows and move
classifications now require the evaluated move to belong to the local player.
They clear when the opponent replies. Full post-game review covers both players,
as requested; the position evaluation bar continues updating.

Build and lint passed. Browser coverage checks White and Black, restored online
games, computer replies, delayed evaluation responses and opponent arrows in
post-game review. The first full run timed out waiting for a mocked evaluation
label; an isolated replay and the subsequent full suite passed.

```text
PASS: opponent move arrows remain available in post-game review
PASS: own-move feedback only for White and Black, computer replies hidden, matching colors, Best deduplication and stale evaluation protection
```

## Rolling 24-hour leaderboard

Deployment `dpl_3y6H2RuhdxWUGVeT15fHa6hxEhh5` is READY and assigned to
`evaluchess.com`, confirmed by Vercel inspect. Rankings now use wins in the
rolling last 24 hours; losses, draws and Δ Elo use the same interval. The open
leaderboard refreshes every 30 seconds. Account ratings continue to accumulate
normally.

Each completed rated game writes a dated result atomically with the game and
both ratings. Two existing-table UTC-day partitions cover the window; exact
timestamp filtering removes aged results without relying on TTL deletion.
No new AWS resource, runtime permission or scheduled process was needed.

The operator backfill recovered 22 retained rated games before deployment. A
post-deployment replay and final preview found all 22 already represented and
zero missing results. A read of the production result partitions returned ten
ranked players. Source games and account totals were not edited.

Build, lint, migration TypeScript check, leaderboard boundary/backfill tests,
API integration and the full browser suite passed. Checks cover expiration
without new games, previous UTC-day results, exactly-once recording, all window
statistics, and the displayed Last 24 hours/Δ Elo columns.

```text
PASS: rolling 24-hour top ten, exact expiry, UTC-day boundaries, W/L/D and rating change, no lifetime leakage, duplicate protection and concurrent history backfill
{ apply: true, eligible: 22, created: 22, existing: 0 }
{ apply: false, eligible: 22, created: 0, existing: 22 }
```

## Five-second live move arrows

Own-move arrows now fade smoothly over five seconds from display, persist through
opponent replies, and clear immediately on the next legal own move (including
premoves). The evaluation queue preserves the latest own-move analysis even when
a newer opponent position arrives. Generation checks discard superseded own
results; a combined online snapshot still evaluates the player's move. Post-game
review arrows remain static and cover both players.

Build, lint, all nine core tests and the full browser suite passed. Browser
checks cover the five-second animation duration, decreasing opacity, automatic
removal, unchanged animation start time through opponent replies, delayed own
feedback, superseded results, both board orientations and post-game review.

```text
# tests 9
# pass 9
# fail 0
PASS: own arrows fade over five seconds, survive opponent replies and delayed evaluation, clear on the next own move; post-game arrows stay visible
```

Deployment `dpl_DCN6AZuZFdB3y1cyNt3S7MTCVeuJ` is READY. Vercel's alias API
confirms `evaluchess.com` points to this deployment.

## Hide practice answers until requested

Post-game mistakes offered for practice now hide both comparison arrows by
default, including the automatically selected first mistake and manually
selected mistakes. Show answer / Hide answer explicitly controls the reveal.
Selecting a move or opening practice hides the answer again; returning from
practice and reopening saved reviews do not expose it automatically. Other
review moves keep their arrows, and live five-second feedback is unchanged.

Build and lint passed. The first browser run timed out waiting for an online
client to receive move three, before reaching the changed practice flow. A full
rerun with failure diagnostics passed all scenarios, including the new coverage:

```text
PASS: practice suggestions hide arrows until explicitly revealed, including selection and return from practice
PASS: opponent move arrows remain available in post-game review
PASS: own arrows fade over five seconds, survive opponent replies and delayed evaluation, clear on the next own move; post-game arrows stay visible
```

Deployment `dpl_CJGD3wWiFQCgGvDmS4xyPFDpjNRz` is READY and assigned to
`evaluchess.com`, confirmed by Vercel inspect.

## Premoves through visible arrows

The fade change put `pointer-events-none` directly against a template-string
interpolation. Tailwind omitted that utility from generated CSS, leaving the
SVG overlay with `pointer-events: auto`. Browser hit testing reproduced the
problem: an arrow path intercepted the pointer over the knight on f3.

The overlay now sets `pointerEvents: 'none'` directly, independently of utility
extraction. Its five-second fade and practice-answer behavior are unchanged.
Build, lint, the full browser suite, and the new production-preview regression
check passed. The regression verifies hit testing at an arrow tip, queues click
and drag premoves while arrows remain visible, and checks that both online
clients receive each executed premove after the opponent replies.

```text
PASS: click and drag premoves through visible feedback arrows execute on opponent reply
PASS: practice suggestions hide arrows until explicitly revealed, including selection and return from practice
PASS: own arrows fade over five seconds, survive opponent replies and delayed evaluation, clear on the next own move; post-game arrows stay visible
```

Deployment `dpl_GVmBghQjPsr6meiVS6BLY2DvUWog` is READY and assigned to
`evaluchess.com`, confirmed by Vercel inspect.

## Keep the review board synchronized with move selection

The board and arrow overlay shared `review-<index>` React keys. Switching review
moves could retain an old board while rendering a second board and new arrows.
The arrow overlay now uses its own `arrows-` key prefix. A production-preview
regression reproduced the duplicate boards before the fix and now verifies all
piece locations, the selected move's arrows and exactly one board while jumping
through move rows and the accuracy chart in both orientations.

Build, lint, the new production-preview check and the full browser suite passed.
The initial full browser run exposed a test timing race: it captured a null
animation start time before the first animation frame. That check now waits for
a real start time; the subsequent full run passed.

```text
PASS: move rows and chart selections update every piece and arrow in both orientations, with exactly one board
PASS: practice suggestions hide arrows until explicitly revealed, including selection and return from practice
PASS: own arrows fade over five seconds, survive opponent replies and delayed evaluation, clear on the next own move; post-game arrows stay visible
```

Deployment `dpl_6n5rgWU1iA6XJW6Ei5tjFLnDFzgV` is READY. Vercel's alias API
confirms `evaluchess.com` points to this deployment.

## Default analysis to the player's moves

Game analysis now opens on Your moves. The heading's Your moves / Opponent moves
control switches the statistics card, accuracy chart and move list together.
White/Black labels identify the displayed side. Filtered chart points and rows
retain their original move indices, so selecting either side still opens the
correct board position. Switching perspective selects the corresponding move
number when available. Reopening a review defaults to the player's side again.
An opponent who made no moves gets an explicit empty state.

Build, lint, production-preview analysis tests and the full browser suite passed.
The first full suite timed out on navigation while closing practice; a complete
rerun with navigation diagnostics passed. Production checks cover both player
colors, stats and chart/list filtering, board/arrow synchronization, reset on
reopen and the empty-opponent case.

```text
PASS: move rows and chart selections update every piece and arrow in both orientations, with exactly one board
PASS: analysis defaults to your moves, switches stats/chart/list together, preserves original move indices, resets on reopen, and handles an opponent with no moves
PASS: practice suggestions hide arrows until explicitly revealed, including selection and return from practice
```

Deployment `dpl_aAScwB45nzXSRrnEY4ybiQo6kkAQ` is READY and assigned to
`evaluchess.com`, confirmed by Vercel inspect.

## Current Elo beside the 24-hour change

The leaderboard now shows Wins, Elo, Δ Elo, and L / D. Elo comes from each
ranked player's current rating record, fetched concurrently for the top ten.
Wins still determine rank; wins, losses, draws and Δ Elo retain the rolling
24-hour window. A missing rating displays an em dash. The table uses tighter
column spacing and horizontal scrolling if the available width is too narrow.

Build, lint, leaderboard boundary/backfill tests, DynamoDB Local API integration
and the full browser suite passed. Checks verify current Elo independently of
24-hour change, missing rating handling, and column placement immediately before
Δ Elo. Browser coverage verifies a 1216 current rating beside a +16 daily change.

```text
PASS: current Elo is independent of rolling 24-hour stats; top ten by wins, exact expiry, UTC-day boundaries, missing ratings, duplicate protection and concurrent history backfill
ok 1 - DynamoDB Local API: matchmaking races, authenticated turns, retries, clocks, results and ratings
PASS: leaderboard errors stay visible and Retry reloads DynamoDB rankings
```

Deployment `dpl_J5GtPoBHWpJJ1FFUdQax5gmkPm2P` is READY. Vercel's alias API
confirms `evaluchess.com` points to this deployment.

## Opaque profile menu and promotion settings

The profile dropdown now has a solid background and sits above the board and
clocks. A Settings section contains the pawn promotion preference, replacing
the live game's standalone selector. Guests have a Settings button. The choice
persists in browser storage; Escape and outside clicks dismiss the dropdown.

Production build, lint, and the full browser suite passed. Browser checks cover
account and guest access, persistence after reload, menu layering and mobile
bounds, keyboard/outside dismissal, and a real knight underpromotion.

```text
PASS: opaque guest settings sit above the game, fit mobile, dismiss with Escape/outside clicks, persist promotion, and produce a knight underpromotion
PASS: DynamoDB account signup, session restore, sign-out and sign-in work in the browser
```

Deployment `dpl_2CprcBGQQyXeni3FXE38tMzwrinR` is READY and assigned to
`evaluchess.com`, confirmed by Vercel inspect.

## Player preferences

Added persistent profile-menu settings for live move feedback, sound, premoves,
resignation confirmation, board colors and piece style. Sound defaults off;
feedback, premoves and resignation confirmation default on. Existing promotion
preferences are preserved. Appearance applies to play, review and practice.
Sound is synthesized locally for moves, captures and checks, with one low-time
warning when the player's active clock reaches 20 seconds. Disabled premoves
cannot be queued, and switching them off cancels the existing queue. Resignation
confirmation leaves clocks running and can be canceled.

Production build, lint, nine core tests, full browser suite and production-build
settings/premove checks passed. Screenshots were inspected on desktop and mobile.

```text
PASS: settings persist; themes and pieces render; sound defaults off and distinguishes moves/captures/check; mute takes effect immediately
PASS: feedback toggle affects live play only; disabled premoves cannot queue and cancel existing queues; resignation can be canceled or confirmation disabled
PASS: a saved sound preference unlocks on interaction; your low-time warning sounds once at 20 seconds
PASS: click and drag premoves through visible feedback arrows execute on opponent reply
```

Deployment `dpl_GfY4c6Nv5eizq7MfWQkheU3QXBpE` is READY. Vercel's alias API
confirms `evaluchess.com` points to this deployment.
