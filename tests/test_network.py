"""Exercise real TCP peers and shared, host-authoritative game state."""
import time

from game.logic import Profile
from game.net import CoopClient, CoopServer, shift_from_data


def wait_event(client, predicate, timeout=4):
    deadline = time.monotonic() + timeout
    seen = []
    while time.monotonic() < deadline:
        for event in client.poll():
            seen.append(event.get('type'))
            if predicate(event):
                return event
        time.sleep(.02)
    raise AssertionError(f'timed out waiting for network event; observed {seen[-30:]}')


def snapshot(client, predicate=lambda s: True, timeout=4):
    return wait_event(client, lambda e: e.get('type') == 'snapshot' and predicate(e), timeout)


def player(state, player_id):
    return next(p for p in state['players'] if p['id'] == player_id)


def act(client, x, y, station, action='interact'):
    assert client.send({'type': 'move', 'x': x, 'y': y, 'heading': 0})
    assert client.send({'type': 'action', 'action': action, 'station': station})


def test_two_peers_cook_a_shared_order_and_host_owns_progress(tmp_path):
    server = CoopServer(Profile(bank=100), tmp_path / 'profile.json', host='127.0.0.1', port=0, code='123456')
    host = guest = wrong = None
    try:
        wrong = CoopClient('127.0.0.1', server.port, 'Wrong', '000000')
        reject = wait_event(wrong, lambda e: e.get('type') == 'rejected')
        assert 'код' in reject['message'].lower()
        wrong.close()
        wrong = None
        host = CoopClient('127.0.0.1', server.port, 'Повар', server.code, server.host_token)
        guest = CoopClient('127.0.0.1', server.port, 'Помощник', server.code)
        host_id = wait_event(host, lambda e: e.get('type') == 'welcome')['id']
        guest_id = wait_event(guest, lambda e: e.get('type') == 'welcome')['id']
        snapshot(host, lambda s: len(s['players']) == 2 and s['phase'] == 'lobby')
        guest.send({'type': 'start'})
        # Guests cannot start or mutate the room.
        snapshot(host, lambda s: len(s['players']) == 2 and s['phase'] == 'lobby')
        host.send({'type': 'start'})
        started = snapshot(guest, lambda s: s['phase'] == 'playing')
        assert started['host_id'] == host_id
        assert shift_from_data(started['shift']).orders[0].recipe.key == 'cheese'

        act(host, -6.40, -5.28, 'fridge')
        act(guest, -.94, -2.40, 'cheese')
        both = snapshot(host, lambda s: s['phase'] == 'playing'
                        and (player(s, host_id)['held'] or {}).get('kind') == 'raw_patty'
                        and (player(s, guest_id)['held'] or {}).get('kind') == 'cheese')
        assert shift_from_data(both['shift'], player(both, guest_id)['held']).held.kind == 'cheese'

        # The same physical grill is visible to both. Timings use the real clock.
        act(host, -3.25, -6.0, 'grill')
        snapshot(guest, lambda s: s['shift']['patties']['grill'] is not None)
        snapshot(host, lambda s: (s['shift']['patties']['grill'] or {}).get('sides', [0])[0] >= 88, timeout=8)
        act(host, -3.25, -6.0, 'grill', 'flip')
        snapshot(host, lambda s: (s['shift']['patties']['grill'] or {}).get('sides', [0, 0])[1] >= 88, timeout=8)
        act(host, -3.25, -6.0, 'grill')
        snapshot(host, lambda s: (player(s, host_id)['held'] or {}).get('kind') == 'cooked_patty')
        act(host, -2.8, -2.4, 'board')
        snapshot(guest, lambda s: 'patty' in s['shift']['board'])
        act(guest, -2.8, -2.4, 'board')
        snapshot(host, lambda s: 'cheese' in s['shift']['board'])
        act(host, -2.8, -2.4, 'board', 'wrap')
        snapshot(guest, lambda s: (player(s, host_id)['held'] or {}).get('kind') == 'burger')
        act(host, -4.75, -2.4, 'service')
        done = snapshot(guest, lambda s: s['shift']['served'] == 1)
        assert done['shift']['earnings'] >= 18
        assert player(done, guest_id)['held'] is None
        assert done['shift']['dirty_tables'] == 1
        act(guest, -5.8, 1.2, 'clean')
        cleaned = snapshot(host, lambda s: s['shift']['cleaned'] == 1)
        assert cleaned['shift']['dirty_tables'] == 0
        assert cleaned['shift']['earnings'] == done['shift']['earnings'] + 2

        # Force the end of this test shift, then verify only host can upgrade.
        server.shift.remaining = .05
        ended = snapshot(host, lambda s: s['phase'] == 'summary')
        assert ended['shift']['profile']['day'] == 2
        assert Profile.load(tmp_path / 'profile.json').total_served == 1
        guest.send({'type': 'upgrade', 'key': 'grill'})
        snapshot(guest, lambda s: s['phase'] == 'summary' and s['shift']['profile']['grill'] == 0)
        host.send({'type': 'upgrade', 'key': 'grill'})
        bought = snapshot(guest, lambda s: s['phase'] == 'summary' and s['shift']['profile']['grill'] == 1)
        assert bought['shift']['profile']['bank'] < 100 + done['shift']['earnings']
        assert Profile.load(tmp_path / 'profile.json').grill == 1
        host.close()
        wait_event(guest, lambda e: e.get('type') == 'disconnected')
    finally:
        for client in (wrong, guest, host):
            if client:
                client.close()
        server.stop()


