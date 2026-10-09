# Play, review and practice

Use Evaluchess to play five-minute games, study your decisions and practice positions from your own mistakes.

[Play Evaluchess](https://evaluchess.com) · [Project overview](../README.md)

## Playing and tracking progress

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
- **Speed Pair fallback** — humans match first; after 12 seconds, an available bot joins automatically. Matchmaking continues waiting if no opponent is available.
- **Your analysis first** — game stats, the accuracy chart, and move review default to your moves. Use the **Your moves / Opponent moves** toggle to switch perspectives.
- **Accuracy score** — get an overall accuracy percentage for the game, modeled after Chess.com's formula

### Game modes

- **Computer** — play against Stockfish at four difficulty levels: Novice, Enthusiast, Expert or Master. These labels are approximate difficulty targets
- **Speed Pair** — join online matchmaking without an account. Humans match first; an available bot can join after 12 seconds

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


## Games, reviews and practice

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


See the [developer guide](DEVELOPMENT.md) for setup and checks.
