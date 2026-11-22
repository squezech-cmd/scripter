"""Shared station positions, used by the renderer and the co-op authority."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Station:
    key: str
    label: str
    x: float
    y: float
    z: float = 1.1


STATIONS = (
    Station('service', 'ВЫДАЧА', -4.75, -1.48),
    Station('board', 'СБОРКА', -2.80, -1.48),
    Station('cheese', 'СЫР', -.94, -1.48),
    Station('lettuce', 'САЛАТ', .20, -1.48),
    Station('tomato', 'ТОМАТ', 1.34, -1.48),
    Station('pickle', 'ОГУРЕЦ', 2.48, -1.48),
    Station('soda', 'НАПИТКИ', 4.85, -1.48),
    Station('coffee', 'КОФЕ', 6.20, -1.48),
    # The fridge point is inside the door so it remains in front of a player
    # standing right against the collision boundary.
    Station('fridge', 'ХОЛОДИЛЬНИК', -7.40, -5.28),
    Station('grill_left', 'ГРИЛЬ 1', -4.05, -7.35),
    Station('grill', 'ГРИЛЬ 2', -3.25, -7.35),
    Station('grill_right', 'ГРИЛЬ 3', -2.45, -7.35),
    Station('fryer', 'ФРИТЮР', 3.35, -7.35),
    Station('bin', 'КОРЗИНА', 7.40, -6.95),
    Station('dumpster', 'КОНТЕЙНЕР', 8.00, -3.60),
    Station('clean', 'УБОРКА СТОЛОВ', -5.80, 2.40),
)
STATION_BY_KEY = {station.key: station for station in STATIONS}
GRILL_KEYS = ('grill_left', 'grill', 'grill_right')
