"""Game rules, intentionally independent of the rendering engine.

All clocks use seconds supplied by the caller, which makes a shift deterministic
and permits the same rules to be tested without a graphics or audio device.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import random
import tempfile
from typing import Optional

from .stations import GRILL_KEYS

TOPPING_NAMES = {
    "cheese": "сыр",
    "lettuce": "салат",
    "tomato": "томат",
    "pickle": "огурец",
}
ITEM_NAMES = {
    "raw_patty": "сырая котлета",
    "cooked_patty": "жареная котлета",
    "burnt_patty": "сгоревшая котлета",
    "burger": "бургер",
    "fries": "картофель фри",
    "burnt_fries": "сгоревшая картошка",
    "soda": "газировка",
    "coffee": "кофе",
    "trash_bag": "мешок мусора",
    **TOPPING_NAMES,
}


@dataclass(frozen=True)
class Recipe:
    key: str
    name: str
    toppings: frozenset[str]
    price: int


RECIPES = (
    Recipe("cheese", "Чизбургер", frozenset({"cheese"}), 18),
    Recipe("garden", "Фреш-бургер", frozenset({"cheese", "lettuce"}), 22),
    Recipe("tomato", "Томатный", frozenset({"cheese", "tomato"}), 23),
    Recipe("house", "Фирменный", frozenset({"cheese", "lettuce", "tomato"}), 27),
    Recipe("pickle", "Пикл-бургер", frozenset({"cheese", "pickle"}), 23),
)


@dataclass
class Item:
    kind: str
    toppings: frozenset[str] = frozenset()


@dataclass
class Patty:
    """Both sides cook independently; left too long, either side can burn."""
    sides: list[float] = field(default_factory=lambda: [0.0, 0.0])
    face_down: int = 0

    def tick(self, dt: float, seconds_per_side: float) -> None:
        if seconds_per_side <= 0:
            raise ValueError("seconds_per_side must be positive")
        self.sides[self.face_down] = min(200.0, self.sides[self.face_down] + 100 * max(0.0, dt) / seconds_per_side)

    def flip(self) -> None:
        self.face_down = 1 - self.face_down

    @property
    def burnt(self) -> bool:
        return max(self.sides) >= 155.0

    @property
    def ready(self) -> bool:
        return not self.burnt and min(self.sides) >= 85.0

    def status(self) -> str:
        if self.burnt:
            return "СГОРЕЛА"
        if self.ready:
            return "ГОТОВА"
        return "ЖАРИТСЯ"


@dataclass
class Fryer:
    elapsed: float = 0.0
    active: bool = False

    def tick(self, dt: float) -> None:
        if self.active:
            self.elapsed += max(0.0, dt)

    def status(self, ready_after: float) -> str:
        if not self.active:
            return "ПУСТО"
        if self.elapsed >= ready_after * 1.8:
            return "СГОРЕЛА"
        if self.elapsed >= ready_after:
            return "ГОТОВА"
        return "ЖАРИТСЯ"


@dataclass
class CoffeeMachine:
    elapsed: float = 0.0
    active: bool = False

    def tick(self, dt: float) -> None:
        if self.active:
            self.elapsed += max(0.0, dt)

    def status(self, ready_after: float) -> str:
        if not self.active:
            return "ПУСТО"
        return "ГОТОВ" if self.elapsed >= ready_after else "ВАРИТСЯ"


@dataclass
class Order:
    number: int
    recipe: Recipe
    needs_fries: bool = False
    needs_soda: bool = False
    patience: float = 140.0
    max_patience: float = 140.0
    burger_done: bool = False
    fries_done: bool = False
    soda_done: bool = False
    needs_coffee: bool = False
    coffee_done: bool = False

    @property
    def complete(self) -> bool:
        return (self.burger_done and (not self.needs_fries or self.fries_done)
                and (not self.needs_soda or self.soda_done)
                and (not self.needs_coffee or self.coffee_done))

    @property
    def percent(self) -> float:
        return max(0.0, min(1.0, self.patience / self.max_patience))

    @property
    def price(self) -> int:
        return (self.recipe.price + (7 if self.needs_fries else 0)
                + (5 if self.needs_soda else 0) + (6 if self.needs_coffee else 0))


@dataclass
class Profile:
    day: int = 1
    bank: int = 0
    grill: int = 0
    fryer: int = 0
    patience: int = 0
    total_served: int = 0

    @classmethod
    def load(cls, path: Path) -> "Profile":
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                return cls()
            fields = {k: max(0, min(1_000_000, int(data[k]))) for k in cls.__dataclass_fields__ if k in data}
            fields["day"] = max(1, fields.get("day", 1))
            for key in ("grill", "fryer", "patience"):
                fields[key] = min(3, fields.get(key, 0))
            return cls(**fields)
        except (OSError, ValueError, TypeError, OverflowError):
            return cls()

    def save(self, path: Path) -> None:
        """Write atomically, so closing during a save doesn't corrupt a career."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = None
        try:
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as f:
                tmp = f.name
                json.dump(vars(self), f, ensure_ascii=False, indent=2)
            os.replace(tmp, path)
        finally:
            if tmp and os.path.exists(tmp):
                os.unlink(tmp)

    def upgrade_cost(self, key: str) -> int:
        if key not in {"grill", "fryer", "patience"}:
            raise ValueError("unknown upgrade")
        return 55 + getattr(self, key) * 45

    def buy(self, key: str) -> bool:
        if key not in {"grill", "fryer", "patience"}:
            return False
        level = getattr(self, key)
        cost = self.upgrade_cost(key)
        if level >= 3 or self.bank < cost:
            return False
        self.bank -= cost
        setattr(self, key, level + 1)
        return True


