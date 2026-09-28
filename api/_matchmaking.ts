import { randomUUID } from 'node:crypto'
import * as store from './_store.js'
import type { Identity, Rating } from './_identity.js'
import { createGame, TIME_CONTROL } from '../src/lib/gameRules.js'
import type { OnlineGame } from '../src/lib/gameRules.js'
import { GAME_TTL, gameKey, updateGame } from './_game.js'
import type { MatchData } from './_game.js'

interface Entry {
  id: string
  session: string
  tc: string
  ts: number
  joinedAt?: number
  bot?: boolean
  standby?: boolean
  username: string
  uid?: string
  rating?: Rating
}
interface Player {
  session: string
  entry?: Entry
  match?: MatchData
}
const playerKey = (id: string) => `player:${id}`
const queueKey = (tc: string) => `queue:${tc}`
export const BOT_WAIT_MS = 12000

function eligible(a: Entry, b: Entry, now: number) {
  if (!a.bot && !b.bot) return true
  if (a.bot && b.bot) return !a.standby && !b.standby
  const human = a.bot ? b : a
  return now - (human.joinedAt ?? human.ts) >= BOT_WAIT_MS
}
export async function findMatch(id: string): Promise<MatchData | null> {
  return (await store.get<Player>(playerKey(id)))?.match ?? null
}
export async function pair(
  id: string,
  session: string,
  tc: string,
  leave: boolean,
  name: string,
  user: Identity | null,
  standby = false
) {
  if (!leave && tc !== TIME_CONTROL.label) throw new Error('All games use 5+0')
  if (standby && !user?.bot) return { error: 'Standby is reserved for registered bots' }
  for (let attempt = 0; attempt < 12; attempt++) {
    const now = Date.now()
    const me = await store.read<Player>(playerKey(id))
    if (me && me.value.session !== session) return { error: 'Session does not own this player' }
    if (me?.value.match) {
      const game = await store.get<OnlineGame>(gameKey(me.value.match.gameId))
      // Finalize elapsed clocks before deciding whether this assignment is still active.
      const current =
        game && !game.result
          ? await updateGame(game.id, me.value.match.myColor, { type: 'poll' })
          : game
      if (current && !current.result) {
        if (!leave) return { matched: true, match: me.value.match }
        return { error: 'Resign the active game before leaving' }
      }
      // Reuse the player session, but never return a completed or expired match as a new game.
    }
    const oldEntry = me?.value.entry
    const oldQueue = oldEntry ? await store.read<Entry>(queueKey(oldEntry.tc), id) : null
    if (leave) {
      const writes = [store.deleteWrite(playerKey(id), me)]
      if (oldQueue) writes.push(store.deleteWrite(oldQueue.pk, oldQueue, oldQueue.sk))
      if (await store.transact(writes)) return { matched: false }
      await store.backoff(attempt)
      continue
    }
    const entry: Entry = {
      id,
      session,
      tc,
      ts: now,
      joinedAt:
        oldEntry?.tc === tc && now - oldEntry.ts < 20000 ? (oldEntry.joinedAt ?? oldEntry.ts) : now,
      bot: !!user?.bot,
      standby: !!user?.bot && standby,
      username: user?.username || name,
      ...(user ? { uid: user.uid, rating: user.rating } : {}),
    }
    const waiting = (await store.partition<Entry>(queueKey(tc)))
      .filter(
        (row) =>
          row.value.id !== id &&
          now - row.value.ts < 20000 &&
          (!user || !row.value.uid || user.uid !== row.value.uid) &&
          eligible(entry, row.value, now)
      )
      .sort(
        (a, b) =>
          Number(!!a.value.bot) - Number(!!b.value.bot) ||
          (!entry.bot && a.value.bot && b.value.bot
            ? Math.abs((a.value.rating?.elo ?? 1200) - (entry.rating?.elo ?? 1200)) -
              Math.abs((b.value.rating?.elo ?? 1200) - (entry.rating?.elo ?? 1200))
            : 0) ||
          (a.value.joinedAt ?? a.value.ts) - (b.value.joinedAt ?? b.value.ts)
      )
    const opponentQueue = waiting[0]
    const opponent = opponentQueue
      ? await store.read<Player>(playerKey(opponentQueue.value.id))
      : null
    if (
      opponentQueue &&
      (!opponent?.value.entry ||
        opponent.value.entry.tc !== tc ||
        opponent.value.entry.ts !== opponentQueue.value.ts ||
        opponent.value.session !== opponentQueue.value.session)
    ) {
      // A stale queue row cannot authorize a pairing.
      await store.transact([store.deleteWrite(opponentQueue.pk, opponentQueue, opponentQueue.sk)])
      continue
    }
    const writes: store.Write[] = []
    if (oldQueue && (opponentQueue || oldQueue.pk !== queueKey(tc)))
      writes.push(store.deleteWrite(oldQueue.pk, oldQueue, oldQueue.sk))
    if (opponentQueue && opponent) {
      const other = opponentQueue.value
      const gameId = randomUUID(),
        color = Math.random() < 0.5 ? 'white' : 'black'
      const otherColor = color === 'white' ? 'black' : 'white'
      const a: MatchData = {
        gameId,
        myColor: color,
        opponentId: other.id,
        token: randomUUID(),
        session,
        tc,
        myUsername: entry.username,
        opponentUsername: other.username,
        myUid: entry.uid,
        opponentUid: other.uid,
        opponentElo: other.rating?.elo,
        opponentBot: !!other.bot,
      }
      const b: MatchData = {
        gameId,
        myColor: otherColor,
        opponentId: id,
        token: randomUUID(),
        session: other.session,
        tc,
        myUsername: other.username,
        opponentUsername: entry.username,
        myUid: other.uid,
        opponentUid: entry.uid,
        opponentElo: entry.rating?.elo,
        opponentBot: !!entry.bot,
      }
      const game = createGame(gameId, tc, now)
      game.players = {}
      if (entry.uid && entry.rating)
        game.players[color] = { uid: entry.uid, username: entry.username, rating: entry.rating }
      if (other.uid && other.rating)
        game.players[otherColor] = {
          uid: other.uid,
          username: other.username,
          rating: other.rating,
        }
      writes.push(
        store.putWrite(playerKey(id), { session, match: a }, me, { ttl: GAME_TTL }),
        store.putWrite(playerKey(other.id), { session: other.session, match: b }, opponent, {
          ttl: GAME_TTL,
        }),
        store.putWrite(gameKey(gameId), game, null, { ttl: GAME_TTL }),
        store.deleteWrite(opponentQueue.pk, opponentQueue, opponentQueue.sk)
      )
      if (await store.transact(writes)) return { matched: true, match: a }
    } else {
      const currentQueue =
        oldQueue?.pk === queueKey(tc) ? oldQueue : await store.read<Entry>(queueKey(tc), id)
      writes.push(
        store.putWrite(playerKey(id), { session, entry }, me, { ttl: 60 }),
        store.putWrite(queueKey(tc), entry, currentQueue, { sk: id, ttl: 20 })
      )
      if (await store.transact(writes)) return { matched: false }
    }
    await store.backoff(attempt)
  }
  throw new Error('Matchmaking busy; retry')
}
