import { Habit } from '../types'

type CheckInProps = {
  habits: Habit[]
  focusHabitId: string
  personalStreak: number
  note: string
  onFocusHabit: (habitId: string) => void
  onCheckIn: (habitId: string) => void
}

export function CheckIn({ habits, focusHabitId, personalStreak, note, onFocusHabit, onCheckIn }: CheckInProps) {
  const activeHabits = habits.filter(habit => habit.active)
  const selected = activeHabits.find(habit => habit.id === focusHabitId)

  return <section className="card stack">
    <div>
      <p className="eyebrow">Step 3</p>
      <h2>Check in daily</h2>
      <p className="muted">Select your current habit and log today in one tap.</p>
    </div>

    <div className="tabs">
      {activeHabits.map(habit => <button
        key={habit.id}
        className={habit.id === focusHabitId ? 'tab active' : 'tab'}
        onClick={() => onFocusHabit(habit.id)}
      >
        {habit.label}
      </button>)}
    </div>

    <button
      className="button-primary"
      disabled={!selected}
      onClick={() => selected && onCheckIn(selected.id)}
    >
      {selected ? `Check in: ${selected.label}` : 'Choose a habit first'}
    </button>

    <div className="stats-grid">
      <div className="stat-card">
        <p className="stat-label">Current streak</p>
        <p className="stat-value">{personalStreak} days</p>
      </div>
      <div className="stat-card">
        <p className="stat-label">Status</p>
        <p className="stat-value muted">{note || 'No check-ins yet today.'}</p>
      </div>
    </div>
  </section>
}
