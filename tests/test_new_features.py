from game.logic import Item, Order, RECIPES, Shift


def test_three_grill_spots_are_independent():
    shift = Shift(seed=1)
    for station in ('grill_left', 'grill_right'):
        assert shift.interact('fridge').ok
        assert shift.interact(station).ok
    shift.tick(shift.grill_seconds * .9)
    assert shift.flip('grill_left').ok
    shift.tick(shift.grill_seconds * .9)
    assert shift.patties['grill_left'].ready
    assert shift.patties['grill_right'].burnt
    assert shift.interact('grill_left').ok
    assert shift.held.kind == 'cooked_patty'
    assert shift.patties['grill_right'] is not None


def test_coffee_is_brewed_and_is_part_of_a_combo():
    shift = Shift(seed=1)
    shift.orders = [Order(8, RECIPES[0], needs_coffee=True)]
    assert shift.interact('coffee').ok
    assert not shift.interact('coffee').ok
    shift.tick(shift.coffee_seconds + .1)
    assert shift.interact('coffee').ok
    assert shift.held.kind == 'coffee'
    assert shift.interact('service').ok
    assert shift.orders[0].coffee_done and not shift.orders[0].complete
    shift.held = Item('burger', frozenset({'cheese'}))
    assert shift.interact('service').ok
    assert shift.served == 1 and shift.earnings >= 24


def test_trash_bag_and_table_cleanup_have_a_bonus():
    shift = Shift(seed=1)
    for _ in range(shift.TRASH_LIMIT):
        shift.held = Item('burnt_patty')
        assert shift.discard_held().ok
    assert shift.trash_count == shift.TRASH_LIMIT
    shift.held = Item('burger', frozenset({'cheese'}))
    assert not shift.interact('bin').ok and shift.held.kind == 'burger'
    shift.held = None
    assert shift.interact('bin').ok
    assert shift.held.kind == 'trash_bag' and shift.trash_count == 0
    assert not shift.discard_held().ok
    assert shift.interact('dumpster').ok and shift.earnings == 3
    shift.dirty_tables = 2
    assert shift.interact('clean').ok
    assert shift.dirty_tables == 1 and shift.cleaned == 1 and shift.earnings == 5
