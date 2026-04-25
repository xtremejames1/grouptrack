import { HeatmapCell } from '../types'

const KEY = 'grouptrack.heatmap'

export const loadHeatmap = (): Record<string, HeatmapCell[]> => JSON.parse(localStorage.getItem(KEY) ?? '{}')
export const saveHeatmap = (groupId: string, scope: string, cells: HeatmapCell[]) => {
  const current = loadHeatmap()
  current[`${groupId}:${scope}`] = cells
  localStorage.setItem(KEY, JSON.stringify(current))
}
