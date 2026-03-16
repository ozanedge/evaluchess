# Evaluchess

A chess app built for learning. Play against the computer or find a live human opponent, then get instant feedback on every game.

**Live at [evaluchess.com](https://evaluchess.com)**

## Features

### Learning-focused analysis
- **Live evaluation bar** — see the engine's assessment of the position update in real time as you play
- **Post-game review** — after every game, the app automatically jumps to your first mistake so you can study it immediately
- **Move classification** — every move is labeled as Best, Good, Inaccuracy, Mistake, or Blunder with centipawn loss
- **Best move arrow** — a green arrow shows what Stockfish recommended at each position
- **Mistake arrow** — a red arrow shows the move you actually played, so you can compare directly
- **Accuracy score** — get an overall accuracy percentage for the game, modeled after Chess.com's formula

### Game modes
- **Computer** — play against Stockfish at four difficulty levels: Novice (~800), Enthusiast (~1200), Expert (~1800), or Master (~2200)
- **Speed Pair** — get matched with a live human opponent automatically, no account needed

### Other
- Chess clock with four time controls: 1+0, 3+0, 5+0, 10+0
- Choose to play as White or Black against the computer
- Online player count shown in real time

## Tech stack

- React 19 + TypeScript + Vite
- Tailwind CSS v4
- Stockfish 18 (WASM) for engine analysis and computer moves
- Upstash Redis + Vercel serverless functions for Speed Pair matchmaking
- Deployed on Vercel