@dataclass
class Result:
    ok: bool
    message: str
    sound: str = "click"


class Shift:
    DURATION = 240.0
    MAX_ORDERS = 6
    TRASH_LIMIT = 5

    def __init__(self, profile: Optional[Profile] = None, seed: Optional[int] = None,
                 team_size: int = 1):
        self.profile = profile or Profile()
        self.rng = random.Random(seed)
        self.team_size = max(1, min(8, int(team_size)))
        self.remaining = self.DURATION
        self.spawn_in = max(20.0, 36.0 - (self.team_size - 1) * 3.0)
        self.orders: list[Order] = []
        self.next_number = 1
        self.held: Optional[Item] = None
        self.board: list[str] = []
        self.patties: dict[str, Optional[Patty]] = {key: None for key in GRILL_KEYS}
        self.fryer = Fryer()
        self.coffee = CoffeeMachine()
        self.trash_count = 0
        self.dirty_tables = 0
        self.cleaned = 0
        self.earnings = 0
        self.served = 0
        self.lost = 0
        self.streak = 0
        self.finished = False
        self._credited = False
        self._spawn(first=True)

    # Compatibility for the original central grill and existing solo saves/tests.
    @property
    def patty(self) -> Optional[Patty]:
        return self.patties['grill']

    @patty.setter
    def patty(self, value: Optional[Patty]) -> None:
        self.patties['grill'] = value

    @property
    def max_orders(self) -> int:
        return min(self.MAX_ORDERS, max(3, self.team_size + 2))

    @property
    def coffee_seconds(self) -> float:
        return 5.0

    @property
    def grill_seconds(self) -> float:
        return max(3.8, 6.0 - self.profile.grill * 0.6)

    @property
    def fryer_seconds(self) -> float:
        return max(4.0, 8.0 - self.profile.fryer * 0.9)

    def _spawn(self, first: bool = False) -> Order:
        recipe = RECIPES[0] if first else self.rng.choice(RECIPES[:min(5, 3 + self.profile.day)])
        patience = 155.0 + 18.0 * self.profile.patience
        # The first customer is a guided burger-only ticket.
        order = Order(self.next_number, recipe,
                      False if first else self.rng.random() < 0.48,
                      False if first else self.rng.random() < 0.38,
                      patience, patience,
                      needs_coffee=False if first else self.rng.random() < 0.30)
        self.next_number += 1
        self.orders.append(order)
        return order

    def tick(self, dt: float) -> list[Result]:
        if self.finished or dt <= 0:
            return []
        # Never advance cooking after the clock reaches zero.
        dt = min(float(dt), self.remaining)
        events: list[Result] = []
        for patty in self.patties.values():
            if patty:
                before = patty.burnt
                patty.tick(dt, self.grill_seconds)
                if not before and patty.burnt:
                    events.append(Result(False, "Котлета сгорела! Убери её в корзину.", "bad"))
        previous_coffee = self.coffee.status(self.coffee_seconds)
        self.coffee.tick(dt)
        if previous_coffee != 'ГОТОВ' and self.coffee.status(self.coffee_seconds) == 'ГОТОВ':
            events.append(Result(True, "Кофе готов!", "ding"))
        previous_fryer = self.fryer.status(self.fryer_seconds)
        self.fryer.tick(dt)
        current_fryer = self.fryer.status(self.fryer_seconds)
        if previous_fryer != current_fryer and current_fryer == "ГОТОВА":
            events.append(Result(True, "Картофель фри готов!", "ding"))
        if previous_fryer != current_fryer and current_fryer == "СГОРЕЛА":
            events.append(Result(False, "Картофель сгорел!", "bad"))
        for order in list(self.orders):
            order.patience -= dt
            if order.patience <= 0:
                self.orders.remove(order)
                self.lost += 1
                self.streak = 0
                events.append(Result(False, f"Гость #{order.number} не дождался заказа.", "bad"))
        self.spawn_in -= dt
        if self.spawn_in <= 0 and self.remaining > 35:
            if len(self.orders) < self.max_orders:
                new = self._spawn()
                events.append(Result(True, f"Новый заказ #{new.number}", "ding"))
                self.spawn_in = max(18.0, 38.0 - (self.profile.day - 1) * 1.4
                                    - (self.team_size - 1) * 3.0)
            else:
                self.spawn_in = 5.0
        self.remaining -= dt
        if self.remaining <= 0:
            self.remaining = 0
            self.finish()
            events.append(Result(True, "Смена закончена!", "finish"))
        return events

    def finish(self) -> None:
        if self._credited:
            return
        self.finished = True
        self.profile.bank += self.earnings
        self.profile.total_served += self.served
        self.profile.day += 1
        self._credited = True

    def interact(self, station: str) -> Result:
        if self.finished:
            return Result(False, "Смена уже закончилась.")
        if station == "fridge":
            if self.held:
                return Result(False, "Сначала освободи руки.", "bad")
            self.held = Item("raw_patty")
            return Result(True, "Сырая котлета в руках. Отнеси её на гриль.", "pickup")
        if station in GRILL_KEYS:
            patty = self.patties[station]
            if self.held and self.held.kind == "raw_patty":
                if patty:
                    return Result(False, "На этой части гриля уже есть котлета.", "bad")
                self.patties[station] = Patty()
                self.held = None
                return Result(True, "Котлета на гриле. Нажми F, чтобы перевернуть.", "sizzle")
            if self.held:
                return Result(False, "Освободи руки, чтобы снять котлету.", "bad")
            if patty is None:
                return Result(False, "Гриль пуст. Возьми котлету в холодильнике.")
            if patty.burnt:
                self.held = Item("burnt_patty")
                self.patties[station] = None
                return Result(False, "Котлета сгорела. Выброси её в корзину.", "bad")
            if not patty.ready:
                return Result(False, "Прожарь обе стороны. F — перевернуть.")
            self.held = Item("cooked_patty")
            self.patties[station] = None
            return Result(True, "Котлета готова! Отнеси её на стол сборки.", "pickup")
        if station == "board":
            if not self.held:
                if not self.board:
                    self.board = ["bun"]
                    return Result(True, "Булочка на доске. Добавь котлету и начинку.", "pickup")
                return Result(True, "R — завернуть бургер. Нужные ингредиенты указаны в заказе.")
            if self.held.kind in {"cooked_patty", *TOPPING_NAMES}:
                ingredient = "patty" if self.held.kind == "cooked_patty" else self.held.kind
                if not self.board:
                    self.board = ["bun"]
                if ingredient in self.board:
                    return Result(False, "Этот ингредиент уже в бургере.", "bad")
                self.board.append(ingredient)
                name = ITEM_NAMES[self.held.kind]
                self.held = None
                return Result(True, f"Добавлено: {name}.", "pickup")
            return Result(False, "Этот предмет нельзя положить в бургер.", "bad")
        if station in TOPPING_NAMES:
            if self.held:
                return Result(False, "Сначала освободи руки.", "bad")
            self.held = Item(station)
            return Result(True, f"Взято: {TOPPING_NAMES[station]}. Отнеси на доску.", "pickup")
        if station == "fryer":
            if self.held:
                return Result(False, "Сначала освободи руки.", "bad")
            status = self.fryer.status(self.fryer_seconds)
            if status == "ПУСТО":
                self.fryer = Fryer(active=True)
                return Result(True, "Картошка во фритюре. Забери её, когда будет готова.", "sizzle")
            if status == "ЖАРИТСЯ":
                return Result(False, "Картофель ещё жарится.")
            self.held = Item("fries" if status == "ГОТОВА" else "burnt_fries")
            self.fryer = Fryer()
            return Result(status == "ГОТОВА", "Картофель готов!" if status == "ГОТОВА" else "Картофель сгорел. Выброси его.", "pickup")
        if station == "soda":
            if self.held:
                return Result(False, "Сначала освободи руки.", "bad")
            self.held = Item("soda")
            return Result(True, "Газировка готова к выдаче.", "pickup")
        if station == "coffee":
            if self.held:
                return Result(False, "Сначала освободи руки.", "bad")
            status = self.coffee.status(self.coffee_seconds)
            if status == "ПУСТО":
                self.coffee = CoffeeMachine(active=True)
                return Result(True, "Кофе готовится. Вернись за ним через несколько секунд.", "click")
            if status == "ВАРИТСЯ":
                return Result(False, "Кофе ещё готовится.")
            self.coffee = CoffeeMachine()
            self.held = Item("coffee")
            return Result(True, "Кофе готов к выдаче.", "pickup")
        if station == "service":
            return self._serve()
        if station == "bin":
            if self.held and self.held.kind == 'trash_bag':
                return Result(False, "Отнеси мешок в контейнер у правой стены.")
            if self.trash_count >= self.TRASH_LIMIT:
                if self.held:
                    return Result(False, "Корзина полна. Освободи руки, прежде чем взять мешок.", "bad")
                self.held = Item("trash_bag")
                self.trash_count = 0
                return Result(True, "Мешок заполнен. Отнеси его к контейнеру.", "trash")
            if self.held:
                return self.discard_held()
            if self.board:
                self.board = []
                self.trash_count = min(self.TRASH_LIMIT, self.trash_count + 1)
                return Result(True, f"Доска очищена. Мусор: {self.trash_count}/{self.TRASH_LIMIT}.", "trash")
            return Result(False, f"Корзина: {self.trash_count}/{self.TRASH_LIMIT}. Когда заполнится, вынеси мешок.")
        if station == "dumpster":
            if not self.held or self.held.kind != "trash_bag":
                return Result(False, "Принеси сюда полный мешок из корзины.")
            self.held = None
            self.earnings += 3
            return Result(True, "Мусор вынесен. За чистоту +$3!", "success")
        if station == "clean":
            if not self.dirty_tables:
                return Result(False, "Все столы чистые.")
            if self.held:
                return Result(False, "Освободи руки, чтобы убрать стол.", "bad")
            self.dirty_tables -= 1
            self.cleaned += 1
            self.earnings += 2
            return Result(True, "Стол убран. За чистоту +$2!", "success")
        return Result(False, "Здесь пока нечего делать.")

    def flip(self, station: str = "grill") -> Result:
        patty = self.patties.get(station)
        if not patty:
            return Result(False, "На этой части гриля нет котлеты.")
        patty.flip()
        return Result(True, "Котлета перевёрнута.", "flip")

    def wrap(self) -> Result:
        if self.held:
            return Result(False, "Сначала освободи руки.", "bad")
        if not self.board or "patty" not in self.board:
            return Result(False, "Добавь в бургер жареную котлету.", "bad")
        self.held = Item("burger", frozenset(x for x in self.board if x in TOPPING_NAMES))
        self.board = []
        return Result(True, "Бургер завёрнут! Отнеси его к выдаче.", "pickup")

    def discard_held(self) -> Result:
        if self.held and self.held.kind == 'trash_bag':
            return Result(False, "Отнеси мешок в контейнер у правой стены.", "bad")
        if self.held:
            self.held = None
            self.trash_count = min(self.TRASH_LIMIT, self.trash_count + 1)
            suffix = ' Корзина полна!' if self.trash_count >= self.TRASH_LIMIT else ''
            return Result(True, f"Предмет убран. Мусор: {self.trash_count}/{self.TRASH_LIMIT}.{suffix}", "trash")
        return Result(False, "Руки уже свободны.")

    def _serve(self) -> Result:
        if not self.held:
            return Result(False, "Возьми готовый бургер, картошку или напиток.")
        if not self.orders:
            return Result(False, "Сейчас нет заказов.")
        item = self.held
        chosen = None
        for order in self.orders:
            if item.kind == "burger" and not order.burger_done and item.toppings == order.recipe.toppings:
                order.burger_done = True
                chosen = order
                break
            if item.kind == "fries" and order.needs_fries and not order.fries_done:
                order.fries_done = True
                chosen = order
                break
            if item.kind == "soda" and order.needs_soda and not order.soda_done:
                order.soda_done = True
                chosen = order
                break
            if item.kind == "coffee" and order.needs_coffee and not order.coffee_done:
                order.coffee_done = True
                chosen = order
                break
        if chosen is None:
            return Result(False, "Этот предмет не подходит ни к одному заказу. Проверь состав.", "bad")
        self.held = None
        if not chosen.complete:
            return Result(True, f"Добавлено к заказу #{chosen.number}. Осталось собрать остальное.", "pickup")
        tip = int(chosen.price * 0.25 * chosen.percent)
        payment = chosen.price + tip
        self.earnings += payment
        self.served += 1
        self.streak += 1
        self.dirty_tables = min(4, self.dirty_tables + 1)
        self.orders.remove(chosen)
        return Result(True, f"Заказ #{chosen.number} выдан! +${payment} (чаевые ${tip})", "success")

    def tutorial(self) -> str:
        if self.held and self.held.kind == 'trash_bag':
            return "Отнеси мешок к КОНТЕЙНЕРУ у правой стены."
        if self.served:
            if self.trash_count >= self.TRASH_LIMIT:
                return "Корзина полна: забери мешок и вынеси его в контейнер."
            if self.dirty_tables:
                return "После гостей можно убрать столы в зале и получить бонус."
            return "Следи за заказами: бургеры, фри, газировка и кофе."
        if self.held:
            return {
                "raw_patty": "Отнеси котлету на ГРИЛЬ и нажми E.",
                "cooked_patty": "Отнеси котлету к СТОЛУ СБОРКИ и нажми E.",
                "cheese": "Добавь сыр на СТОЛ СБОРКИ клавишей E.",
                "burger": "Отнеси готовый бургер к ВЫДАЧЕ и нажми E.",
                "burnt_patty": "Котлета сгорела: выброси её в корзину или нажми Q.",
            }.get(self.held.kind, "Ориентируйся на состав заказа справа.")
        patty = next((p for p in self.patties.values() if p), None)
        if patty:
            if patty.burnt:
                return "Забери сгоревшую котлету и выброси в корзину."
            if patty.ready:
                return "Котлета готова! Забери её с гриля клавишей E."
            if patty.sides[patty.face_down] >= 85 and min(patty.sides) < 85:
                return "Пора перевернуть котлету: наведи на гриль и нажми F."
            return "Жарь котлеты на трёх участках гриля. F — перевернуть, E — забрать."
        if "patty" in self.board:
            if "cheese" not in self.board:
                return "Возьми СЫР на стойке и добавь его к бургеру на доске."
            return "Посмотри на СТОЛ СБОРКИ и нажми R, чтобы завернуть бургер."
        return "Возьми сырую котлету в ХОЛОДИЛЬНИКЕ слева от гриля."