def test_remote_action_requires_proximity_and_chat_is_shared(tmp_path):
    server = CoopServer(Profile(), tmp_path / 'profile.json', host='127.0.0.1', port=0, code='123456')
    host = CoopClient('127.0.0.1', server.port, 'А', server.code, server.host_token)
    guest = CoopClient('127.0.0.1', server.port, 'Б', server.code)
    try:
        wait_event(host, lambda e: e.get('type') == 'welcome')
        wait_event(guest, lambda e: e.get('type') == 'welcome')
        host.send({'type': 'start'})
        snapshot(guest, lambda s: s['phase'] == 'playing')
        act(guest, 0, -5, 'fridge')
        denial = wait_event(guest, lambda e: e.get('type') == 'event' and not e['ok'])
        assert 'ближе' in denial['message']
        guest.send({'type': 'chat', 'text': 'Гриль готов!'})
        msg = wait_event(host, lambda e: e.get('type') == 'chat' and e.get('text') == 'Гриль готов!')
        assert msg['name'] == 'Б'
    finally:
        guest.close()
        host.close()
        server.stop()


def test_eight_real_players_capacity_parallel_stations_and_trash(tmp_path):
    server = CoopServer(Profile(), tmp_path / 'profile.json', host='127.0.0.1', port=0, code='123456')
    clients = []
    try:
        ids = []
        for i in range(8):
            client = CoopClient('127.0.0.1', server.port, f'Повар {i}', server.code,
                                server.host_token if i == 0 else '')
            clients.append(client)
            ids.append(wait_event(client, lambda e: e.get('type') == 'welcome')['id'])
        assert len(set(ids)) == 8
        snapshot(clients[0], lambda s: len(s['players']) == 8)
        ninth = CoopClient('127.0.0.1', server.port, 'Лишний', server.code)
        clients.append(ninth)
        refusal = wait_event(ninth, lambda e: e.get('type') == 'rejected')
        assert '8' in refusal['message']
        ninth.close()
        clients.remove(ninth)

        clients[0].send({'type': 'start'})
        started = snapshot(clients[7], lambda s: s['phase'] == 'playing')
        assert started['shift']['team_size'] == 8
        assert shift_from_data(started['shift']).max_orders == 6
        # Three cooks operate independent grill sections; others do separate jobs.
        for client in clients[:3]:
            act(client, -6.3, -5.28, 'fridge')
        snapshot(clients[0], lambda s: all((player(s, ids[i])['held'] or {}).get('kind') == 'raw_patty'
                                           for i in range(3)))
        for client, key, x in zip(clients[:3], ('grill_left', 'grill', 'grill_right'), (-4.05, -3.25, -2.45)):
            act(client, x, -6.0, key)
        act(clients[3], 6.2, -2.4, 'coffee')
        act(clients[4], 3.35, -6.0, 'fryer')
        act(clients[5], -.94, -2.4, 'cheese')
        act(clients[6], 4.85, -2.4, 'soda')
        live = snapshot(clients[7], lambda s: all(s['shift']['patties'][k] is not None for k in ('grill_left', 'grill', 'grill_right'))
                        and s['shift']['coffee']['active'] and s['shift']['fryer']['active']
                        and (player(s, ids[5])['held'] or {}).get('kind') == 'cheese'
                        and (player(s, ids[6])['held'] or {}).get('kind') == 'soda')
        assert all((player(live, ids[i])['held'] is None) for i in range(3))

        snapshot(clients[3], lambda s: s['phase'] == 'playing' and s['shift']['coffee']['elapsed'] >= 5, timeout=8)
        act(clients[3], 6.2, -2.4, 'coffee')
        snapshot(clients[0], lambda s: (player(s, ids[3])['held'] or {}).get('kind') == 'coffee')

        # Fill the shared rubbish bin through real player actions and carry its bag away.
        for i in range(5):
            act(clients[0], -6.3, -5.28, 'fridge')
            snapshot(clients[0], lambda s: (player(s, ids[0])['held'] or {}).get('kind') == 'raw_patty')
            clients[0].send({'type': 'action', 'action': 'discard'})
            snapshot(clients[0], lambda s: s['shift']['trash_count'] == i + 1 and player(s, ids[0])['held'] is None)
        act(clients[0], 7.4, -5.75, 'bin')
        snapshot(clients[1], lambda s: (player(s, ids[0])['held'] or {}).get('kind') == 'trash_bag')
        act(clients[0], 7.2, -3.6, 'dumpster')
        cleared = snapshot(clients[1], lambda s: s['phase'] == 'playing' and s['shift']['earnings'] >= 3 and player(s, ids[0])['held'] is None)
        assert cleared['shift']['trash_count'] == 0

        # A departed slot can be reused while the kitchen is running.
        clients[4].close()
        snapshot(clients[0], lambda s: len(s['players']) == 7)
        replacement = CoopClient('127.0.0.1', server.port, 'Новый', server.code)
        clients.append(replacement)
        new_id = wait_event(replacement, lambda e: e.get('type') == 'welcome')['id']
        rejoined = snapshot(replacement, lambda s: len(s['players']) == 8 and s['phase'] == 'playing')
        assert player(rejoined, new_id)['slot'] == 4
        assert rejoined['shift']['team_size'] == 8
        clients[7].send({'type': 'chat', 'text': 'Восемь поваров!'})
        assert wait_event(replacement, lambda e: e.get('type') == 'chat' and e.get('text') == 'Восемь поваров!')['name'] == 'Повар 7'
    finally:
        for client in clients:
            client.close()
        server.stop()
