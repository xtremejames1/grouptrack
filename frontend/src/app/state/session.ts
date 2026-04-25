import { Group, User } from '../types'

const KEY = 'grouptrack.session'
const TOKEN_KEY = 'grouptrack.sessionToken'

export type SessionState = { user: User; group: Group } | null

export const loadSession = (): SessionState => {
  const raw = localStorage.getItem(KEY)
  return raw ? JSON.parse(raw) : null
}

export const saveSession = (session: SessionState, sessionToken?: string) => {
  if (!session) return
  localStorage.setItem(KEY, JSON.stringify(session))
  if (sessionToken) localStorage.setItem(TOKEN_KEY, sessionToken)
}

export const clearSession = () => {
  localStorage.removeItem(KEY)
  localStorage.removeItem(TOKEN_KEY)
}
