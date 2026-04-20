import admin from 'firebase-admin'
import { requireEnv } from './config.js'

let _app: admin.app.App | null = null

/**
 * Different env-file parsers treat a quoted value differently: Node's
 * `--env-file` strips surrounding double-quotes, but Railway / Render pass the
 * raw value verbatim — quotes included. Normalize both here so Firebase Admin
 * always gets a parseable PEM key.
 */
function normalizePrivateKey(raw: string): string {
  let key = raw.trim()
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1)
  }
  key = key.replace(/\\n/g, '\n')
  return key
}

export function getApp(): admin.app.App {
  if (_app) return _app
  const projectId = requireEnv('FIREBASE_PROJECT_ID')
  const clientEmail = requireEnv('FIREBASE_CLIENT_EMAIL')
  const privateKey = normalizePrivateKey(requireEnv('FIREBASE_PRIVATE_KEY'))
  const databaseURL = requireEnv('FIREBASE_DATABASE_URL')
  _app = admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    databaseURL,
  })
  return _app
}

export const db = () => getApp().database()
export const auth = () => getApp().auth()
