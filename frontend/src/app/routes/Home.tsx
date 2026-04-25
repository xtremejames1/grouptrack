import { Habit } from '../types'

type HabitSetupProps = {
  habits: Habit[]
  focusHabitId: string
  newHabitLabel: string
  busy: boolean
  onFocusHabit: (habitId: string) => void
  onNewHabitLabelChange: (label: string) => void
  onAddHabit: () => void
  onApplyStarterPack: () => void
  onArchiveHabit: (habitId: string) => void
}

export function Home({
  habits,
  focusHabitId,
  newHabitLabel,
  busy,
  onFocusHabit,
  onNewHabitLabelChange,
  onAddHabit,
  onApplyStarterPack,
  onArchiveHabit,
}: HabitSetupProps) {
  const activeHabits = habits.filter(habit => habit.active)

  return <section className="card stack">
    <div>
      <p className="eyebrow">Step 2</p>
      <h2>Specify habits for your group</h2>
      <p className="muted">Pick a focused habit for this week, then add more as your group settles into a rhythm.</p>
    </div>

    <div className="split">
      <input
        value={newHabitLabel}
        onChange={event => onNewHabitLabelChange(event.target.value)}
        placeholder="Example: Read for 20 minutes"
      />
      <button onClick={onAddHabit} disabled={busy || !newHabitLabel.trim()}>{busy ? 'Saving...' : 'Add habit'}</button>
    </div>

    <button className="button-ghost" onClick={onApplyStarterPack} disabled={busy}>Load starter habit pack</button>

    <div className="stack-sm">
      {activeHabits.length === 0 && <p className="muted">No active habits yet. Add one or load the starter pack to continue.</p>}
      {activeHabits.map(habit => <div key={habit.id} className="habit-row">
        <label className="row">
          <input
            type="radio"
            name="focus-habit"
            checked={focusHabitId === habit.id}
            onChange={() => onFocusHabit(habit.id)}
          />
          <span>{habit.label}</span>
        </label>
        <button className="button-ghost danger" onClick={() => onArchiveHabit(habit.id)}>Archive</button>
      </div>)}
    </div>
  </section>
}
