"""Internet invitations and the local WebSocket gateway with real TCP clients."""
import io
import time

import pytest
from websockets.exceptions import InvalidStatus
from websockets.sync.client import connect

from game.logic import Profile
from game.net import CoopClient, CoopServer
from game.tunnel import QuickTunnel, WebSocketGateway, invitation, new_token, parse_invitation


def wait(client, predicate, timeout=5):
    end = time.monotonic() + timeout
    observed = []
    while time.monotonic() < end:
        for event in client.poll():
            observed.append(event)
            if predicate(event):
                return event
            if event.get('type') == 'disconnected':
                raise AssertionError(f'unexpected disconnect: {event}')
        time.sleep(.01)
    raise AssertionError(f'timed out; events: {observed[-10:]}')


def test_invitation_is_secret_and_strictly_validated():
    token = new_token()
    assert token != new_token() and len(token) >= 24
    link = invitation('https://a-fresh-room.trycloudflare.com', token, '012345')
    ws, code = parse_invitation(link)
    assert ws == f'wss://a-fresh-room.trycloudflare.com/burger/{token}'
    assert code == '012345' and '#012345' not in ws
    bad = [
        link.replace('https://', 'http://'),
        link.replace('trycloudflare.com', 'trycloudflare.com.evil.example'),
        link.replace('a-fresh-room.', 'user@a-fresh-room.'),
        link.replace('.com/', '.com:8443/'),
        link.replace('/burger/', '/elsewhere/'),
        link.replace('#012345', '?code=012345'),
        link.replace('#012345', '#12345'),
        link.replace(token, 'short'),
    ]
    for value in bad:
        with pytest.raises(ValueError):
            parse_invitation(value)
    with pytest.raises(ValueError):
        invitation('https://evil.example', token, '012345')


def test_gateway_forwards_real_coop_and_rejects_wrong_paths():
    server = CoopServer(Profile(), host='127.0.0.1', port=0, code='123456')
    token = new_token()
    gateway = WebSocketGateway(server.port, token)
    host = CoopClient('127.0.0.1', server.port, 'Хост', server.code, server.host_token)
    url = f'ws://127.0.0.1:{gateway.port}/burger/{token}'
    guest = CoopClient('', 0, 'Гость', server.code, websocket_url=url)
    wrong = None
    try:
        with pytest.raises(InvalidStatus):
            with connect(f'ws://127.0.0.1:{gateway.port}/burger/{new_token()}', proxy=None):
                pass
        host_id = wait(host, lambda e: e.get('type') == 'welcome')['id']
        guest_id = wait(guest, lambda e: e.get('type') == 'welcome')['id']
        host.send({'type': 'start'})
        started = wait(guest, lambda e: e.get('type') == 'snapshot' and e['phase'] == 'playing')
        assert started['host_id'] == host_id
        guest.send({'type': 'chat', 'text': 'Привет через интернет!'} )
        assert wait(host, lambda e: e.get('type') == 'chat' and e.get('text') == 'Привет через интернет!')['name'] == 'Гость'
        guest.send({'type': 'move', 'x': -.94, 'y': -2.4, 'heading': 0})
        guest.send({'type': 'action', 'action': 'interact', 'station': 'cheese'})
        state = wait(host, lambda e: e.get('type') == 'snapshot' and any(
            p['id'] == guest_id and (p['held'] or {}).get('kind') == 'cheese' for p in e['players']))
        assert len(state['players']) == 2

        # Knowing the tunnel URL is not enough to bypass the room code.
        wrong = CoopClient('', 0, 'Лишний', '000000', websocket_url=url)
        refused = wait(wrong, lambda e: e.get('type') == 'rejected')
        assert 'код' in refused['message'].lower()
        wrong.close(); wrong = None

        gateway.stop()
        end = time.monotonic() + 5
        while time.monotonic() < end and not any(e.get('type') == 'disconnected' for e in guest.poll()):
            time.sleep(.01)
        assert time.monotonic() < end, 'guest must disconnect when the gateway stops'
    finally:
        if wrong:
            wrong.close()
        guest.close(); host.close(); gateway.stop(); server.stop()


def test_tunnel_reports_ready_only_after_address_and_registered_connection(monkeypatch):
    class FakeProcess:
        def __init__(self, command, **kwargs):
            assert '--no-autoupdate' in command and 'http://127.0.0.1:43210' in command
            assert '--config' in command and '--protocol' in command
            self.stdout = io.StringIO('https://warm-grill.trycloudflare.com\n'
                                      'INF Registered tunnel connection\n')
        def wait(self, timeout=None): return 0
        def poll(self): return 0

    monkeypatch.setattr('game.tunnel.subprocess.Popen', FakeProcess)
    tunnel = QuickTunnel(43210, executable='fake-cloudflared')
    try:
        end = time.monotonic() + 2
        events = []
        while time.monotonic() < end and not events:
            events.extend(tunnel.poll())
            time.sleep(.01)
        assert events[0] == {'type': 'ready', 'url': 'https://warm-grill.trycloudflare.com'}
        assert any(e['type'] == 'closed' for e in events)
    finally:
        tunnel.stop()


def test_tunnel_does_not_announce_unregistered_url(monkeypatch):
    class FakeProcess:
        def __init__(self, command, **kwargs):
            self.stdout = io.StringIO('https://warm-grill.trycloudflare.com\nconnection failed\n')
        def wait(self, timeout=None): return 1
        def poll(self): return 1

    monkeypatch.setattr('game.tunnel.subprocess.Popen', FakeProcess)
    tunnel = QuickTunnel(43210, executable='fake-cloudflared')
    try:
        end = time.monotonic() + 2
        events = []
        while time.monotonic() < end and not events:
            events.extend(tunnel.poll())
            time.sleep(.01)
        assert len(events) == 1 and events[0]['type'] == 'error'
        assert 'connection failed' in events[0]['detail']
    finally:
        tunnel.stop()
