import { useEffect, useMemo, useState } from 'react'
import { addHabit, applyPack, checkIn, getGroup, groupCalendar, joinGroup, removeCheckIn, removeHabit } from './lib/api'
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
import { GroupCalendarDay, GroupCalendarHabit, GroupMember, Habit } from './types'

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

const getHabitCell = (day: GroupCalendarDay | undefined, habitId: string): GroupCalendarHabit =>
  day?.habits.find(item => item.habitId === habitId) ?? {
    habitId,
    completedCount: 0,
    memberCount: 0,
    percentComplete: 0,
    intensity: 0,
    completedUserIds: [],
  }

export function App() {
  const initialSessions = useMemo(() => loadGroupSessions(), [])
  const [sessions, setSessions] = useState<GroupSession[]>(initialSessions)
  const [activeGroupId, setActiveGroupId] = useState(getActiveGroupId() ?? initialSessions[0]?.group.id ?? '')
  const [screen, setScreen] = useState<'group' | 'habits'>('group')
  const [inviteCode, setInviteCode] = useState('DEMO2026')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [joinError, setJoinError] = useState('')
  const [note, setNote] = useState('Select a habit and tap once to check in.')
  const [joinOpen, setJoinOpen] = useState(true)
  const [monthAnchor, setMonthAnchor] = useState(monthStart(new Date()))
  const [habits, setHabits] = useState<Habit[]>([])
  const [calendarDays, setCalendarDays] = useState<GroupCalendarDay[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [selectedHabitId, setSelectedHabitId] = useState('')
  const [newHabitLabel, setNewHabitLabel] = useState('')

  const activeSession = useMemo(() => sessions.find(session => session.group.id === activeGroupId) ?? null, [activeGroupId, sessions])
  const activeHabits = useMemo(() => habits.filter(habit => habit.active), [habits])
  const membersById = useMemo(() => new Map(members.map(member => [member.id, member.displayName])), [members])
  const todayIso = useMemo(() => toIsoDay(new Date()), [])
  const calendarRange = useMemo(() => buildCalendarRange(monthAnchor), [monthAnchor])
  const calendarByDay = useMemo(() => new Map(calendarDays.map(day => [day.day, day])), [calendarDays])

  const selectedHabit = useMemo(() => {
    const fallback = activeHabits[0]
    if (!fallback) return null
    return activeHabits.find(habit => habit.id === selectedHabitId) ?? fallback
  }, [activeHabits, selectedHabitId])

  const todayEntry = useMemo(() => calendarByDay.get(todayIso), [calendarByDay, todayIso])
  const completedByCurrentUser = useMemo(() => {
    if (!activeSession) return new Set<string>()
    const done = new Set<string>()
    for (const habit of activeHabits) {
      const todayHabit = getHabitCell(todayEntry, habit.id)
      if (todayHabit.completedUserIds.includes(activeSession.user.id)) done.add(habit.id)
    }
    return done
  }, [activeHabits, activeSession, todayEntry])

  const todayMemberRows = useMemo(() => {
    return members.map(member => {
      const habitsState = activeHabits.map(habit => {
        const state = getHabitCell(todayEntry, habit.id)
        const done = state.completedUserIds.includes(member.id)
        return { habitId: habit.id, label: habit.label, done }
      })
      const completedCount = habitsState.filter(item => item.done).length
      const allDone = habitsState.length > 0 && completedCount === habitsState.length
      return { member, habitsState, completedCount, total: habitsState.length, allDone }
    })
  }, [activeHabits, members, todayEntry])

  const completedMembers = useMemo(() => todayMemberRows.filter(row => row.allDone), [todayMemberRows])
  const pendingMembers = useMemo(() => todayMemberRows.filter(row => !row.allDone), [todayMemberRows])

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
    const [groupResponse, calendarResponse] = await Promise.all([
      getGroup(session.group.id),
      groupCalendar(session.group.id, { startDay: calendarRange.startDay, endDay: calendarRange.endDay }),
    ])
    setHabits(groupResponse.habits)
    setCalendarDays(calendarResponse.days)
    setMembers(calendarResponse.members)
  }

  useEffect(() => {
    if (!activeSession) {
      setHabits([])
      setCalendarDays([])
      setMembers([])
      return
    }
    refreshGroup(activeSession).catch(() => setNote('Could not refresh group data.'))
  }, [activeSession, calendarRange.endDay, calendarRange.startDay])

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

  const leaveCurrentGroup = () => {
    if (!activeSession) return
    const nextSessions = removeGroupSession(activeSession.group.id)
    setSessions(nextSessions)
    setActiveGroupId(nextSessions[0]?.group.id ?? '')
    if (!nextSessions.length) {
      clearAllSessions()
      setJoinOpen(true)
      setNote('Join a group to continue.')
    }
  }

  const toggleHabitCheckin = async (habitId: string) => {
    if (!activeSession) return
    if (completedByCurrentUser.has(habitId)) {
      await removeCheckIn(activeSession.group.id, habitId, todayIso)
      setNote('Unchecked. Habit marked not done for today.')
    } else {
      await checkIn(activeSession.group.id, habitId, todayIso, crypto.randomUUID())
      setNote('Checked in. Habit marked done for today.')
    }
    await refreshGroup(activeSession)
  }

  const celebrateMember = (name: string) => {
    setNote(`Celebrated ${name}. Keep the momentum up.`)
  }

  const nudgeMember = (name: string) => {
    setNote(`Nudged ${name}. Accountability ping sent.`)
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
      const { habit } = await addHabit(activeSession.group.id, { label, slug: slugify(label) || crypto.randomUUID() })
      setHabits(current => [...current, habit])
      setSelectedHabitId(habit.id)
      setNewHabitLabel('')
      setScreen('group')
      await refreshGroup(activeSession)
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

  if (!sessions.length) {
    return <main className="app onboarding-shell">
      <section className="hero card">
        <p className="eyebrow">GroupTrack</p>
        <h1>Group accountability, visualized as one calendar.</h1>
        <p className="muted">Join a group and track shared habits with one-tap check-ins.</p>
        <div className="stack-sm">
          <input value={inviteCode} onChange={event => setInviteCode(event.target.value)} placeholder="Invite code" />
          <input value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Display name" />
          <button className="button-primary" onClick={handleJoin} disabled={busy}>{busy ? 'Joining...' : 'Join first group'}</button>
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
          {sessions.map(session => <option key={session.group.id} value={session.group.id}>{session.group.name}</option>)}
        </select>
        <button className="button-ghost" onClick={() => setJoinOpen(open => !open)}>{joinOpen ? 'Close join' : 'Add group'}</button>
      </div>
      <div className="nav">
        <button className={screen === 'group' ? 'active' : ''} onClick={() => setScreen('group')}>Group</button>
        <button className={screen === 'habits' ? 'active' : ''} onClick={() => setScreen('habits')}>Habits</button>
        <button onClick={leaveCurrentGroup}>Leave group</button>
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

    {screen === 'group' && <section className="group-layout">
      <section className="card stack">
        <div className="calendar-titlebar">
          <div>
            <p className="eyebrow">Group calendar</p>
            <h2>{calendarRange.monthLabel}</h2>
          </div>
          <div className="row">
            <button className="button-ghost" onClick={() => setMonthAnchor(anchor => shiftMonth(anchor, -1))}>Previous</button>
            <button className="button-ghost" onClick={() => setMonthAnchor(monthStart(new Date()))}>Today</button>
            <button className="button-ghost" onClick={() => setMonthAnchor(anchor => shiftMonth(anchor, 1))}>Next</button>
          </div>
        </div>

        <div className="habit-toggle-row">
          {activeHabits.map(habit => <button
            key={habit.id}
            className={completedByCurrentUser.has(habit.id) ? 'habit-toggle checked' : 'habit-toggle'}
            onClick={() => {
              setSelectedHabitId(habit.id)
              void toggleHabitCheckin(habit.id)
            }}
          >
            {habit.label}
          </button>)}
        </div>

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
              className={`calendar-cell${outside ? ' outside' : ''}${isToday ? ' today' : ''}`}
              style={{ backgroundColor: `hsl(${(avgPercent / 100) * 120} 48% 95%)` }}
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
          <p className="eyebrow">Today status</p>
          <h2>People and habit completion</h2>
          <p className="muted">Completed means all habits done today. Missing means at least one still open.</p>
        </div>

        <div>
          <p className="status-heading">Completed ({completedMembers.length})</p>
          <div className="stack-sm">
            {completedMembers.map(row => <div key={row.member.id} className="member-row done">
              <div className="member-detail">
                <span className="member-name">{row.member.displayName}</span>
                <div className="member-habits">
                  {row.habitsState.map(item => <span key={`${row.member.id}-${item.habitId}`} className={item.done ? 'mini-chip done' : 'mini-chip'}>{item.label}</span>)}
                </div>
              </div>
              <button className="button-ghost" onClick={() => celebrateMember(row.member.displayName)}>Celebrate</button>
            </div>)}
            {!completedMembers.length && <p className="muted">No one has completed all habits yet.</p>}
          </div>
        </div>

        <div>
          <p className="status-heading">Missing ({pendingMembers.length})</p>
          <div className="stack-sm">
            {pendingMembers.map(row => <div key={row.member.id} className="member-row pending">
              <div className="member-detail">
                <span className="member-name">{row.member.displayName}</span>
                <div className="member-habits">
                  {row.habitsState.map(item => <span key={`${row.member.id}-${item.habitId}`} className={item.done ? 'mini-chip done' : 'mini-chip'}>{item.label}</span>)}
                </div>
              </div>
              <button className="button-ghost danger" onClick={() => nudgeMember(row.member.displayName)}>Nudge</button>
            </div>)}
            {!pendingMembers.length && <p className="muted">Everyone is done. Great day.</p>}
          </div>
        </div>
      </aside>
    </section>}

    {screen === 'habits' && <section className="card stack">
      <div>
        <p className="eyebrow">Habit setup</p>
        <h2>Specify shared habits</h2>
      </div>
      <div className="inline-form">
        <input value={newHabitLabel} onChange={event => setNewHabitLabel(event.target.value)} placeholder="Example: Read for 20 minutes" />
        <button className="button-primary" onClick={addHabitFromInput} disabled={busy || !newHabitLabel.trim()}>{busy ? 'Saving...' : 'Add habit'}</button>
        <button className="button-ghost" onClick={applyStarterPack} disabled={busy}>Load starter pack</button>
      </div>
      <div className="stack-sm">
        {activeHabits.map(habit => <div key={habit.id} className="habit-row">
          <button className="button-ghost" onClick={() => setSelectedHabitId(habit.id)}>{habit.label}</button>
          <button className="button-ghost danger" onClick={() => archiveHabit(habit.id)}>Archive</button>
        </div>)}
      </div>
    </section>}
  </main>
}
