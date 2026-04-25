import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { addHabit, applyPack, checkIn, createGroup, getGroup, getLeaderboard, groupCalendar, joinGroup, leaveGroup, listSocialMessages, previewSocialMessage, removeCheckIn, removeHabit, restoreHabit, sendSocialMessage } from './lib/api'
import { subscribeHeatmap } from './lib/live'
import {
  clearAllSessions,
  getActiveGroupId,
  loadGroupSessions,
  removeGroupSession,
  setActiveGroup,
  upsertGroupSession,
  type GroupSession,
} from './state/session'
import { GroupCalendarDay, GroupCalendarHabit, GroupMember, GroupSocialData, Habit, SocialMessage, SocialMessageType } from './types'

const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const toIsoDay = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1)
const shiftMonth = (base: Date, delta: number) => new Date(base.getFullYear(), base.getMonth() + delta, 1)

const buildCalendarRange = (anchor: Date) => {
  const start = monthStart(anchor)
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  const gridStart = new Date(start)
  gridStart.setDate(start.getDate() - start.getDay())
  const gridEnd = new Date(end)
  gridEnd.setDate(end.getDate() + (6 - end.getDay()))

  const days: Date[] = []
  for (const cursor = new Date(gridStart); cursor <= gridEnd; cursor.setDate(cursor.getDate() + 1)) {
    days.push(new Date(cursor))
  }

  return {
    startDay: toIsoDay(gridStart),
    endDay: toIsoDay(gridEnd),
    monthLabel: start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    days,
  }
}

const colorForPercent = (percent: number) => {
  const clamped = Math.max(0, Math.min(100, percent))
  const hue = (clamped / 100) * 120
  return `hsl(${hue} 66% 45%)`
}

const formatAbsoluteTimestamp = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

const getHabitCell = (day: GroupCalendarDay | undefined, habitId: string): GroupCalendarHabit =>
  day?.habits.find(item => item.habitId === habitId) ?? {
    habitId,
    completedCount: 0,
    memberCount: 0,
    percentComplete: 0,
    intensity: 0,
    completedUserIds: [],
    isTrackable: true,
  }

