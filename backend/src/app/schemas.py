from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional


Scope = Literal["group", "me"]


@dataclass
class JoinRequest:
    displayName: str


@dataclass
class JoinResponse:
    user: dict
    group: dict
    sessionToken: str


@dataclass
class CheckInRequest:
    groupId: str
    habitId: str
    day: str
    idempotencyKey: str


@dataclass
class CheckInResponse:
    checkInId: str
    heatmapVersion: int
    idempotent: bool = False


@dataclass
class HeatmapResponse:
    cells: list
    version: int


@dataclass
class GroupResponse:
    group: dict
    habits: list


@dataclass
class HabitPayload:
    slug: str
    label: str
