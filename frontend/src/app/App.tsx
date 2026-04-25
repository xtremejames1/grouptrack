import { useEffect, useMemo, useState } from 'react'
import { addHabit, applyPack, checkIn, getGroup, heatmap, joinGroup, removeHabit } from './lib/api'
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
import { Habit, HeatmapCell } from './types'

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

export function App() {
  const initialSessions = useMemo(() => loadGroupSessions(), [])
  const [sessions, setSessions] = useState<GroupSession[]>(initialSessions)
  const [activeGroupId, setActiveGroupId] = useState(getActiveGroupId() ?? initialSessions[0]?.group.id ?? '')
  const [habits, setHabits] = useState<Habit[]>([])
  const [groupCells, setGroupCells] = useState<HeatmapCell[]>([])
  const [personalCells, setPersonalCells] = useState<HeatmapCell[]>([])
  const [screen, setScreen] = useState<'home' | 'habits' | 'group'>('home')
  const [inviteCode, setInviteCode] = useState('DEMO2026')
  const [displayName, setDisplayName] = useState('')
  const [focusHabitId, setFocusHabitId] = useState('')
  const [newHabitLabel, setNewHabitLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [joinError, setJoinError] = useState('')
  const [note, setNote] = useState('Choose a habit and check in today.')
  const [joinOpen, setJoinOpen] = useState(false)
  const [monthAnchor, setMonthAnchor] = useState(monthStart(new Date()))

  const activeSession = useMemo(() => sessions.find(session => session.group.id === activeGroupId) ?? null, [activeGroupId, sessions])
  const calendarRange = useMemo(() => buildCalendarRange(monthAnchor), [monthAnchor])
  const todayIso = useMemo(() => toIsoDay(new Date()), [])

  const activeHabits = useMemo(() => habits.filter(habit => habit.active), [habits])
  const focusedHabit = useMemo(() => activeHabits.find(habit => habit.id === focusHabitId) ?? activeHabits[0] ?? null, [activeHabits, focusHabitId])
  const personalByDay = useMemo(() => new Map(personalCells.map(cell => [cell.day, cell])), [personalCells])
  const groupByDay = useMemo(() => new Map(groupCells.map(cell => [cell.day, cell])), [groupCells])
  const checkedInToday = useMemo(() => (personalByDay.get(todayIso)?.count ?? 0) > 0, [personalByDay, todayIso])

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
    if (!focusedHabit) {
      setFocusHabitId('')
      return
    }
    if (focusHabitId !== focusedHabit.id) setFocusHabitId(focusedHabit.id)
  }, [focusHabitId, focusedHabit])

  const loadGroupData = async (session: GroupSession) => {
    const { habits: nextHabits } = await getGroup(session.group.id)
    const active = nextHabits.filter(habit => habit.active)
    setHabits(nextHabits)
    if (active.length > 0) {
      const nextFocused = active.find(habit => habit.id === focusHabitId) ?? active[0]
      setFocusHabitId(nextFocused.id)
    } else {
      setScreen('habits')
    }
  }

  useEffect(() => {
    if (!activeSession) {
      setHabits([])
      setGroupCells([])
      setPersonalCells([])
      return
    }
    loadGroupData(activeSession).catch(() => setNote('Could not load group data. Try refreshing.'))
  }, [activeSession])

  useEffect(() => {
    if (!activeSession || !focusedHabit) return
    let alive = true

    const sync = async () => {
      const [groupMap, personalMap] = await Promise.all([
        heatmap(activeSession.group.id, 'group', focusedHabit.id, { startDay: calendarRange.startDay, endDay: calendarRange.endDay }),
        heatmap(activeSession.group.id, 'me', focusedHabit.id, { startDay: calendarRange.startDay, endDay: calendarRange.endDay }),
      ])
      if (!alive) return
      setGroupCells(groupMap.cells)
      setPersonalCells(personalMap.cells)
    }

    sync().catch(() => setNote('Heatmap sync failed.'))
    const unsubscribe = subscribeHeatmap(activeSession.group.id, () => {
      sync().catch(() => setNote('Heatmap sync failed.'))
    })

    return () => {
      alive = false
      unsubscribe()
    }
  }, [activeSession, focusedHabit, calendarRange.endDay, calendarRange.startDay])

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
      setScreen('home')
      setDisplayName(next.user.displayName)
      setNote('Joined group. Pick a habit and check in.')
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : 'Unable to join this group.')
    } finally {
      setBusy(false)
    }
  }

  const slugify = (label: string) =>
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

  const streak = useMemo(() => {
    const lookup = new Map(personalCells.map(cell => [cell.day, cell.count]))
    let count = 0
    for (const cursor = new Date(); count < 180; cursor.setDate(cursor.getDate() - 1)) {
      const day = toIsoDay(cursor)
      if ((lookup.get(day) ?? 0) > 0) count += 1
      else break
    }
    return count
  }, [personalCells])

  if (!sessions.length) {
    return <main className="app onboarding-shell">
      <section className="hero card">
        <p className="eyebrow">GroupTrack</p>
        <h1>Check in fast. Let the calendar show your momentum.</h1>
        <p className="muted">Join your group, pick a shared habit, and check in daily. The calendar shows everyone's momentum.</p>
        <div className="stack-sm">
          <input value={inviteCode} onChange={event => setInviteCode(event.target.value)} placeholder="Invite code" />
          <input value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Display name" />
          <button className="button-primary" onClick={handleJoin} disabled={busy}>{busy ? 'Joining...' : 'Join first group'}</button>
          {joinError && <p className="error-text">{joinError}</p>}
        </div>
      </section>
    </main>
  }

  const doCheckIn = async (habitId: string) => {
    if (!activeSession) return
    await checkIn(activeSession.group.id, habitId, toIsoDay(new Date()), crypto.randomUUID())
    const [nextGroup, nextPersonal] = await Promise.all([
      heatmap(activeSession.group.id, 'group', habitId, { startDay: calendarRange.startDay, endDay: calendarRange.endDay }),
      heatmap(activeSession.group.id, 'me', habitId, { startDay: calendarRange.startDay, endDay: calendarRange.endDay }),
    ])
    setGroupCells(nextGroup.cells)
    setPersonalCells(nextPersonal.cells)
    setNote('Check-in logged. Keep your streak alive.')
  }

  const doAddHabit = async () => {
    if (!activeSession) return
    const label = newHabitLabel.trim()
    if (!label) return
    setBusy(true)
    try {
      const payload = { label, slug: slugify(label) || crypto.randomUUID() }
      const { habit } = await addHabit(activeSession.group.id, payload)
      setHabits(current => [...current, habit])
      setFocusHabitId(habit.id)
      setNewHabitLabel('')
      setScreen('home')
      setNote('Habit added. You can check in now.')
    } finally {
      setBusy(false)
    }
  }

  const doApplyPack = async () => {
    if (!activeSession) return
    setBusy(true)
    try {
      const { habits: nextHabits } = await applyPack(activeSession.group.id)
      setHabits(nextHabits)
      const nextActive = nextHabits.find(habit => habit.active)
      if (nextActive) {
        setFocusHabitId(nextActive.id)
        setScreen('home')
      }
      setNote('Starter habit pack loaded.')
    } finally {
      setBusy(false)
    }
  }

  const doArchiveHabit = async (habitId: string) => {
    if (!activeSession) return
    await removeHabit(activeSession.group.id, habitId)
    setHabits(current => current.map(habit => (habit.id === habitId ? { ...habit, active: false } : habit)))
    setNote('Habit archived.')
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

  const renderCalendar = (cells: Map<string, HeatmapCell>, kind: 'personal' | 'group') => <div className="calendar-shell">
    <div className="calendar-head">
      {dayLabels.map(label => <span key={label} className="calendar-weekday">{label}</span>)}
    </div>
    <div className="calendar-grid">
      {calendarRange.days.map(day => {
        const iso = toIsoDay(day)
        const cell = cells.get(iso)
        const count = cell?.count ?? 0
        const intensity = cell?.intensity ?? 0
        const outside = day.getMonth() !== monthAnchor.getMonth()
        const today = iso === todayIso

        return <div
          key={`${kind}-${iso}`}
          className={`calendar-cell i${intensity}${outside ? ' outside' : ''}${today ? ' today' : ''}`}
          title={`${iso}: ${count} check-ins`}
        >
          <span className="day-num">{day.getDate()}</span>
          <span className="day-count">{count > 0 ? count : ''}</span>
        </div>
      })}
    </div>
  </div>

  return <main className="app">
    <header className="topbar card">
      <div>
        <p className="eyebrow">GroupTrack</p>
        <h1>Welcome back, {activeSession?.user.displayName}</h1>
      </div>
      <div className="row">
        <select
          className="group-select"
          value={activeGroupId}
          onChange={event => {
            setActiveGroupId(event.target.value)
            setScreen('home')
            setNote('Group switched.')
          }}
        >
          {sessions.map(session => <option key={session.group.id} value={session.group.id}>{session.group.name}</option>)}
        </select>
        <button className="button-ghost" onClick={() => setJoinOpen(open => !open)}>{joinOpen ? 'Cancel' : '+ Add group'}</button>
      </div>
      <div className="nav">
        <button className={screen === 'home' ? 'active' : ''} onClick={() => setScreen('home')}>Home</button>
        <button className={screen === 'habits' ? 'active' : ''} onClick={() => setScreen('habits')}>Habits</button>
        <button className={screen === 'group' ? 'active' : ''} onClick={() => setScreen('group')}>Group</button>
      </div>
    </header>

    {joinOpen && <section className="card stack-sm">
      <p className="eyebrow">Manage groups</p>
      <div className="inline-form">
        <input value={inviteCode} onChange={event => setInviteCode(event.target.value)} placeholder="Invite code" />
        <input value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Display name" />
        <button className="button-primary" onClick={handleJoin} disabled={busy}>{busy ? 'Joining...' : 'Join group'}</button>
      </div>
      {joinError && <p className="error-text">{joinError}</p>}
      <div>
        <button className="button-ghost danger" onClick={leaveCurrentGroup}>Leave {activeSession?.group.name}</button>
      </div>
    </section>}

    <section className="card calendar-toolbar">
      <div>
        <p className="stat-label">Month view</p>
        <p className="stat-value">{calendarRange.monthLabel}</p>
      </div>
      <div className="row">
        <button className="button-ghost" aria-label="Previous month" onClick={() => setMonthAnchor(anchor => shiftMonth(anchor, -1))}>&#8592;</button>
        <button className="button-ghost" onClick={() => setMonthAnchor(monthStart(new Date()))}>Today</button>
        <button className="button-ghost" aria-label="Next month" onClick={() => setMonthAnchor(anchor => shiftMonth(anchor, 1))}>&#8594;</button>
      </div>
    </section>

    <div className="cards">
      {screen === 'home' && <section className="home-layout">
        <aside className="card stack habit-sidebar">
          <div>
            <p className="eyebrow">Habits</p>
            <h2>Choose one and check in</h2>
            <p className="muted">Current streak: {streak} day{streak === 1 ? '' : 's'}</p>
          </div>
          <div className="stack-sm">
            {activeHabits.map(habit => <button
              key={habit.id}
              className={habit.id === focusedHabit?.id ? 'tab active' : 'tab'}
              onClick={() => setFocusHabitId(habit.id)}
            >
              {habit.label}
            </button>)}
            {!activeHabits.length && <p className="muted">No active habits. Add one in the Habits tab.</p>}
          </div>
          <button
            className="button-primary"
            disabled={!focusedHabit || checkedInToday}
            onClick={() => focusedHabit && !checkedInToday && doCheckIn(focusedHabit.id)}
          >
            {!focusedHabit ? 'Select a habit' : checkedInToday ? `Done for today: ${focusedHabit.label}` : `Check in: ${focusedHabit.label}`}
          </button>
          <p className="muted">{note}</p>
        </aside>
        <section className="card stack">
          <div>
            <p className="eyebrow">Personal calendar heatmap</p>
            <h2>{focusedHabit ? focusedHabit.label : 'No focused habit'}</h2>
            <p className="muted">Today is outlined. Darker cells mean more check-ins.</p>
          </div>
          {renderCalendar(personalByDay, 'personal')}
        </section>
      </section>}

      {screen === 'habits' && <section className="card stack">
        <div>
          <p className="eyebrow">Habit setup</p>
          <h2>Specify shared habits</h2>
          <p className="muted">Keep it simple: 1-3 habits your group can actually sustain.</p>
        </div>
        <div className="inline-form">
          <input value={newHabitLabel} onChange={event => setNewHabitLabel(event.target.value)} placeholder="Example: Read for 20 minutes" />
          <button className="button-primary" onClick={doAddHabit} disabled={busy || !newHabitLabel.trim()}>{busy ? 'Saving...' : 'Add habit'}</button>
          <button className="button-ghost" onClick={doApplyPack} disabled={busy}>Load starter pack</button>
        </div>
        <div className="stack-sm">
          {activeHabits.map(habit => <div key={habit.id} className="habit-row">
            <span>{habit.label}</span>
            <div className="row">
              <button className="button-ghost" onClick={() => { setFocusHabitId(habit.id); setScreen('home'); }}>Select</button>
              <button className="button-ghost danger" onClick={() => doArchiveHabit(habit.id)}>Archive</button>
            </div>
          </div>)}
        </div>
      </section>}

      {screen === 'group' && activeSession && <section className="card stack">
        <div>
          <p className="eyebrow">Group view — {activeSession.group.name}</p>
          <h2>{focusedHabit ? focusedHabit.label : 'No habit selected'}</h2>
          <p className="muted">Invite code <strong>{activeSession.group.inviteCode}</strong>. Completion threshold: {activeSession.group.completionThresholdN} members.</p>
        </div>
        {activeHabits.length > 1 && <div className="row">
          {activeHabits.map(habit => <button
            key={habit.id}
            className={habit.id === focusedHabit?.id ? 'tab active' : 'tab'}
            onClick={() => setFocusHabitId(habit.id)}
          >
            {habit.label}
          </button>)}
        </div>}
        {renderCalendar(groupByDay, 'group')}
      </section>}
    </div>
  </main>
}
