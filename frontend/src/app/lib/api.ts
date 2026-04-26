import { Group, GroupCalendarResponse, GroupSocialData, Habit, HeatmapCell, JoinResponse, LeaderboardEntry, SocialMessage, SocialMessageType } from '../types'

const configuredApiBaseUrl = ((((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL) ?? '') as string)
  .trim()
  .replace(/\/+$/, '')

const productionHostFallback = (() => {
  if (typeof window === 'undefined') return ''
  const host = window.location.hostname
  if (host === 'grouptrack-three.vercel.app' || host.endsWith('.vercel.app')) {
    return 'https://grouptrack-av8s.onrender.com'
  }
  return ''
})()

const apiBaseUrl = configuredApiBaseUrl || productionHostFallback

const toApiUrl = (path: string) => (apiBaseUrl ? `${apiBaseUrl}${path}` : path)

const api = async <T>(path: string, init?: RequestInit, sessionToken?: string): Promise<T> => {
  const token = sessionToken ?? localStorage.getItem('grouptrack.sessionToken')
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('X-Session-Token', token)
  const response = await fetch(toApiUrl(path), { ...init, headers })
  if (!response.ok) {
    const raw = await response.text()
    let message = raw || 'Request failed'
    try {
      const parsed = JSON.parse(raw)
      const detail = parsed?.detail
      if (typeof detail === 'string') message = detail
    } catch {
      // raw is not JSON; use as-is
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export const joinGroup = (inviteCode: string, displayName: string) =>
  api<JoinResponse>(`/api/invites/${inviteCode}/join`, { method: 'POST', body: JSON.stringify({ displayName }) })
export const createGroup = (payload: { displayName: string; groupName: string; completionThresholdN?: number }) =>
  api<JoinResponse>(`/api/invites/create`, { method: 'POST', body: JSON.stringify(payload) })

export const getGroup = (groupId: string) => api<{ group: Group; habits: Habit[] }>(`/api/groups/${groupId}`)
export const applyPack = (groupId: string) => api<{ habits: Habit[] }>(`/api/groups/${groupId}/habit-pack/apply`, { method: 'POST' })
export const addHabit = (groupId: string, payload: { slug: string; label: string }) =>
  api<{ habit: Habit }>(`/api/groups/${groupId}/habits`, { method: 'POST', body: JSON.stringify(payload) })
export const removeHabit = (groupId: string, habitId: string) =>
  api<{ ok: boolean }>(`/api/groups/${groupId}/habits/${habitId}`, { method: 'DELETE' })
export const restoreHabit = (groupId: string, habitId: string) =>
  api<{ habit: Habit }>(`/api/groups/${groupId}/habits/${habitId}/restore`, { method: 'POST' })
export const checkIn = (groupId: string, habitId: string, day: string, idempotencyKey: string) =>
  api<{ checkInId: string; heatmapVersion: number; idempotent: boolean }>(`/api/checkins`, { method: 'POST', body: JSON.stringify({ groupId, habitId, day, idempotencyKey }) })
export const removeCheckIn = (groupId: string, habitId: string, day: string) =>
  api<{ removed: boolean; heatmapVersion: number }>(`/api/checkins`, { method: 'DELETE', body: JSON.stringify({ groupId, habitId, day }) })
export const heatmap = (
  groupId: string,
  scope: 'group' | 'me',
  habitId: string,
  range?: { startDay: string; endDay: string },
) => {
  const params = new URLSearchParams({ scope, habitId })
  if (range) {
    params.set('startDay', range.startDay)
    params.set('endDay', range.endDay)
  }
  return api<{ cells: HeatmapCell[]; version: number }>(`/api/groups/${groupId}/heatmap?${params.toString()}`)
}

export const groupCalendar = (groupId: string, range: { startDay: string; endDay: string }) => {
  const params = new URLSearchParams({ startDay: range.startDay, endDay: range.endDay })
  return api<GroupCalendarResponse>(`/api/groups/${groupId}/calendar?${params.toString()}`)
}

export const leaveGroup = (groupId: string) =>
  api<{ ok: boolean }>(`/api/groups/${groupId}/members/me`, { method: 'DELETE' })

export const previewSocialMessage = (groupId: string, payload: { targetUserId: string; messageType: SocialMessageType; day: string }) =>
  api<{ message: string }>(`/api/groups/${groupId}/social-messages/preview`, { method: 'POST', body: JSON.stringify(payload) })

export const sendSocialMessage = (groupId: string, payload: { targetUserId: string; messageType: SocialMessageType; day: string; body: string }) =>
  api<{ message: SocialMessage }>(`/api/groups/${groupId}/social-messages`, { method: 'POST', body: JSON.stringify(payload) })

export const listSocialMessages = (groupId: string, limit = 30) =>
  api<{ messages: SocialMessage[] }>(`/api/groups/${groupId}/social-messages?limit=${limit}`)

export const congratulateSocialMessage = (groupId: string, messageId: string) =>
  api<{ messageId: string; congratsCount: number; congratsByMe: boolean }>(
    `/api/groups/${groupId}/social-messages/${messageId}/congratulate`,
    { method: 'POST' }
  )

export const getLeaderboard = (groupId: string, sessionToken: string) =>
  api<{ entries: LeaderboardEntry[] }>(`/api/groups/${groupId}/leaderboard`, undefined, sessionToken)
