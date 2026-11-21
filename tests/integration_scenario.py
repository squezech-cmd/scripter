"""Offscreen first-person smoke test, launched in a separate process by pytest.

Keeping ShowBase in its own process avoids Panda3D's global singleton affecting
other tests, and exercises the same game, targeting and UI code as the EXE.
"""
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
            elif key in ('grill', 'fryer', 'bin'):
                x, y, heading = station.x, station.y + 1.2, 180
            else:
                x, y, heading = station.x, station.y - 1.2, 0
            assert game.world.can_walk(x, y), key
            game.camera.setPos(x, y, 1.68)
            game.heading, game.pitch = heading, -15
            game.camera.setHpr(heading, -15, 0)
            game.target = game.find_target()
            assert game.target and game.target.key == key, key

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

        # Expiring the clock through the real update shows the summary and
        # persists the career outside the temporary game extraction directory.
        earnings = shift.earnings
        shift.tick(shift.remaining)
        game.update(SimpleNamespace(cont='cont'))
        assert game.mode == 'summary'
        saved = Profile.load(save_path())
        assert saved.day == 2 and saved.total_served == 2 and saved.bank == earnings
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
