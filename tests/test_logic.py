from pathlib import Path
from game.logic import Fryer, Item, Order, Patty, Profile, RECIPES, Shift


def cooked(s):
    assert s.interact('fridge').ok
    assert s.interact('grill').ok
    s.tick(s.grill_seconds * .9)
    assert s.flip().ok
    s.tick(s.grill_seconds * .9)
    assert s.interact('grill').ok
    assert s.held.kind == 'cooked_patty'


def build_burger(s, toppings=('cheese',)):
    cooked(s)
    assert s.interact('board').ok
    for ingredient in toppings:
        assert s.interact(ingredient).ok
        assert s.interact('board').ok
    assert s.wrap().ok


def test_patty_flip_and_burn():
    p = Patty()
    p.tick(5.5, 6)
    assert not p.ready
    p.flip(); p.tick(5.5, 6)
    assert p.ready and not p.burnt
    p.tick(4, 6)
    assert p.burnt and not p.ready


def test_full_first_order_and_career_credit():
    p = Profile()
    s = Shift(p, seed=1)
    build_burger(s)
    result = s.interact('service')
    assert result.ok and s.served == 1 and s.earnings >= 18
    assert s.held is None and not s.orders
    s.finish(); s.finish()
    assert p.bank == s.earnings and p.total_served == 1 and p.day == 2


def test_recipe_mismatch_does_not_consume_food():
    s = Shift(seed=1)
    build_burger(s, ('cheese', 'tomato'))
    assert not s.interact('service').ok
    assert s.held.kind == 'burger' and not s.orders[0].burger_done


def test_sides_complete_one_ticket_without_stealing_other_orders():
    s = Shift(seed=4)
    s.orders = [Order(1, RECIPES[0], needs_fries=True, needs_soda=True)]
    s.held = Item('soda'); assert s.interact('service').ok
    assert not s.orders[0].complete and s.orders[0].soda_done
    s.held = Item('fries'); assert s.interact('service').ok
    build_burger(s)
    assert s.interact('service').ok and s.served == 1


def test_fryer_can_burn_and_be_cleared():
    s = Shift(seed=1)
    assert s.interact('fryer').ok
    s.tick(s.fryer_seconds * 1.9)
    assert s.fryer.status(s.fryer_seconds) == 'СГОРЕЛА'
    s.interact('fryer')
    assert s.held.kind == 'burnt_fries'
    assert s.interact('bin').ok and s.held is None
    assert s.interact('fryer').ok
    s.tick(s.fryer_seconds * 1.1)
    assert s.interact('fryer').ok and s.held.kind == 'fries'


def test_timeout_and_idempotent_end():
    s = Shift(seed=2)
    s.orders[0].patience = 0.5
    events = s.tick(1)
    assert s.lost == 1 and any('не дождался' in e.message for e in events)
    s.tick(1000)
    assert s.finished and s.profile.day == 2
    s.tick(1000)
    assert s.profile.day == 2


def test_restrict_duplicate_and_raw_patty():
    s = Shift(seed=2)
    assert s.interact('fridge').ok
    assert not s.interact('board').ok
    assert s.discard_held().ok
    assert s.interact('board').ok
    assert s.interact('cheese').ok and s.interact('board').ok
    assert s.interact('cheese').ok
    assert not s.interact('board').ok and s.held.kind == 'cheese'
    assert not s.wrap().ok


def test_profile_roundtrip_and_bad_files(tmp_path: Path):
    path = tmp_path / 'save' / 'profile.json'
    p = Profile(day=4, bank=300)
    assert p.buy('grill') and p.bank == 245
    p.save(path)
    assert Profile.load(path) == p
    path.write_text('{broken', encoding='utf8')
    assert Profile.load(path) == Profile()
    path.write_text('{"day": -2, "grill": 999}', encoding='utf8')
    q = Profile.load(path)
    assert q.day == 1 and q.grill == 3


def test_buying_is_bounded_and_validated():
    p = Profile(bank=1000)
    assert [p.buy('patience') for _ in range(4)] == [True, True, True, False]
    assert not p.buy('bank')
