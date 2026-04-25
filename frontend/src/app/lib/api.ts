import { Group, HeatmapCell, Habit, JoinResponse } from '../types'

const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const token = localStorage.getItem('grouptrack.sessionToken')
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('X-Session-Token', token)
  const response = await fetch(path, { ...init, headers })
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<T>
}

export const joinGroup = (inviteCode: string, displayName: string) =>
  api<JoinResponse>(`/api/invites/${inviteCode}/join`, { method: 'POST', body: JSON.stringify({ displayName }) })

export const getGroup = (groupId: string) => api<{ group: Group; habits: Habit[] }>(`/api/groups/${groupId}`)
export const applyPack = (groupId: string) => api<{ habits: Habit[] }>(`/api/groups/${groupId}/habit-pack/apply`, { method: 'POST' })
export const addHabit = (groupId: string, payload: { slug: string; label: string }) =>
  api<{ habit: Habit }>(`/api/groups/${groupId}/habits`, { method: 'POST', body: JSON.stringify(payload) })
export const removeHabit = (groupId: string, habitId: string) =>
  api<{ ok: boolean }>(`/api/groups/${groupId}/habits/${habitId}`, { method: 'DELETE' })
export const checkIn = (groupId: string, habitId: string, day: string, idempotencyKey: string) =>
  api<{ checkInId: string; heatmapVersion: number; idempotent: boolean }>(`/api/checkins`, { method: 'POST', body: JSON.stringify({ groupId, habitId, day, idempotencyKey }) })
export const heatmap = (groupId: string, scope: 'group' | 'me', habitId: string) =>
  api<{ cells: HeatmapCell[]; version: number }>(`/api/groups/${groupId}/heatmap?scope=${scope}&habitId=${habitId}`)
