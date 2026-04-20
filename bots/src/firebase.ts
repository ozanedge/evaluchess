import admin from 'firebase-admin'
import { requireEnv } from './config.js'

let _app: admin.app.App | null = null

export function getApp(): admin.app.App {
  if (_app) return _app
  const projectId = requireEnv('FIREBASE_PROJECT_ID')
  const clientEmail = requireEnv('FIREBASE_CLIENT_EMAIL')
  // The private key comes in with literal \n sequences when stored as an env
  // var; convert those back to real newlines.
  const privateKey = requireEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n')
  const databaseURL = requireEnv('FIREBASE_DATABASE_URL')
  _app = admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    databaseURL,
  })
  return _app
}

export const db = () => getApp().database()
export const auth = () => getApp().auth()
