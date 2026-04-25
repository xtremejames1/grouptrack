export type HeatmapCell = { day: string; count: number; intensity: 0 | 1 | 2 | 3 | 4; isTrackable?: boolean }
export type Habit = { id: string; groupId: string; slug: string; label: string; active: boolean; createdAt: string }
export type Group = { id: string; name: string; inviteCode: string; completionThresholdN: number; nudgesEnabled: boolean; createdAt: string }
export type User = { id: string; displayName: string; createdAt: string }
export type JoinResponse = { user: User; group: Group; sessionToken: string }
export type GroupMember = { id: string; displayName: string }
export type GroupCalendarHabit = {
  habitId: string
  completedCount: number
  memberCount: number
  percentComplete: number
  intensity: 0 | 1 | 2 | 3 | 4
  completedUserIds: string[]
  isTrackable?: boolean
}
export type GroupCalendarDay = { day: string; habits: GroupCalendarHabit[] }
export type GroupCalendarResponse = {
  days: GroupCalendarDay[]
  members: GroupMember[]
}
export type LeaderboardEntry = { userId: string; displayName: string; currentStreak: number }
export type GroupSocialData = { groupId: string; groupName: string; inviteCode: string; myUserId: string; entries: LeaderboardEntry[] }
export type SocialMessageType = 'nudge' | 'celebrate' | 'achievement'
export type SocialMessage = {
  id: string
  groupId: string
  senderUserId: string
  senderName: string
  targetUserId: string
  targetName: string
  day: string
  messageType: SocialMessageType
  body: string
  createdAt: string
  congratsCount?: number
  congratsByMe?: boolean
}
