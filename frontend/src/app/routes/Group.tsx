import { Group, Habit, HeatmapCell } from '../types'

type GroupViewProps = {
  group: Group
  habits: Habit[]
  cells: HeatmapCell[]
  onGoHabits: () => void
  onGoCheckIn: () => void
}

export function GroupView({ group, habits, cells, onGoHabits, onGoCheckIn }: GroupViewProps) {
  const activeHabits = habits.filter(habit => habit.active)

  return <section className="card stack">
    <div>
      <p className="eyebrow">Step 1</p>
      <h2>{group.name}</h2>
      <p className="muted">Invite teammates with code <strong>{group.inviteCode}</strong>. Your group is complete when at least {group.completionThresholdN} people check in.</p>
    </div>

    <div className="stats-grid">
      <div className="stat-card">
        <p className="stat-label">Active habits</p>
        <p className="stat-value">{activeHabits.length}</p>
      </div>
      <div className="stat-card">
        <p className="stat-label">Nudge setting</p>
        <p className="stat-value">{group.nudgesEnabled ? 'Enabled' : 'Off'}</p>
      </div>
    </div>

    <div className="heatmap-wrap">
      <p className="stat-label">Group activity</p>
      <div className="heatmap">{cells.map(cell => <div key={cell.day} className={`cell i${cell.intensity}`} title={`${cell.day}: ${cell.count}`} />)}</div>
    </div>

    <div className="row">
      <button className="button-ghost" onClick={onGoHabits}>Edit habits</button>
      <button className="button-primary" onClick={onGoCheckIn}>Go to check-in</button>
    </div>
  </section>
}
