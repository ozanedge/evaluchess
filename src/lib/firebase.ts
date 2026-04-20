import { initializeApp } from 'firebase/app'
import type { FirebaseApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'
import type { Database } from 'firebase/database'
import { getAuth } from 'firebase/auth'
import type { Auth } from 'firebase/auth'

let _app: FirebaseApp | null = null
let _db: Database | null = null
let _auth: Auth | null = null

const {
  VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_DATABASE_URL,
  VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID,
} = import.meta.env

if (VITE_FIREBASE_API_KEY && VITE_FIREBASE_DATABASE_URL && VITE_FIREBASE_PROJECT_ID) {
  _app = initializeApp({
    apiKey: VITE_FIREBASE_API_KEY,
    authDomain: VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: VITE_FIREBASE_DATABASE_URL,
    projectId: VITE_FIREBASE_PROJECT_ID,
    storageBucket: VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: VITE_FIREBASE_APP_ID,
  })
  _db = getDatabase(_app)
  _auth = getAuth(_app)
}

export const db = _db
export const auth = _auth
export const isFirebaseConfigured = !!_db
export const isAuthConfigured = !!_auth
