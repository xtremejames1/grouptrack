type EventHandler = (event: { groupId: string; habitId: string; day: string; version: number }) => void

export const subscribeHeatmap = (groupId: string, onEvent: EventHandler) => {
  let active = true
  let retry = 1000
  let es: EventSource | null = null

  const connect = () => {
    if (!active) return
    es = new EventSource(`/api/groups/${groupId}/events`)
    es.addEventListener('heatmap.updated', (message) => {
      const parsed = JSON.parse((message as MessageEvent).data)
      onEvent(parsed)
    })
    es.onerror = () => {
      es?.close()
      setTimeout(connect, retry)
      retry = Math.min(retry * 2, 10000)
    }
  }

  connect()
  const fallback = window.setInterval(() => onEvent({ groupId, habitId: '', day: '', version: Date.now() }), 15000)

  return () => {
    active = false
    es?.close()
    window.clearInterval(fallback)
  }
}