export function App() {
  const initialSessions = useMemo(() => loadGroupSessions(), [])
  const [sessions, setSessions] = useState<GroupSession[]>(initialSessions)
  const [activeGroupId, setActiveGroupId] = useState(getActiveGroupId() ?? initialSessions[0]?.group.id ?? '')
  const [screen, setScreen] = useState<'group' | 'habits' | 'social'>('group')
  const [socialData, setSocialData] = useState<GroupSocialData[]>([])
  const [socialLoading, setSocialLoading] = useState(false)
  const [inviteCode, setInviteCode] = useState('DEMO2026')
  const [groupName, setGroupName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [joinError, setJoinError] = useState('')
  const [note, setNote] = useState('Select a habit and tap once to check in.')
  const [joinOpen, setJoinOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [monthAnchor, setMonthAnchor] = useState(monthStart(new Date()))
  const [habits, setHabits] = useState<Habit[]>([])
  const [calendarDays, setCalendarDays] = useState<GroupCalendarDay[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [selectedHabitId, setSelectedHabitId] = useState('')
  const [newHabitLabel, setNewHabitLabel] = useState('')
  const [selectedDay, setSelectedDay] = useState(() => toIsoDay(new Date()))
  const [feed, setFeed] = useState<SocialMessage[]>([])
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerType, setComposerType] = useState<SocialMessageType>('nudge')
  const [composerTarget, setComposerTarget] = useState<GroupMember | null>(null)
  const [composerText, setComposerText] = useState('')
  const [composerLoading, setComposerLoading] = useState(false)

  const activeSession = useMemo(() => sessions.find(session => session.group.id === activeGroupId) ?? null, [activeGroupId, sessions])
  const activeHabits = useMemo(() => habits.filter(habit => habit.active), [habits])
  const archivedHabits = useMemo(() => habits.filter(habit => !habit.active), [habits])
  const membersById = useMemo(() => new Map(members.map(member => [member.id, member.displayName])), [members])
  const todayIso = useMemo(() => toIsoDay(new Date()), [])
  const calendarRange = useMemo(() => buildCalendarRange(monthAnchor), [monthAnchor])
  const calendarByDay = useMemo(() => new Map(calendarDays.map(day => [day.day, day])), [calendarDays])
  const selectedDayIsFuture = selectedDay > todayIso
  const inviteLink = activeSession ? `${window.location.origin}/?invite=${encodeURIComponent(activeSession.group.inviteCode)}` : ''

  const selectedHabit = useMemo(() => {
    const fallback = activeHabits[0]
    if (!fallback) return null
    return activeHabits.find(habit => habit.id === selectedHabitId) ?? fallback
  }, [activeHabits, selectedHabitId])

  const todayEntry = useMemo(() => calendarByDay.get(todayIso), [calendarByDay, todayIso])
  const selectedDayEntry = useMemo(() => calendarByDay.get(selectedDay), [calendarByDay, selectedDay])
  const selectedDayLabel = useMemo(() => {
    if (selectedDay === todayIso) return 'Today'
    return new Date(selectedDay + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
  }, [selectedDay, todayIso])

  const completedByCurrentUser = useMemo(() => {
    if (!activeSession) return new Set<string>()
    const done = new Set<string>()
    for (const habit of activeHabits) {
      const todayHabit = getHabitCell(todayEntry, habit.id)
      if (todayHabit.completedUserIds.includes(activeSession.user.id)) done.add(habit.id)
    }
    return done
  }, [activeHabits, activeSession, todayEntry])

  const completedByCurrentUserOnSelectedDay = useMemo(() => {
    if (!activeSession) return new Set<string>()
    const done = new Set<string>()
    for (const habit of activeHabits) {
      const cell = getHabitCell(selectedDayEntry, habit.id)
      if (cell.completedUserIds.includes(activeSession.user.id)) done.add(habit.id)
    }
    return done
  }, [activeHabits, activeSession, selectedDayEntry])

  const selectedDayMemberRows = useMemo(() => {
    return members.map(member => {
      const habitsState = activeHabits.map(habit => {
        const state = getHabitCell(selectedDayEntry, habit.id)
        const isTrackable = state.isTrackable !== false
        const done = state.completedUserIds.includes(member.id)
        return { habitId: habit.id, label: habit.label, done, isTrackable }
      })
      const completedCount = habitsState.filter(item => item.done).length
      const trackableCount = habitsState.filter(item => item.isTrackable).length
      const allDone = trackableCount > 0 && completedCount === trackableCount
      return { member, habitsState, completedCount, total: habitsState.length, allDone }
    })
  }, [activeHabits, members, selectedDayEntry])

  const completedMembers = useMemo(() => selectedDayMemberRows.filter(row => row.allDone), [selectedDayMemberRows])
  const pendingMembers = useMemo(() => selectedDayMemberRows.filter(row => !row.allDone), [selectedDayMemberRows])
  const myRow = useMemo(
    () => (activeSession ? selectedDayMemberRows.find(row => row.member.id === activeSession.user.id) ?? null : null),
    [activeSession, selectedDayMemberRows],
  )
  const friendCompletedMembers = useMemo(
    () => completedMembers.filter(row => !activeSession || row.member.id !== activeSession.user.id),
    [activeSession, completedMembers],
  )
  const friendPendingMembers = useMemo(
    () => pendingMembers.filter(row => !activeSession || row.member.id !== activeSession.user.id),
    [activeSession, pendingMembers],
  )

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const prefilledInvite = params.get('invite')
    if (prefilledInvite) {
      setInviteCode(prefilledInvite.toUpperCase())
      setJoinOpen(true)
    }
  }, [])

  useEffect(() => {
    if (!sessions.length) {
      setActiveGroupId('')
      return
    }
    if (!activeGroupId || !sessions.some(session => session.group.id === activeGroupId)) {
      const fallback = sessions[0].group.id
      setActiveGroupId(fallback)
      setActiveGroup(fallback, sessions)
    }
  }, [activeGroupId, sessions])

  useEffect(() => {
    if (!activeSession) return
    setActiveGroup(activeSession.group.id, sessions)
  }, [activeSession, sessions])

  useEffect(() => {
    if (!selectedHabit) {
      setSelectedHabitId('')
      return
    }
    if (selectedHabit.id !== selectedHabitId) setSelectedHabitId(selectedHabit.id)
  }, [selectedHabit, selectedHabitId])

  const refreshGroup = async (session: GroupSession) => {
    const [groupResponse, calendarResponse, feedResponse] = await Promise.all([
      getGroup(session.group.id),
      groupCalendar(session.group.id, { startDay: calendarRange.startDay, endDay: calendarRange.endDay }),
      listSocialMessages(session.group.id, 30),
    ])
    setHabits(groupResponse.habits)
    setCalendarDays(calendarResponse.days)
    setMembers(calendarResponse.members)
    setFeed(feedResponse.messages)
  }

  useEffect(() => {
    if (!activeSession) {
      setHabits([])
      setCalendarDays([])
      setMembers([])
      return
    }
    refreshGroup(activeSession).catch((error) => {
      const message = error instanceof Error ? error.message : 'Could not refresh group data.'
      if (message.includes('GROUP_NOT_FOUND') || message.includes('NOT_GROUP_MEMBER') || message.includes('UNAUTHORIZED')) {
        const nextSessions = removeGroupSession(activeSession.group.id)
        setSessions(nextSessions)
        setActiveGroupId(nextSessions[0]?.group.id ?? '')
        setNote('A stale group session was removed. Join or create a group to continue.')
        if (!nextSessions.length) setJoinOpen(true)
        return
      }
      setNote(message)
    })
  }, [activeSession, calendarRange.endDay, calendarRange.startDay])

  useEffect(() => {
    if (!composerOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setComposerOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [composerOpen])

  useEffect(() => {
    if (!activeSession) return
    const unsubscribe = subscribeHeatmap(activeSession.group.id, () => {
      refreshGroup(activeSession).catch(() => setNote('Live refresh failed.'))
    })
    return unsubscribe
  }, [activeSession, calendarRange.endDay, calendarRange.startDay])

  useEffect(() => {
    if (screen !== 'social' || !sessions.length) return
    setSocialLoading(true)
    Promise.all(
      sessions.map(session =>
        getLeaderboard(session.group.id, session.sessionToken).then(res => ({
          groupId: session.group.id,
          groupName: session.group.name,
          inviteCode: session.group.inviteCode,
          myUserId: session.user.id,
          entries: res.entries,
        }))
      )
    )
      .then(setSocialData)
      .catch(() => setNote('Could not load social data.'))
      .finally(() => setSocialLoading(false))
  }, [screen, sessions])

  const handleJoin = async () => {
    if (!inviteCode.trim() || !displayName.trim()) {
      setJoinError('Invite code and display name are required.')
      return
    }
    setBusy(true)
    setJoinError('')
    try {
      const next = await joinGroup(inviteCode.trim().toUpperCase(), displayName.trim())
      const nextSessions = upsertGroupSession({ user: next.user, group: next.group, sessionToken: next.sessionToken })
      setSessions(nextSessions)
      setActiveGroupId(next.group.id)
      setJoinOpen(false)
      setDisplayName(next.user.displayName)
      setNote('Joined group. Tap any habit toggle to check in.')
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : 'Unable to join this group.')
    } finally {
      setBusy(false)
    }
  }

  const handleCreateGroup = async () => {
    if (!groupName.trim() || !displayName.trim()) {
      setJoinError('Group name and display name are required.')
      return
    }
    setBusy(true)
    setJoinError('')
    try {
      const next = await createGroup({ groupName: groupName.trim(), displayName: displayName.trim() })
      const nextSessions = upsertGroupSession({ user: next.user, group: next.group, sessionToken: next.sessionToken })
      setSessions(nextSessions)
      setActiveGroupId(next.group.id)
      setCreateOpen(false)
      setJoinOpen(false)
      setNote(`Created ${next.group.name}. Share invite code ${next.group.inviteCode}.`)
      setGroupName('')
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : 'Unable to create group.')
    } finally {
      setBusy(false)
    }
  }


  const leaveCurrentGroup = async () => {
    if (!activeSession) return
    try {
      await leaveGroup(activeSession.group.id)
      const nextSessions = removeGroupSession(activeSession.group.id)
      setSessions(nextSessions)
      setActiveGroupId(nextSessions[0]?.group.id ?? '')
      if (!nextSessions.length) {
        clearAllSessions()
        setJoinOpen(true)
        setNote('Join a group to continue.')
      }
    } catch {
      setNote('Could not leave group. Please try again.')
    }
  }

  const toggleHabitCheckin = async (habitId: string) => {
    if (!activeSession) return
    if (selectedDayIsFuture) {
      setNote('You cannot check in future days.')
      return
    }
    try {
      if (completedByCurrentUserOnSelectedDay.has(habitId)) {
        await removeCheckIn(activeSession.group.id, habitId, selectedDay)
        setNote('Unchecked. Habit marked not done.')
      } else {
        await checkIn(activeSession.group.id, habitId, selectedDay, crypto.randomUUID())
        setNote('Checked in. Habit marked done.')
      }
      await refreshGroup(activeSession)
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Check-in failed. Please try again.')
    }
  }

  const openComposer = async (messageType: SocialMessageType, member: GroupMember) => {
    if (!activeSession) return
    setComposerOpen(true)
    setComposerType(messageType)
    setComposerTarget(member)
    setComposerText('')
    setComposerLoading(true)
    try {
      const response = await previewSocialMessage(activeSession.group.id, {
        targetUserId: member.id,
        messageType,
        day: selectedDay,
      })
      setComposerText(response.message)
    } catch (error) {
      setComposerText('')
      const detail = error instanceof Error ? error.message : 'Could not generate suggestion.'
      setNote(`${detail} You can still write your own.`)
    } finally {
      setComposerLoading(false)
    }
  }

  const sendComposer = async () => {
    if (!activeSession || !composerTarget || !composerText.trim()) return
    const action = composerType === 'celebrate' ? 'Celebration posted.' : 'Nudge posted.'
    const response = await sendSocialMessage(activeSession.group.id, {
      targetUserId: composerTarget.id,
      messageType: composerType,
      day: selectedDay,
      body: composerText.trim(),
    })
    setFeed(current => [response.message, ...current].slice(0, 30))
    setComposerOpen(false)
    setComposerTarget(null)
    setComposerText('')
    setNote(action)
  }

  const slugify = (label: string) =>
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

  const addHabitFromInput = async () => {
    if (!activeSession) return
    const label = newHabitLabel.trim()
    if (!label) return
    setBusy(true)
    try {
      const base = slugify(label) || 'habit'
      const slug = `${base}-${crypto.randomUUID().slice(0, 8)}`
      const { habit } = await addHabit(activeSession.group.id, { label, slug })
      setHabits(current => [...current, habit])
      setSelectedHabitId(habit.id)
      setNewHabitLabel('')
      await refreshGroup(activeSession)
      setNote('Habit added.')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Could not add habit.'
      setNote(detail)
    } finally {
      setBusy(false)
    }
  }

  const applyStarterPack = async () => {
    if (!activeSession) return
    setBusy(true)
    try {
      await applyPack(activeSession.group.id)
      await refreshGroup(activeSession)
      setScreen('group')
      setNote('Starter habits applied.')
    } finally {
      setBusy(false)
    }
  }

  const archiveHabit = async (habitId: string) => {
    if (!activeSession) return
    await removeHabit(activeSession.group.id, habitId)
    await refreshGroup(activeSession)
    setNote('Habit archived.')
  }

  const unarchiveHabit = async (habitId: string) => {
    if (!activeSession) return
    await restoreHabit(activeSession.group.id, habitId)
    await refreshGroup(activeSession)
    setNote('Habit restored.')
  }

  if (!sessions.length) {
    const mockCells = [
      ['#4ade80','#f97316'],['#4ade80'],['#4ade80','#f97316','#818cf8'],
      ['#f97316'],['#4ade80','#818cf8'],['#4ade80','#f97316'],['#818cf8'],
      ['#4ade80','#f97316','#818cf8'],['#4ade80','#f97316'],['#818cf8'],
      ['#4ade80'],['#f97316','#818cf8'],['#4ade80','#f97316'],['#4ade80'],
      ['#4ade80'],['#4ade80','#f97316'],['#4ade80','#f97316','#818cf8'],
      ['#4ade80'],['#818cf8'],['#4ade80','#f97316'],[],
    ]
    const storyWeeks = [
      [['#4ade80','#f97316'],['#4ade80'],['#4ade80','#f97316','#818cf8'],['#f97316'],['#4ade80'],['#4ade80','#f97316'],['#818cf8']],
      [['#4ade80','#f97316','#818cf8'],['#f97316'],['#818cf8'],['#4ade80'],['#f97316','#818cf8'],['#4ade80','#f97316'],['#4ade80']],
      [['#4ade80'],['#4ade80','#f97316'],['#4ade80','#f97316','#818cf8'],['#4ade80'],[],['#4ade80','#f97316'],[]],
    ]

    return (
      <div className="landing">
        <nav className="lp-nav">
          <div className="lp-nav-inner">
            <span className="lp-logo">GroupTrack</span>
            <div className="lp-nav-links">
              <span className="lp-nav-link">Features</span>
              <span className="lp-nav-link">How it Works</span>
            </div>
            <button className="button-primary lp-nav-cta" onClick={() => { setJoinOpen(true); setCreateOpen(false) }}>
              Join a Group
            </button>
          </div>
        </nav>

        <section className="lp-hero">
          <div className="lp-hero-text">
            <div className="lp-hero-tag">
              <span className="lp-hero-tag-dot" />
              Group accountability made simple
            </div>
            <h1 className="lp-hero-title">
              Group accountability,<br />visualized as one calendar.
            </h1>
            <p className="lp-hero-sub">
              Check in daily, see your whole team's progress, stay consistent together.
            </p>
            <div className="lp-hero-actions">
              <button className="button-primary lp-hero-btn" onClick={() => { setCreateOpen(true); setJoinOpen(false) }}>
                Get Started Free
              </button>
              <button className="button-ghost lp-hero-btn" onClick={() => { setJoinOpen(true); setCreateOpen(false) }}>
                ▶ Join with Code
              </button>
            </div>
          </div>
          <div className="lp-hero-visual">
            <p className="lp-hero-preview-label">Live group calendar</p>
            <div className="lp-calendar-mock">
              {mockCells.map((dots, i) => (
                <div key={i} className="lp-mock-cell">
                  {dots.map((color, j) => (
                    <span key={j} className="lp-mock-dot" style={{ background: color }} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="lp-proof-bar">
          <div className="lp-proof-bar-inner">
            <p className="lp-proof-text">Used by wellness groups, study teams, and accountability circles.</p>
            <div className="lp-proof-divider" />
            <div className="lp-proof-stat">
              <div className="lp-proof-badge">✓</div>
              <div className="lp-proof-stat-text">
                <strong>94%</strong>
                <span>streak retention</span>
              </div>
            </div>
            <div className="lp-proof-divider" />
            <div className="lp-proof-stat">
              <div className="lp-proof-badge">✓</div>
              <div className="lp-proof-stat-text">
                <strong>10k+</strong>
                <span>check-ins logged</span>
              </div>
            </div>
            <div className="lp-proof-divider" />
            <div className="lp-proof-stat">
              <div className="lp-proof-badge lp-proof-badge-outline">👥</div>
              <div className="lp-proof-stat-text">
                <strong>Teams of 2–10</strong>
                <span>built for small groups</span>
              </div>
            </div>
          </div>
        </div>

        <section className="lp-how">
          <p className="lp-how-eyebrow">HOW IT WORKS</p>
          <h2 className="lp-how-title">Simple steps. Big impact.</h2>
          <div className="lp-steps-grid">
            <div className="lp-step-card">
              <div className="lp-step-num">1</div>
              <div className="lp-step-icon">📅</div>
              <h3 className="lp-step-title">Pick your habits</h3>
              <p className="lp-step-desc">Your group agrees on shared daily habits. Everyone tracks the same goals together.</p>
            </div>
            <div className="lp-step-card">
              <div className="lp-step-num">2</div>
              <div className="lp-step-icon">✅</div>
              <h3 className="lp-step-title">Check in daily</h3>
              <p className="lp-step-desc">One tap per habit. The calendar fills with color as your team shows up.</p>
            </div>
            <div className="lp-step-card">
              <div className="lp-step-num">3</div>
              <div className="lp-step-icon">👥</div>
              <h3 className="lp-step-title">See your team</h3>
              <p className="lp-step-desc">Know who showed up and who needs a nudge. Celebrate wins together.</p>
            </div>
          </div>
        </section>

        <section className="lp-dot-story">
          <div className="lp-dot-story-inner">
            <div>
              <h2 className="lp-dot-story-title">Every dot tells a story.</h2>
              <p className="lp-dot-story-desc">
                Hover any dot to see who completed each habit for that day.
                Transparency builds trust. And trust builds consistency.
              </p>
            </div>
            <div className="lp-dot-story-visual">
              {storyWeeks.map((week, wi) => (
                <div key={wi} className="lp-dot-story-week">
                  {week.map((dots, di) => (
                    <div key={di} className="lp-story-cell">
                      {dots.map((color, ci) => (
                        <span key={ci} className="lp-story-dot" style={{ background: color }} />
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        <footer className="lp-footer">
          <div className="lp-footer-inner">
            <div>
              <span className="lp-footer-logo">GroupTrack</span>
              <p className="lp-footer-tagline">Built for people who show up together.</p>
            </div>
            <p className="lp-footer-copy">© 2025 GroupTrack. All rights reserved.</p>
          </div>
        </footer>

        {joinOpen && (
          <div className="modal-backdrop" onClick={() => setJoinOpen(false)}>
            <section className="card stack modal-card" onClick={e => e.stopPropagation()}>
              <div>
                <p className="eyebrow">Join a group</p>
                <h2>Enter your invite code</h2>
              </div>
              <div className="stack-sm">
                <input value={inviteCode} onChange={e => setInviteCode(e.target.value)} placeholder="Invite code (e.g. DEMO2026)" autoFocus />
                <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your display name" onKeyDown={e => { if (e.key === 'Enter') void handleJoin() }} />
              </div>
              <div className="row">
                <button className="button-primary" onClick={handleJoin} disabled={busy}>{busy ? 'Joining...' : 'Join group'}</button>
                <button className="button-ghost" onClick={() => { setJoinOpen(false); setCreateOpen(true) }}>Create new group</button>
              </div>
              {joinError && <p className="error-text">{joinError}</p>}
            </section>
          </div>
        )}

        {createOpen && (
          <div className="modal-backdrop" onClick={() => setCreateOpen(false)}>
            <section className="card stack modal-card" onClick={e => e.stopPropagation()}>
              <div>
                <p className="eyebrow">Create a group</p>
                <h2>Start a new group</h2>
              </div>
              <div className="stack-sm">
                <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Group name" autoFocus />
                <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your display name" onKeyDown={e => { if (e.key === 'Enter') void handleCreateGroup() }} />
              </div>
              <div className="row">
                <button className="button-primary" onClick={handleCreateGroup} disabled={busy || !groupName.trim() || !displayName.trim()}>{busy ? 'Creating...' : 'Create group'}</button>
                <button className="button-ghost" onClick={() => { setCreateOpen(false); setJoinOpen(true) }}>Join existing group</button>
              </div>
              {joinError && <p className="error-text">{joinError}</p>}
            </section>
          </div>
        )}
      </div>
    )
  }

  const defaultNote = 'Select a habit and tap once to check in.'

  return <>
    <nav className="app-nav">
      <div className="app-nav-inner">
        <span className="app-logo">GroupTrack</span>
        <div className="app-nav-tabs">
          <button className={screen === 'group' ? 'nav-tab active' : 'nav-tab'} onClick={() => setScreen('group')}>Calendar</button>
          <button className={screen === 'habits' ? 'nav-tab active' : 'nav-tab'} onClick={() => setScreen('habits')}>Habits</button>
          <button className={screen === 'social' ? 'nav-tab active' : 'nav-tab'} onClick={() => setScreen('social')}>Social</button>
        </div>
        <div className="app-nav-right">
          <select value={activeGroupId} onChange={event => { setActiveGroupId(event.target.value); setScreen('group') }}>
            {sessions.map(session => <option key={session.group.id} value={session.group.id}>{session.group.name} ({session.group.inviteCode})</option>)}
          </select>
          <button className="app-nav-btn" onClick={() => { setJoinOpen(o => !o); setCreateOpen(false) }}>{joinOpen ? 'Cancel' : 'Join'}</button>
          <button className="app-nav-btn" onClick={() => { setCreateOpen(o => !o); setJoinOpen(false) }}>{createOpen ? 'Cancel' : 'New group'}</button>
          <button className="app-nav-btn danger" onClick={() => void leaveCurrentGroup()}>Leave</button>
        </div>
      </div>
    </nav>

    <main className="app">
      {note !== defaultNote && <div className="note-banner"><p>{note}</p></div>}

      {joinOpen && <div className="modal-backdrop" onClick={() => setJoinOpen(false)}>
        <section className="card stack modal-card" onClick={e => e.stopPropagation()}>
          <div>
            <p className="eyebrow">Join another group</p>
            <h2>Enter invite code</h2>
          </div>
          <div className="stack-sm">
            <input value={inviteCode} onChange={e => setInviteCode(e.target.value)} placeholder="Invite code" autoFocus />
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Display name" />
          </div>
          <div className="row">
            <button className="button-primary" onClick={handleJoin} disabled={busy}>{busy ? 'Joining...' : 'Join group'}</button>
            <button className="button-ghost" onClick={() => setJoinOpen(false)}>Cancel</button>
          </div>
          {joinError && <p className="error-text">{joinError}</p>}
        </section>
      </div>}

      {createOpen && <div className="modal-backdrop" onClick={() => setCreateOpen(false)}>
        <section className="card stack modal-card" onClick={e => e.stopPropagation()}>
          <div>
            <p className="eyebrow">Create a group</p>
            <h2>Start a new group</h2>
          </div>
          <div className="stack-sm">
            <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Group name" autoFocus />
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your display name" />
          </div>
          <div className="row">
            <button className="button-primary" onClick={handleCreateGroup} disabled={busy || !groupName.trim() || !displayName.trim()}>{busy ? 'Creating...' : 'Create group'}</button>
            <button className="button-ghost" onClick={() => setCreateOpen(false)}>Cancel</button>
          </div>
          {joinError && <p className="error-text">{joinError}</p>}
        </section>
      </div>}

    {screen === 'group' && <>
      <section className="card stack social-top-card">
        <div>
          <p className="eyebrow">Active cheers and nudges</p>
          <h2>Group feed</h2>
        </div>
        {activeSession && <div className="share-row">
          <div className="share-copy">
            <p className="stat-label">Invite link</p>
            <p className="muted">{inviteLink}</p>
          </div>
          <QRCodeSVG value={inviteLink} size={88} />
        </div>}
        <div className="stack-sm">
          {feed.slice(0, 8).map(item => (
            <div key={item.id} className="feed-item">
              <p className="feed-meta">{item.senderName} {item.messageType === 'celebrate' ? 'celebrated' : 'nudged'} {item.targetName}</p>
              <p className="feed-body">{item.body}</p>
              <p className="feed-time">{formatAbsoluteTimestamp(item.createdAt)}</p>
            </div>
          ))}
          {!feed.length && <p className="muted">No social messages yet.</p>}
        </div>
      </section>

      <section className="group-layout">
      <section className="card stack">
        <div className="calendar-titlebar">
          <p className="eyebrow">Group calendar</p>
          <div className="calendar-nav-row">
            <button className="button-ghost icon-btn" onClick={() => setMonthAnchor(anchor => shiftMonth(anchor, -1))}>&#8592;</button>
            <h2>{calendarRange.monthLabel}</h2>
            <button className="button-ghost icon-btn" onClick={() => setMonthAnchor(anchor => shiftMonth(anchor, 1))}>&#8594;</button>
            <button className="button-ghost" onClick={() => { setMonthAnchor(monthStart(new Date())); setSelectedDay(toIsoDay(new Date())) }}>Today</button>
          </div>
        </div>

        <div className="habit-toggle-row">
          {activeHabits.map(habit => {
            const disabled = selectedDayIsFuture
            return <button
              key={habit.id}
              className={completedByCurrentUserOnSelectedDay.has(habit.id) ? 'habit-toggle checked' : 'habit-toggle'}
              disabled={disabled}
              onClick={() => {
                setSelectedHabitId(habit.id)
                void toggleHabitCheckin(habit.id)
              }}
              title={selectedDayIsFuture ? 'Cannot check in future days' : selectedDay !== todayIso ? `Edit history for ${selectedDayLabel}` : undefined}
            >
              {habit.label}
            </button>
          })}
        </div>
        {selectedDayIsFuture && <p className="muted">Future days are view-only.</p>}
        {!selectedDayIsFuture && selectedDay !== todayIso && <p className="muted">Editing history for {selectedDayLabel}. Tap a habit to add or remove a check-in.</p>}

        <div className="calendar-head">
          {weekdayLabels.map(label => <span key={label} className="calendar-weekday">{label}</span>)}
        </div>
        <div className="calendar-grid">
          {calendarRange.days.map(day => {
            const iso = toIsoDay(day)
            const dayEntry = calendarByDay.get(iso)
            const outside = day.getMonth() !== monthAnchor.getMonth()
            const isToday = iso === todayIso
            const habitCells = activeHabits.map(habit => ({ habit, cell: getHabitCell(dayEntry, habit.id) }))
            const avgPercent = habitCells.length
              ? Math.round(habitCells.reduce((sum, item) => sum + item.cell.percentComplete, 0) / habitCells.length)
              : 0

            return <div
              key={iso}
              className={`calendar-cell${outside ? ' outside' : ''}${isToday ? ' today' : ''}${iso === selectedDay ? ' selected' : ''}`}
              style={{ backgroundColor: `hsl(${(avgPercent / 100) * 120} 48% 95%)` }}
              onClick={() => setSelectedDay(iso)}
            >
              <div className="calendar-cell-head">
                <span className="day-num">{day.getDate()}</span>
                <span className="day-percent">{avgPercent}%</span>
              </div>
              <div className="habit-dot-grid">
                {habitCells.map(({ habit, cell }) => {
                  const completedNames = cell.completedUserIds.map(id => membersById.get(id) ?? 'Unknown')
                  return <div key={`${iso}-${habit.id}`} className="dot-wrap">
                    <span
                      className="habit-dot"
                      style={{ backgroundColor: colorForPercent(cell.percentComplete) }}
                      aria-label={`${habit.label} ${cell.percentComplete}%`}
                    />
                    <div className="dot-popover">
                      <p className="popover-title">{habit.label}</p>
                      <p className="popover-sub">{cell.percentComplete}% complete ({cell.completedCount}/{cell.memberCount})</p>
                      <p className="popover-sub">Completed: {completedNames.length ? completedNames.join(', ') : 'No one yet'}</p>
                    </div>
                  </div>
                })}
              </div>
            </div>
          })}
        </div>
      </section>

      <aside className="card stack status-panel">
        <div>
          <p className="eyebrow">{selectedDayLabel} status</p>
          <h2>People and habit completion</h2>
          <p className="muted">{selectedDay === todayIso ? 'Completed means all habits done today. Missing means at least one still open.' : `Showing completion for ${selectedDayLabel}.`}</p>
        </div>

        <div>
          <p className="status-heading">You</p>
          <div className="stack-sm">
            {myRow && <div key={myRow.member.id} className={myRow.allDone ? 'member-row done me' : 'member-row pending me'}>
              <div className="member-detail">
                <span className="member-name">{myRow.member.displayName} (you)</span>
                <div className="member-habits">
                  {myRow.habitsState.map(item => <span key={`${myRow.member.id}-${item.habitId}`} className={item.done ? 'mini-chip done' : item.isTrackable ? 'mini-chip' : 'mini-chip muted-chip'}>{item.label}</span>)}
                </div>
              </div>
            </div>}
            {!myRow && <p className="muted">Your row will appear once group data loads.</p>}
          </div>
        </div>

        <div>
          <p className="status-heading">Friends completed ({friendCompletedMembers.length})</p>
          <div className="stack-sm">
            {friendCompletedMembers.map(row => <div key={row.member.id} className="member-row done">
              <div className="member-detail">
                <span className="member-name">{row.member.displayName}</span>
                <div className="member-habits">
                  {row.habitsState.map(item => <span key={`${row.member.id}-${item.habitId}`} className={item.done ? 'mini-chip done' : item.isTrackable ? 'mini-chip' : 'mini-chip muted-chip'}>{item.label}</span>)}
                </div>
              </div>
              <button className="button-ghost" onClick={() => void openComposer('celebrate', row.member)}>Celebrate</button>
            </div>)}
            {!friendCompletedMembers.length && <p className="muted">No friends have completed all habits yet.</p>}
          </div>
        </div>

        <div>
          <p className="status-heading">Friends missing ({friendPendingMembers.length})</p>
          <div className="stack-sm">
            {friendPendingMembers.map(row => <div key={row.member.id} className="member-row pending">
              <div className="member-detail">
                <span className="member-name">{row.member.displayName}</span>
                <div className="member-habits">
                  {row.habitsState.map(item => <span key={`${row.member.id}-${item.habitId}`} className={item.done ? 'mini-chip done' : item.isTrackable ? 'mini-chip' : 'mini-chip muted-chip'}>{item.label}</span>)}
                </div>
              </div>
              <button className="button-ghost danger" onClick={() => void openComposer('nudge', row.member)}>Nudge</button>
            </div>)}
            {!friendPendingMembers.length && <p className="muted">No friends are missing habits right now.</p>}
          </div>
        </div>
      </aside>
    </section>
    </>}

    {screen === 'habits' && <section className="card stack">
      <div>
        <p className="eyebrow">Habit setup</p>
        <h2>Specify shared habits</h2>
      </div>
      <div className="inline-form">
        <input
          value={newHabitLabel}
          onChange={event => setNewHabitLabel(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void addHabitFromInput()
            }
          }}
          placeholder="Example: Read for 20 minutes"
        />
        <button className="button-primary" onClick={addHabitFromInput} disabled={busy || !newHabitLabel.trim()}>{busy ? 'Saving...' : 'Add habit'}</button>
        <button className="button-ghost" onClick={applyStarterPack} disabled={busy}>Load starter pack</button>
      </div>
      <div className="stack-sm">
        {activeHabits.map(habit => <div key={habit.id} className="habit-row">
          <button className="button-ghost" onClick={() => setSelectedHabitId(habit.id)}>{habit.label}</button>
          <button className="button-ghost danger" onClick={() => archiveHabit(habit.id)}>Archive</button>
        </div>)}
      </div>
      {!!archivedHabits.length && <div className="stack-sm">
        <p className="status-heading">Archived habits</p>
        {archivedHabits.map(habit => <div key={habit.id} className="habit-row">
          <span>{habit.label}</span>
          <button className="button-ghost" onClick={() => unarchiveHabit(habit.id)}>Restore</button>
        </div>)}
      </div>}
    </section>}

    {screen === 'social' && <div className="social-screen">
      {socialLoading ? (
        <section className="card"><p className="muted">Loading social data...</p></section>
      ) : (<>
        {/* Leaderboard */}
        <section className="card stack">
          <div>
            <p className="eyebrow">Leaderboard</p>
            <h2>Longest streaks</h2>
            <p className="muted">Consecutive days with at least one habit checked in.</p>
          </div>
          {socialData.map(groupData => {
            const allEntries = [...groupData.entries].sort((a, b) => b.currentStreak - a.currentStreak)
            const maxStreak = allEntries[0]?.currentStreak ?? 0
            return (
              <div key={groupData.groupId} className="lb-group-section">
                <p className="status-heading">{groupData.groupName}</p>
                <div className="lb-list">
                  {allEntries.map((entry, i) => {
                    const isMe = entry.userId === groupData.myUserId
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
                    const barPct = maxStreak > 0 ? (entry.currentStreak / maxStreak) * 100 : 0
                    return (
                      <div key={entry.userId} className={`lb-row${isMe ? ' lb-row-me' : ''}`}>
                        <span className="lb-rank">{medal ?? <span className="lb-rank-num">{i + 1}</span>}</span>
                        <span className="lb-name">{entry.displayName}{isMe && <span className="lb-you-tag">you</span>}</span>
                        <div className="lb-bar-track">
                          <div className="lb-bar-fill" style={{ width: `${barPct}%` }} />
                        </div>
                        <span className="lb-streak-count">
                          {entry.currentStreak > 0 ? <>🔥 {entry.currentStreak}d</> : <span className="lb-zero">—</span>}
                        </span>
                      </div>
                    )
                  })}
                  {allEntries.length === 0 && <p className="muted">No members yet.</p>}
                </div>
              </div>
            )
          })}
          {socialData.length === 0 && <p className="muted">No group data available.</p>}
        </section>

        {/* Friends across groups */}
        <section className="card stack">
          <div>
            <p className="eyebrow">Your friends</p>
            <h2>Members across all groups</h2>
          </div>
          {socialData.map(groupData => (
            <div key={groupData.groupId} className="stack-sm">
              <div className="friend-group-header">
                <p className="status-heading">{groupData.groupName}</p>
                <span className="friend-invite-code">{groupData.inviteCode}</span>
              </div>
              <div className="stack-sm">
                {groupData.entries.map(entry => {
                  const isMe = entry.userId === groupData.myUserId
                  return (
                    <div key={entry.userId} className={`member-row${isMe ? ' me' : ''}`}>
                      <div className="member-detail">
                        <span className="member-name">
                          {entry.displayName}
                          {isMe && <span className="lb-you-tag">you</span>}
                        </span>
                        <span className="muted">
                          {entry.currentStreak > 0 ? `🔥 ${entry.currentStreak} day streak` : 'No active streak'}
                        </span>
                      </div>
                    </div>
                  )
                })}
                {groupData.entries.length === 0 && <p className="muted">No members yet.</p>}
              </div>
            </div>
          ))}
          {socialData.length === 0 && <p className="muted">Join or create a group to see your friends here.</p>}
        </section>
      </>)}
    </div>}

    {composerOpen && composerTarget && <div className="modal-backdrop" onClick={() => setComposerOpen(false)}>
      <section className="card stack modal-card" onClick={event => event.stopPropagation()}>
        <div>
          <p className="eyebrow">{composerType === 'celebrate' ? 'Celebrate' : 'Nudge'}</p>
          <h2>Message for {composerTarget.displayName}</h2>
        </div>
        <textarea
          value={composerText}
          onChange={event => setComposerText(event.target.value)}
          rows={3}
          placeholder={composerLoading ? 'Generating suggestion...' : 'Write a short supportive message'}
        />
        <div className="row">
          <button className="button-primary" disabled={composerLoading || !composerText.trim()} onClick={() => void sendComposer()}>
            Send
          </button>
          <button className="button-ghost" onClick={() => setComposerOpen(false)}>Cancel</button>
        </div>
      </section>
    </div>}

    </main>
  </>
}
