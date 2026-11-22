"""Exercise the packaged-app diagnostic without claiming loopback is internet."""
import json
import threading
import time
from urllib.parse import urlsplit

from game import coop_smoke


def test_smoke_protocol_on_loopback(monkeypatch, tmp_path):
    class LocalTunnel:
        def __init__(self, port):
            self.port = port
            self.sent = False
            LocalTunnel.port = port

        def poll(self):
            if not self.sent:
                self.sent = True
                return [{'type': 'ready', 'url': 'https://test.trycloudflare.com'}]
            return []

        def stop(self):
            pass

    def local_invitation(base, token, code):
        return f'ws://127.0.0.1:{LocalTunnel.port}/burger/{token}#{code}'

    def local_parse(value):
        parts = urlsplit(value)
        return value.split('#', 1)[0], parts.fragment

    monkeypatch.setattr(coop_smoke, 'QuickTunnel', LocalTunnel)
    monkeypatch.setattr(coop_smoke, 'invitation', local_invitation)
    monkeypatch.setattr(coop_smoke, 'parse_invitation', local_parse)
    invite = tmp_path / 'invite.txt'
    host_result = tmp_path / 'host.json'
    guest_result = tmp_path / 'guest.json'
    host = threading.Thread(target=coop_smoke.run,
                            args=('host', str(invite), str(host_result), 15))
    host.start()
    deadline = time.monotonic() + 5
    while not invite.exists() and not host_result.exists() and time.monotonic() < deadline:
        time.sleep(.01)
    try:
        assert invite.exists(), host_result.read_text() if host_result.exists() else 'no invitation'
        assert coop_smoke.run('guest', str(invite), str(guest_result), 10) == 0, guest_result.read_text()
    finally:
        host.join(timeout=16)
    assert not host.is_alive()
    host_data = json.loads(host_result.read_text())
    guest_data = json.loads(guest_result.read_text())
    assert host_data['ok'], host_data
    assert guest_data['ok'], guest_data
    assert 'guest action synchronized' in host_data['checks']
    assert 'wrong code rejected' in guest_data['checks']
    # The results must never expose the invitation or its secret room code.
    assert invite.read_text() not in host_result.read_text() + guest_result.read_text()


def test_smoke_writes_diagnostic_on_failure(tmp_path):
    result = tmp_path / 'failure.json'
    code = coop_smoke.run('guest', str(tmp_path / 'missing.txt'), str(result), 1)
    assert code == 1
    report = json.loads(result.read_text())
    assert not report['ok'] and report['role'] == 'guest' and report['error']
