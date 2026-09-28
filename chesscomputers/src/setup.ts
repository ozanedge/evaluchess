import { createAccount } from './api.js'
import { CHESSCOMPUTER_USERNAMES, requireEnv } from './config.js'

async function main() {
  const password = requireEnv('CHESSCOMPUTER_PASSWORD')
  console.log('Creating Evaluchess chess-computer accounts…')
  let failures = 0
  for (const username of CHESSCOMPUTER_USERNAMES) {
    try {
      const result = await createAccount(username, password)
      console.log(`  [${username}] ${result}`)
    } catch (err) {
      failures++
      console.error(`  [${username}] setup failed`, err)
    }
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }
  if (failures) throw new Error(`${failures} chess-computer accounts could not be configured`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
