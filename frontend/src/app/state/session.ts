import { Group, User } from '../types'

const GROUPS_KEY = 'grouptrack.groupSessions'
const ACTIVE_GROUP_KEY = 'grouptrack.activeGroupId'
const TOKEN_KEY = 'grouptrack.sessionToken'

export type GroupSession = { user: User; group: Group; sessionToken: string }

const parseGroupSessions = (raw: string | null): GroupSession[] => {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export const loadGroupSessions = (): GroupSession[] => parseGroupSessions(localStorage.getItem(GROUPS_KEY))

export const saveGroupSessions = (sessions: GroupSession[]) => {
  localStorage.setItem(GROUPS_KEY, JSON.stringify(sessions))
}

export const upsertGroupSession = (session: GroupSession) => {
  const sessions = loadGroupSessions()
  const next = sessions.filter(item => item.group.id !== session.group.id)
  next.unshift(session)
  saveGroupSessions(next)
  localStorage.setItem(ACTIVE_GROUP_KEY, session.group.id)
  localStorage.setItem(TOKEN_KEY, session.sessionToken)
  return next
}

export const removeGroupSession = (groupId: string) => {
  const sessions = loadGroupSessions().filter(item => item.group.id !== groupId)
  saveGroupSessions(sessions)
  const nextActive = sessions[0]
  if (!nextActive) {
    localStorage.removeItem(ACTIVE_GROUP_KEY)
    localStorage.removeItem(TOKEN_KEY)
  } else {
    localStorage.setItem(ACTIVE_GROUP_KEY, nextActive.group.id)
    localStorage.setItem(TOKEN_KEY, nextActive.sessionToken)
  }
  return sessions
}

export const getActiveGroupId = () => localStorage.getItem(ACTIVE_GROUP_KEY)

export const setActiveGroup = (groupId: string, sessions: GroupSession[]) => {
  localStorage.setItem(ACTIVE_GROUP_KEY, groupId)
  const selected = sessions.find(item => item.group.id === groupId)
  if (selected) localStorage.setItem(TOKEN_KEY, selected.sessionToken)
}

export const clearAllSessions = () => {
  localStorage.removeItem(GROUPS_KEY)
  localStorage.removeItem(ACTIVE_GROUP_KEY)
  localStorage.removeItem(TOKEN_KEY)
}
