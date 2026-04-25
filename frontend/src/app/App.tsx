import { useEffect, useMemo, useState } from 'react'
import { addHabit, applyPack, checkIn, getGroup, heatmap, joinGroup, removeHabit } from './lib/api'
import { subscribeHeatmap } from './lib/live'
import { clearSession, loadSession, saveSession } from './state/session'
import type { SessionState } from './state/session'
import { Home } from './routes/Home'
import { CheckIn } from './routes/CheckIn'
import { GroupView } from './routes/Group'
import { Habit, HeatmapCell } from './types'

export function App() {
  const [session, setSession] = useState<SessionState>(loadSession())
  const [habits, setHabits] = useState<Habit[]>([])
  const [groupCells, setGroupCells] = useState<HeatmapCell[]>([])
  const [personalCells, setPersonalCells] = useState<HeatmapCell[]>([])
  const [screen, setScreen] = useState<'group' | 'habits' | 'checkin'>('group')
  const [inviteCode, setInviteCode] = useState('DEMO2026')
  const [displayName, setDisplayName] = useState('')
  const [focusHabitId, setFocusHabitId] = useState('')
  const [newHabitLabel, setNewHabitLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [joinError, setJoinError] = useState('')
  const [note, setNote] = useState('')

  const activeHabits = useMemo(() => habits.filter(habit => habit.active), [habits])
  const focusedHabit = useMemo(() => activeHabits.find(habit => habit.id === focusHabitId) ?? activeHabits[0] ?? null, [activeHabits, focusHabitId])

  useEffect(() => {
    if (!focusedHabit) {
      setFocusHabitId('')
      return
    }
    if (focusHabitId !== focusedHabit.id) setFocusHabitId(focusedHabit.id)
  }, [focusHabitId, focusedHabit])

  const loadGroupData = async (nextSession: SessionState) => {
    if (!nextSession) return
    const { habits: nextHabits } = await getGroup(nextSession.group.id)
    const active = nextHabits.filter(habit => habit.active)
    setHabits(nextHabits)
    if (active.length > 0) {
      const nextFocused = active.find(habit => habit.id === focusHabitId) ?? active[0]
      setFocusHabitId(nextFocused.id)
      if (screen === 'group') setScreen('checkin')
    } else {
      setScreen('habits')
    }
  }

  useEffect(() => {
    if (!session) return
    loadGroupData(session).catch(() => setNote('Could not load group data. Try refreshing.'))
  }, [session])

  useEffect(() => {
    if (!session || !focusedHabit) return
    let alive = true
    const sync = async () => {
      const [groupMap, personalMap] = await Promise.all([
        heatmap(session.group.id, 'group', focusedHabit.id),
        heatmap(session.group.id, 'me', focusedHabit.id),
      ])
      if (!alive) return
      setGroupCells(groupMap.cells)
      setPersonalCells(personalMap.cells)
    }
    sync().catch(() => setNote('Heatmap sync failed.'))
    const unsubscribe = subscribeHeatmap(session.group.id, () => {
      sync().catch(() => setNote('Heatmap sync failed.'))
    })

    return () => {
      alive = false
      unsubscribe()
    }
  }, [session, focusedHabit])

  const handleJoin = async () => {
    if (!inviteCode.trim() || !displayName.trim()) {
      setJoinError('Invite code and display name are required.')
      return
    }
    setBusy(true)
    setJoinError('')
    try {
      const next = await joinGroup(inviteCode.trim().toUpperCase(), displayName.trim())
      saveSession({ user: next.user, group: next.group }, next.sessionToken)
      setSession({ user: next.user, group: next.group })
      setScreen('group')
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
    let count = 0
    for (let index = personalCells.length - 1; index >= 0; index -= 1) {
      if (personalCells[index]?.count > 0) count += 1
      else break
    }
    return count
  }, [personalCells])

  if (!session) {
    return <main className="app onboarding-shell">
      <section className="hero card">
        <p className="eyebrow">GroupTrack</p>
        <h1>Build momentum with people who keep each other honest.</h1>
        <p className="muted">Flow: join your group, set your habits, then check in daily and watch momentum build.</p>
        <div className="stack-sm">
          <input value={inviteCode} onChange={event => setInviteCode(event.target.value)} placeholder="Invite code" />
          <input value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Display name" />
          <button className="button-primary" onClick={handleJoin} disabled={busy}>{busy ? 'Joining...' : 'Enter group'}</button>
          {joinError && <p className="error-text">{joinError}</p>}
        </div>
      </section>
    </main>
  }

  const doCheckIn = async (habitId: string) => {
    if (!session) return
    await checkIn(session.group.id, habitId, new Date().toISOString().slice(0, 10), crypto.randomUUID())
    const [nextGroup, nextPersonal] = await Promise.all([
      heatmap(session.group.id, 'group', habitId),
      heatmap(session.group.id, 'me', habitId),
    ])
    setGroupCells(nextGroup.cells)
    setPersonalCells(nextPersonal.cells)
    setNote('Check-in logged. Keep going.')
  }

  const doAddHabit = async () => {
    if (!session) return
    const label = newHabitLabel.trim()
    if (!label) return
    setBusy(true)
    try {
      const payload = { label, slug: slugify(label) || crypto.randomUUID() }
      const { habit } = await addHabit(session.group.id, payload)
      setHabits(current => [...current, habit])
      setFocusHabitId(habit.id)
      setNewHabitLabel('')
      setScreen('checkin')
    } finally {
      setBusy(false)
    }
  }

  const doApplyPack = async () => {
    if (!session) return
    setBusy(true)
    try {
      const { habits: nextHabits } = await applyPack(session.group.id)
      setHabits(nextHabits)
      const nextActive = nextHabits.find(habit => habit.active)
      if (nextActive) {
        setFocusHabitId(nextActive.id)
        setScreen('checkin')
      }
    } finally {
      setBusy(false)
    }
  }

  const doArchiveHabit = async (habitId: string) => {
    if (!session) return
    await removeHabit(session.group.id, habitId)
    setHabits(current => current.map(habit => (habit.id === habitId ? { ...habit, active: false } : habit)))
    setNote('Habit archived.')
  }

  return <main className="app">
    <header className="topbar card">
      <div>
        <p className="eyebrow">{session.group.name}</p>
        <h1>Welcome back, {session.user.displayName}</h1>
      </div>
      <div className="nav">
        <button className={screen === 'group' ? 'active' : ''} onClick={() => setScreen('group')}>Group</button>
        <button className={screen === 'habits' ? 'active' : ''} onClick={() => setScreen('habits')}>Habits</button>
        <button className={screen === 'checkin' ? 'active' : ''} onClick={() => setScreen('checkin')}>Check-in</button>
        <button onClick={() => { clearSession(); setSession(null) }}>Leave</button>
      </div>
    </header>

    <div className="cards">
      {screen === 'group' && <GroupView
        group={session.group}
        habits={habits}
        cells={groupCells}
        onGoHabits={() => setScreen('habits')}
        onGoCheckIn={() => setScreen('checkin')}
      />}
      {screen === 'habits' && <Home
        habits={habits}
        focusHabitId={focusHabitId}
        newHabitLabel={newHabitLabel}
        busy={busy}
        onFocusHabit={setFocusHabitId}
        onNewHabitLabelChange={setNewHabitLabel}
        onAddHabit={doAddHabit}
        onApplyStarterPack={doApplyPack}
        onArchiveHabit={doArchiveHabit}
      />}
      {screen === 'checkin' && <CheckIn
        habits={habits}
        focusHabitId={focusHabitId}
        personalStreak={streak}
        note={note}
        onFocusHabit={setFocusHabitId}
        onCheckIn={doCheckIn}
      />}
    </div>

    {focusedHabit && <section className="card stack heatmap-wrap">
      <div className="split">
        <div>
          <p className="stat-label">Your trend</p>
          <p className="muted">Focused on: {focusedHabit.label}</p>
        </div>
      </div>
      <div className="heatmap">{personalCells.map(cell => <div key={cell.day} className={`cell i${cell.intensity}`} title={`${cell.day}: ${cell.count}`} />)}</div>
    </section>}
  </main>
}
