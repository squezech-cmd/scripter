"""Drive Panda3D co-op screens and controllers against real TCP peers offscreen."""
import os
from pathlib import Path
import socket
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from game.logic import Profile
from game.net import CoopClient, CoopServer
from main import BurgerGame, save_path


def unused_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def pump(game, predicate, timeout=5):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        game.taskMgr.step()
        if predicate():
            return
        time.sleep(.02)
    raise AssertionError(f'co-op UI timed out in mode={game.mode}, phase={game.net_phase}')


def wait_client(client, predicate, game=None, timeout=5):
    end = time.monotonic() + timeout
    seen = []
    while time.monotonic() < end:
        if game:
            game.taskMgr.step()
        for event in client.poll():
            seen.append(event.get('type'))
            if predicate(event):
                return event
        time.sleep(.02)
    raise AssertionError(f'client timed out, observed {seen[-20:]}')


def screen(game, name):
    directory = os.environ.get('BURGER_SCREENSHOT_DIR')
    if directory:
        Path(directory).mkdir(parents=True, exist_ok=True)
        for _ in range(3):
            game.graphicsEngine.renderFrame()
        assert game.win.saveScreenshot(str(Path(directory) / name))


def run():
    game = BurgerGame(offscreen=True)
    guest = owner = other_server = None
    try:
        game.profile = Profile(bank=100)
        game.ui.coop_setup()
        game.ui.coop_entries['name'].enterText('Шеф')
        game.ui.coop_entries['port'].enterText(str(unused_port()))
        screen(game, 'setup.png')
        game.host_coop()
        pump(game, lambda: game.mode == 'lobby')
        assert game.net_is_host and len(game.net_server.code) == 6
        guest = CoopClient('127.0.0.1', game.coop_port, 'Помощник', game.coop_code)
        guest_welcome = wait_client(guest, lambda e: e.get('type') == 'welcome', game)
        pump(game, lambda: len(game.net_players) == 2)
        screen(game, 'lobby.png')
        guest.send({'type': 'chat', 'text': 'Привет, шеф!'})
        pump(game, lambda: any(text == 'Привет, шеф!' for _, text in game.net_chat))
        game.start_shift()
        pump(game, lambda: game.mode == 'playing' and game.shift is not None)
        wait_client(guest, lambda e: e.get('type') == 'snapshot' and e['phase'] == 'playing', game)
        pump(game, lambda: guest_welcome['id'] in game.world.players)
        guest.send({'type': 'move', 'x': .4, 'y': -5.2, 'heading': 90})
        pump(game, lambda: abs(game.world.players[guest_welcome['id']]['root'].getX() - .4) < .2)
        game.camera.setPos(-2.4, -5.2, 1.68)
        game.heading = -90
        game.camera.setHpr(-90, -3, 0)
        screen(game, 'teammate.png')

        # Real first-person controller -> TCP -> authority -> both views.
        game.camera.setPos(-6.3, -5.28, 1.68)
        game.heading = 90
        game.camera.setHpr(90, -15, 0)
        game.target = game.find_target()
        assert game.target and game.target.key == 'fridge'
        game.interact()
        pump(game, lambda: game.shift.held and game.shift.held.kind == 'raw_patty')
        wait_client(guest, lambda e: e.get('type') == 'snapshot' and any(
            p['id'] == game.net_id and (p['held'] or {}).get('kind') == 'raw_patty'
            for p in e['players']), game)

        guest.send({'type': 'move', 'x': -.94, 'y': -2.4, 'heading': 0})
        guest.send({'type': 'action', 'action': 'interact', 'station': 'cheese'})
        pump(game, lambda: any(p['id'] == guest_welcome['id'] and
                               (p['held'] or {}).get('kind') == 'cheese' for p in game.net_players))
        assert game.world.players[guest_welcome['id']]['held'][0] == 'cheese'

        # Typing into chat must not fire cooking or movement hotkeys.
        game.open_chat()
        assert game.chat_open
        game._set_key('w', True)
        assert not game.keys['w']
        game.drop()
        assert game.shift.held.kind == 'raw_patty'
        game.send_chat('Котлета готовится')
        assert not game.chat_open
        wait_client(guest, lambda e: e.get('type') == 'chat' and e.get('text') == 'Котлета готовится', game)

        game.escape()
        assert game.mode == 'pause'
        before = game.net_server.shift.remaining
        pump(game, lambda: game.net_server.shift.remaining < before - .15)
        game.resume()
        assert game.mode == 'playing'

        game.net_server.shift.remaining = .05
        pump(game, lambda: game.mode == 'summary')
        assert game.shift.profile.day == 2
        game.buy_upgrade('grill')
        pump(game, lambda: game.shift.profile.grill == 1)
        assert Profile.load(save_path()).grill == 1
        game.return_menu()
        wait_client(guest, lambda e: e.get('type') == 'disconnected')
        guest.close(); guest = None
        own_profile = vars(game.profile).copy()

        # A guest views the host career but must never overwrite their own save.
        other_server = CoopServer(Profile(day=8, bank=200), host='127.0.0.1', port=0, code='654321')
        owner = CoopClient('127.0.0.1', other_server.port, 'Друг', other_server.code, other_server.host_token)
        wait_client(owner, lambda e: e.get('type') == 'welcome')
        game.ui.coop_setup()
        game.ui.coop_entries['address'].enterText('127.0.0.1')
        game.ui.coop_entries['port'].enterText(str(other_server.port))
        game.ui.coop_entries['code'].enterText(other_server.code)
        game.join_coop()
        pump(game, lambda: game.mode == 'lobby')
        assert not game.net_is_host
        owner.send({'type': 'start'})
        pump(game, lambda: game.mode == 'playing')
        assert game.shift.profile.day == 8 and vars(game.profile) == own_profile
        other_server.shift.remaining = .05
        pump(game, lambda: game.mode == 'summary')
        assert game.shift.profile.day == 9 and vars(game.profile) == own_profile
        game.buy_upgrade('grill')
        assert other_server.profile.grill == 0
        game.return_menu()
        assert other_server.alive and vars(game.profile) == own_profile
        assert vars(Profile.load(save_path())) == own_profile
        print('COOP UI INTEGRATION OK')
    finally:
        for client in (guest, owner):
            if client:
                client.close()
        if other_server:
            other_server.stop()
        game.destroy()


if __name__ == '__main__':
    run()
