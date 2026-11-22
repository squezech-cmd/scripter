"""Offscreen first-person smoke test, launched in a separate process by pytest.

Keeping ShowBase in its own process avoids Panda3D's global singleton affecting
other tests, and exercises the same game, targeting and UI code as the EXE.
"""
from collections import deque
from pathlib import Path
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from direct.gui.DirectGuiBase import DirectGuiWidget
from game.logic import Order, Profile, RECIPES
from game.world import STATIONS
from main import BurgerGame, save_path


def run():
    game = BurgerGame(offscreen=True)
    try:
        # Repeated transitions must destroy DirectGUI objects rather than leak
        # old buttons, and leave one usable menu behind.
        menu_widgets = len(DirectGuiWidget.guiDict)
        menu_nodes = game.ui.overlay.getNumChildren()
        for _ in range(4):
            game.ui.guide()
            game.ui.menu()
            assert len(DirectGuiWidget.guiDict) == menu_widgets
            assert game.ui.overlay.getNumChildren() == menu_nodes

        game.start_shift()
        shift = game.shift
        assert game.mode == 'playing' and len(shift.orders) == 1
        # Customer actors must keep their animation controls after creation.
        assert len(game.world.customer_actors) == 6
        assert all(actor.getCurrentAnim() == 'unarmed_idle' for actor in game.world.customer_actors)

        # Walking and pause flow go through the real controller.
        start_y = game.camera.getY()
        game._set_key('w', True)
        game._move(.1)
        game._set_key('w', False)
        assert game.camera.getY() > start_y
        game.escape()
        before = shift.remaining
        game.update(SimpleNamespace(cont='cont'))
        assert game.mode == 'pause' and shift.remaining == before
        game.escape()
        assert game.mode == 'playing'

        def aim(key):
            station = next(st for st in STATIONS if st.key == key)
            if key == 'fridge':
                x, y, heading = station.x + 1.1, station.y, 90
            elif key in ('grill_left', 'grill', 'grill_right', 'fryer', 'bin'):
                x, y, heading = station.x, station.y + 1.2, 180
            elif key == 'dumpster':
                x, y, heading = station.x - 1.2, station.y, -90
            else:
                x, y, heading = station.x, station.y - 1.2, 0
            assert game.world.can_walk(x, y), key
            game.camera.setPos(x, y, 1.68)
            game.heading, game.pitch = heading, -15
            game.camera.setHpr(heading, -15, 0)
            game.target = game.find_target()
            assert game.target and game.target.key == key, key
            return x, y

        # Every interactable point also has a walkable route from the kitchen,
        # not merely a targetable position reached by teleporting in a test.
        goals = {station.key: aim(station.key) for station in STATIONS}
        origin, step = -8.6, .2
        coord = lambda i: origin + i * step
        start = (43, 18)  # (0, -5)
        seen = {start}; pending = deque([start])
        while pending:
            i, j = pending.popleft()
            for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                point = (i + di, j + dj)
                if point in seen or not all(0 <= n <= 86 for n in point):
                    continue
                if game.world.can_walk(coord(point[0]), coord(point[1])):
                    seen.add(point); pending.append(point)
        for key, (x, y) in goals.items():
            assert any((coord(i) - x) ** 2 + (coord(j) - y) ** 2 < .23 ** 2 for i, j in seen), key

        def burger():
            aim('fridge'); game.interact()
            assert shift.held and shift.held.kind == 'raw_patty'
            aim('grill'); game.interact()
            assert shift.patty and shift.held is None
            shift.tick(shift.grill_seconds * .90)
            game.flip()
            shift.tick(shift.grill_seconds * .90)
            assert shift.patty.ready
            game.interact()
            assert shift.held and shift.held.kind == 'cooked_patty'
            aim('board'); game.interact()
            aim('cheese'); game.interact()
            aim('board'); game.interact()
            game.wrap()
            assert shift.held and shift.held.kind == 'burger'

        # Standing right against the fridge door should still target it; the
        # interaction point must not disappear behind the player's camera.
        assert game.world.can_walk(-6.80, -5.28)
        game.camera.setPos(-6.80, -5.28, 1.68)
        game.camera.setHpr(90, -15, 0)
        game.target = game.find_target()
        assert game.target and game.target.key == 'fridge'

        burger()
        aim('service'); game.interact()
        assert shift.served == 1 and shift.earnings >= RECIPES[0].price

        # A complete combo: drinks and fries are delivered separately, then the
        # exact burger, and payment occurs once all three parts have arrived.
        shift.orders = [Order(200, RECIPES[0], needs_fries=True, needs_soda=True)]
        aim('soda'); game.interact()
        aim('service'); game.interact()
        assert shift.orders[0].soda_done and shift.served == 1
        aim('fryer'); game.interact()
        shift.tick(shift.fryer_seconds * 1.05)
        game.interact()
        assert shift.held and shift.held.kind == 'fries'
        aim('service'); game.interact()
        assert shift.orders[0].fries_done and shift.served == 1
        burger()
        aim('service'); game.interact()
        assert shift.served == 2 and not shift.orders

        # New appliances, each section of the grill, and cleaning stations are
        # reachable through exactly the same first-person targeting as the EXE.
        for station in ('grill_left', 'grill', 'grill_right', 'coffee', 'bin', 'dumpster', 'clean'):
            aim(station)
        shift.orders = [Order(201, RECIPES[0], needs_coffee=True)]
        aim('coffee'); game.interact()
        shift.tick(shift.coffee_seconds * 1.05)
        game.interact()
        assert shift.held and shift.held.kind == 'coffee'
        aim('service'); game.interact()
        assert shift.orders[0].coffee_done
        burger(); aim('service'); game.interact()
        assert shift.served == 3 and shift.dirty_tables == 3
        for _ in range(shift.TRASH_LIMIT):
            aim('fridge'); game.interact(); game.drop()
        aim('bin'); game.interact()
        assert shift.held and shift.held.kind == 'trash_bag'
        aim('dumpster'); game.interact()
        assert shift.held is None and shift.trash_count == 0
        aim('clean'); game.interact()
        assert shift.dirty_tables == 2 and shift.cleaned == 1

        # Expiring the clock through the real update shows the summary and
        # persists the career outside the temporary game extraction directory.
        earnings = shift.earnings
        shift.tick(shift.remaining)
        game.update(SimpleNamespace(cont='cont'))
        assert game.mode == 'summary'
        saved = Profile.load(save_path())
        assert saved.day == 2 and saved.total_served == 3 and saved.bank == earnings
        assert earnings >= saved.upgrade_cost('grill')
        game.buy_upgrade('grill')
        assert Profile.load(save_path()).grill == 1
        game.start_shift()
        assert game.shift.profile.grill == 1 and not game.shift.board
        game.escape(); game.return_menu()
        assert game.mode == 'menu'
        print('OFFSCREEN INTEGRATION OK')
    finally:
        game.destroy()


if __name__ == '__main__':
    run()
