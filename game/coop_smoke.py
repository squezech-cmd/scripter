"""Headless, two-machine co-op diagnostic used by the packaged-app smoke test.

Both processes use the same networking code as the GUI. The host creates a
fresh temporary tunnel and writes an invitation to a file; a guest on another
machine reads it. Result files contain no invitation or room code. This is a
regression test, not a matchmaking service or a public game room.
"""
from __future__ import annotations

import json
from pathlib import Path
import time
import traceback

from .logic import Profile
from .net import CoopClient, CoopServer
from .tunnel import QuickTunnel, WebSocketGateway, invitation, new_token, parse_invitation

GUEST_HELLO = 'smoke:guest-hello'
HOST_ACK = 'smoke:host-ack'
GUEST_ACK = 'smoke:guest-ack'
HOST_FINISH = 'smoke:host-finish'
GUEST_FINISH = 'smoke:guest-finish'


def _write_atomic(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(value, encoding='utf-8')
    temp.replace(path)


def _send(client: CoopClient, message: dict) -> None:
    if not client.send(message):
        raise RuntimeError('Could not queue a co-op message')


def _host(invite_path: Path, timeout: float) -> list[str]:
    server = gateway = tunnel = client = None
    deadline = time.monotonic() + timeout
    try:
        server = CoopServer(Profile(), host='127.0.0.1', port=0)
        token = new_token()
        gateway = WebSocketGateway(server.port, token)
        tunnel = QuickTunnel(gateway.port)
        address = None
        startup_deadline = min(deadline, time.monotonic() + 80)
        while time.monotonic() < startup_deadline and not address:
            for event in tunnel.poll():
                if event.get('type') == 'ready':
                    address = event.get('url')
                elif event.get('type') in ('error', 'closed'):
                    raise RuntimeError('Tunnel could not start: ' + event.get('detail', 'unknown error'))
            time.sleep(.02)
        if not address:
            raise TimeoutError('Tunnel did not register within 80 seconds')

        client = CoopClient('127.0.0.1', server.port, 'Smoke host', server.code, server.host_token)
        _write_atomic(invite_path, invitation(address, token, server.code))
        host_id = None
        started = cheese = hello = acknowledged = finish_sent = False
        while time.monotonic() < deadline:
            for event in tunnel.poll():
                if event.get('type') in ('error', 'closed'):
                    raise RuntimeError('Tunnel closed: ' + event.get('detail', 'unknown error'))
            for event in client.poll():
                typ = event.get('type')
                if typ == 'welcome':
                    if not event.get('host'):
                        raise RuntimeError('The host did not receive host privileges')
                    host_id = event.get('id')
                elif typ == 'snapshot':
                    players = event.get('players', [])
                    guests = [p for p in players if p.get('id') != host_id and not p.get('host')]
                    if host_id and guests and event.get('phase') == 'lobby' and not started:
                        _send(client, {'type': 'start'})
                        started = True
                    if event.get('phase') == 'playing' and any(
                            (p.get('held') or {}).get('kind') == 'cheese' for p in guests):
                        cheese = True
                elif typ == 'chat':
                    text = event.get('text')
                    if text == GUEST_HELLO:
                        hello = True
                    elif text == GUEST_ACK and acknowledged and not finish_sent:
                        _send(client, {'type': 'chat', 'text': HOST_FINISH})
                        finish_sent = True
                    elif text == GUEST_FINISH and finish_sent:
                        return ['tunnel registered', 'guest joined', 'shift started',
                                'guest action synchronized', 'two-way chat']
                elif typ in ('rejected', 'disconnected'):
                    raise RuntimeError('Host connection closed unexpectedly: ' + str(event.get('message', '')))
            if hello and cheese and not acknowledged:
                _send(client, {'type': 'chat', 'text': HOST_ACK})
                acknowledged = True
            time.sleep(.02)
        raise TimeoutError('Timed out waiting for the guest, action, or chat acknowledgement')
    finally:
        if client:
            client.close()
        if tunnel:
            tunnel.stop()
        if gateway:
            gateway.stop()
        if server:
            server.stop()


def _guest(invite_path: Path, timeout: float) -> list[str]:
    endpoint, code = parse_invitation(invite_path.read_text(encoding='utf-8').strip())
    deadline = time.monotonic() + timeout
    wrong_code = '000000' if code != '000000' else '111111'
    wrong = CoopClient('', 0, 'Smoke wrong code', wrong_code, websocket_url=endpoint)
    try:
        rejected = False
        wrong_deadline = min(deadline, time.monotonic() + 30)
        while time.monotonic() < wrong_deadline:
            for event in wrong.poll():
                if event.get('type') == 'rejected':
                    rejected = True
                    break
                if event.get('type') == 'disconnected':
                    raise RuntimeError('Wrong-code test disconnected before receiving a rejection')
            if rejected:
                break
            time.sleep(.02)
        if not rejected:
            raise TimeoutError('Wrong-code test did not receive a rejection')
    finally:
        wrong.close()

    client = CoopClient('', 0, 'Smoke guest', code, websocket_url=endpoint)
    try:
        guest_id = None
        playing = sent_action = acknowledged = False
        while time.monotonic() < deadline:
            for event in client.poll():
                typ = event.get('type')
                if typ == 'welcome':
                    if event.get('host'):
                        raise RuntimeError('Guest incorrectly became host')
                    guest_id = event.get('id')
                elif typ == 'snapshot' and event.get('phase') == 'playing':
                    playing = True
                elif typ == 'chat':
                    if event.get('text') == HOST_ACK and sent_action and not acknowledged:
                        _send(client, {'type': 'chat', 'text': GUEST_ACK})
                        acknowledged = True
                    elif event.get('text') == HOST_FINISH and acknowledged:
                        _send(client, {'type': 'chat', 'text': GUEST_FINISH})
                        # Allow the asynchronous sender to flush before closing.
                        time.sleep(.35)
                        return ['wrong code rejected', 'guest joined', 'shift started',
                                'action sent', 'two-way chat']
                elif typ in ('rejected', 'disconnected'):
                    raise RuntimeError('Guest connection closed unexpectedly: ' + str(event.get('message', '')))
            if guest_id and playing and not sent_action:
                _send(client, {'type': 'move', 'x': -.94, 'y': -2.4, 'heading': 0})
                _send(client, {'type': 'action', 'action': 'interact', 'station': 'cheese'})
                _send(client, {'type': 'chat', 'text': GUEST_HELLO})
                sent_action = True
            time.sleep(.02)
        raise TimeoutError('Timed out waiting for the host or the two-way chat')
    finally:
        client.close()


def run(role: str, invitation_file: str, result_file: str, timeout: float = 240) -> int:
    """Run a diagnostic and persist an explicit success/failure for GUI EXEs."""
    output = Path(result_file)
    try:
        if role == 'host':
            checks = _host(Path(invitation_file), timeout)
        elif role == 'guest':
            checks = _guest(Path(invitation_file), timeout)
        else:
            raise ValueError('Unknown co-op smoke test role')
        result = {'ok': True, 'role': role, 'checks': checks}
    except Exception as exc:
        result = {'ok': False, 'role': role, 'error': str(exc), 'traceback': traceback.format_exc()}
    _write_atomic(output, json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    return 0 if result['ok'] else 1
