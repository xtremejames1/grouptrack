from __future__ import annotations

import asyncio
from collections import defaultdict
from dataclasses import dataclass


@dataclass
class Event:
    groupId: str
    habitId: str
    day: str
    version: int


class EventPublisher:
    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[Event]]] = defaultdict(set)

    async def publish(self, group_id: str, event: Event) -> None:
        for queue in list(self._subscribers.get(group_id, set())):
            await queue.put(event)

    async def subscribe(self, group_id: str) -> asyncio.Queue[Event]:
        queue: asyncio.Queue[Event] = asyncio.Queue()
        self._subscribers[group_id].add(queue)
        return queue

    def unsubscribe(self, group_id: str, queue: asyncio.Queue[Event]) -> None:
        self._subscribers.get(group_id, set()).discard(queue)


publisher = EventPublisher()
