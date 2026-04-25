export type HeatmapCell = { day: string; count: number; intensity: 0 | 1 | 2 | 3 | 4 }
export type Habit = { id: string; groupId: string; slug: string; label: string; active: boolean }
export type Group = { id: string; name: string; inviteCode: string; completionThresholdN: number; nudgesEnabled: boolean; createdAt: string }
export type User = { id: string; displayName: string; createdAt: string }
export type JoinResponse = { user: User; group: Group; sessionToken: string }
