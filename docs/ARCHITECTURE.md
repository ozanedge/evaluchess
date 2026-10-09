# How Evaluchess runs a game

The browser handles the board and Stockfish analysis. The API owns online moves, clocks, results and ratings, while DynamoDB stores accounts and progress.

[Project overview](../README.md) · [Developer guide](DEVELOPMENT.md)

## Browser play and analysis

The interface uses React and TypeScript. chess.js enforces chess rules, and Stockfish 18 runs in a browser worker for computer moves and analysis. Keeping the engine in a worker lets the interface respond while a position is evaluated.

The engine wrapper manages startup, cancellation, timeouts and cached evaluations. Failed searches report an error that can be retried. Results from cancelled work cannot update a newer game or review.

Move feedback compares the exact positions before and after a move. Live feedback focuses on your moves; completed reviews can show either side. Practice reuses saved mistakes and hides the suggested move until you reveal it.

## Account progress and storage

Guests save progress in browser storage. Signing in imports guest games and badges into an account, and account caches stay separate from each other and guest history. The latest 50 games sync alongside analysis and practice attempts; earned badges remain outside the bounded game history.

Pending changes survive reloads and retry after reconnection. Account storage rejects divergent move histories instead of combining them. Personal accuracy trends and badges remain separate from competitive ratings.

Passwords use scrypt hashing. The API issues HTTP-only, secure, same-site session cookies. Vercel obtains short-lived AWS credentials through OpenID Connect (OIDC).

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


See the [DynamoDB migration guide](DYNAMODB-MIGRATION.md) for infrastructure setup and the [worker guide](../chesscomputers/README.md) for optional online opponents.
