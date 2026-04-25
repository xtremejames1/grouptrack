import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { addHabit, applyPack, checkIn, createGroup, getGroup, groupCalendar, joinGroup, leaveGroup, listSocialMessages, previewSocialMessage, removeCheckIn, removeHabit, restoreHabit, sendSocialMessage } from './lib/api'
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
import { GroupCalendarDay, GroupCalendarHabit, GroupMember, Habit, SocialMessage, SocialMessageType } from './types'

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
  const [screen, setScreen] = useState<'group' | 'habits'>('group')
  const [inviteCode, setInviteCode] = useState('DEMO2026')
  const [groupName, setGroupName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [joinError, setJoinError] = useState('')
  const [note, setNote] = useState('Select a habit and tap once to check in.')
  const [joinOpen, setJoinOpen] = useState(true)
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
    if (completedByCurrentUserOnSelectedDay.has(habitId)) {
      await removeCheckIn(activeSession.group.id, habitId, selectedDay)
      setNote('Unchecked. Habit marked not done.')
    } else {
      await checkIn(activeSession.group.id, habitId, selectedDay, crypto.randomUUID())
      setNote('Checked in. Habit marked done.')
    }
    await refreshGroup(activeSession)
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
    return <main className="app onboarding-shell">
      <section className="hero card">
        <p className="eyebrow">GroupTrack</p>
        <h1>Group accountability, visualized as one calendar.</h1>
        <p className="muted">Join a group and track shared habits with one-tap check-ins.</p>
        <div className="stack-sm">
          <input value={groupName} onChange={event => setGroupName(event.target.value)} placeholder="New group name (optional)" />
          <input value={inviteCode} onChange={event => setInviteCode(event.target.value)} placeholder="Invite code" />
          <input value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Display name" />
          <button className="button-primary" onClick={handleJoin} disabled={busy}>{busy ? 'Joining...' : 'Join group'}</button>
          <button className="button-ghost" onClick={handleCreateGroup} disabled={busy || !groupName.trim() || !displayName.trim()}>
            {busy ? 'Creating...' : 'Create new group'}
          </button>
          {joinError && <p className="error-text">{joinError}</p>}
        </div>
      </section>
    </main>
  }

  return <main className="app">
    <header className="topbar card">
      <div>
        <p className="eyebrow">Group mode</p>
        <h1>{activeSession?.group.name}</h1>
        <p className="muted">{note}</p>
      </div>
      <div className="row">
        <select
          className="group-select"
          value={activeGroupId}
          onChange={event => {
            setActiveGroupId(event.target.value)
            setScreen('group')
          }}
        >
          {sessions.map(session => <option key={session.group.id} value={session.group.id}>{session.group.name} ({session.group.inviteCode})</option>)}
        </select>
        <button className="button-ghost" onClick={() => setJoinOpen(open => !open)}>{joinOpen ? 'Close join' : 'Join group'}</button>
        <button className="button-ghost" onClick={() => setCreateOpen(open => !open)}>{createOpen ? 'Close create' : 'Create group'}</button>
      </div>
      <div className="nav">
        <button className={screen === 'group' ? 'active' : ''} onClick={() => setScreen('group')}>Group</button>
        <button className={screen === 'habits' ? 'active' : ''} onClick={() => setScreen('habits')}>Habits</button>
        <button onClick={() => void leaveCurrentGroup()}>Leave group</button>
      </div>
    </header>

    {joinOpen && <section className="card stack-sm">
      <p className="eyebrow">Join another group</p>
      <div className="inline-form">
        <input value={inviteCode} onChange={event => setInviteCode(event.target.value)} placeholder="Invite code" />
        <input value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Display name" />
        <button className="button-primary" onClick={handleJoin} disabled={busy}>{busy ? 'Joining...' : 'Join group'}</button>
      </div>
      {joinError && <p className="error-text">{joinError}</p>}
    </section>}

    {createOpen && <section className="card stack-sm">
      <p className="eyebrow">Create a group</p>
      <div className="inline-form">
        <input value={groupName} onChange={event => setGroupName(event.target.value)} placeholder="Group name" />
        <input value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Your display name" />
        <button className="button-primary" onClick={handleCreateGroup} disabled={busy}>{busy ? 'Creating...' : 'Create group'}</button>
      </div>
      {joinError && <p className="error-text">{joinError}</p>}
    </section>}

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
            >
              {habit.label}
            </button>
          })}
        </div>
        {selectedDayIsFuture && <p className="muted">Future days are view-only.</p>}

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
            const trackableHabitCells = habitCells.filter(item => item.cell.isTrackable !== false)
            const avgPercent = trackableHabitCells.length
              ? Math.round(trackableHabitCells.reduce((sum, item) => sum + item.cell.percentComplete, 0) / trackableHabitCells.length)
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
}
