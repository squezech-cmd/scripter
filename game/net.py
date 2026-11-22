"""Host-authoritative co-op over a bounded, newline-delimited JSON/TCP protocol.

No relay, accounts or cloud service are required. One player hosts a trusted
room and all peers, including the host, use the same protocol. Only the host
advances cooking and orders; each player has a separate inventory. The network
thread never touches Panda3D objects. The protocol is intentionally not
encrypted, so rooms should only be opened to people the host trusts.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import json
import math
from pathlib import Path
import queue
import secrets
import selectors
import socket
import threading
import time
from typing import Any

from .logic import CoffeeMachine, Fryer, Item, Order, Patty, Profile, RECIPES, Shift, TOPPING_NAMES
from .stations import GRILL_KEYS, STATION_BY_KEY

PROTOCOL_VERSION = 1
DEFAULT_PORT = 38447
MAX_PLAYERS = 8
MAX_LINE = 32 * 1024
MAX_BUFFER = 512 * 1024
SNAPSHOT_INTERVAL = .12
COLORS = ('orange', 'teal', 'red', 'blue', 'green', 'purple', 'yellow', 'pink')


def _text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ''
    return ''.join(ch for ch in value if ch.isprintable() and ch not in '\r\n\t').strip()[:limit]


def _encode(message: dict[str, Any]) -> bytes:
    return (json.dumps(message, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')


def item_data(item: Item | None) -> dict[str, Any] | None:
    if not item:
        return None
    return {'kind': item.kind, 'toppings': sorted(item.toppings)}


def item_from_data(data: Any) -> Item | None:
    if data is None:
        return None
    if not isinstance(data, dict) or not isinstance(data.get('kind'), str):
        raise ValueError('invalid item')
    kind = data['kind']
    allowed = {'raw_patty', 'cooked_patty', 'burnt_patty', 'burger', 'fries',
               'burnt_fries', 'soda', 'coffee', 'trash_bag', *TOPPING_NAMES}
    if kind not in allowed:
        raise ValueError('unknown item')
    toppings = data.get('toppings', [])
    if not isinstance(toppings, list) or any(t not in TOPPING_NAMES for t in toppings):
        raise ValueError('invalid toppings')
    return Item(kind, frozenset(toppings))


def shift_data(shift: Shift | None) -> dict[str, Any] | None:
    if shift is None:
        return None
    return {
        'profile': vars(shift.profile).copy(),
        'team_size': shift.team_size,
        'remaining': round(shift.remaining, 3),
        'earnings': shift.earnings,
        'served': shift.served,
        'lost': shift.lost,
        'streak': shift.streak,
        'finished': shift.finished,
        'board': list(shift.board),
        'patties': {key: ({'sides': p.sides[:], 'face_down': p.face_down} if p else None)
                    for key, p in shift.patties.items()},
        'fryer': {'elapsed': shift.fryer.elapsed, 'active': shift.fryer.active},
        'coffee': {'elapsed': shift.coffee.elapsed, 'active': shift.coffee.active},
        'trash_count': shift.trash_count,
        'dirty_tables': shift.dirty_tables,
        'cleaned': shift.cleaned,
        'orders': [
            {'number': o.number, 'recipe': o.recipe.key,
             'needs_fries': o.needs_fries, 'needs_soda': o.needs_soda,
             'needs_coffee': o.needs_coffee, 'patience': o.patience,
             'max_patience': o.max_patience, 'burger_done': o.burger_done,
             'fries_done': o.fries_done, 'soda_done': o.soda_done,
             'coffee_done': o.coffee_done}
            for o in shift.orders
        ],
    }


def shift_from_data(data: dict[str, Any], held: Any = None) -> Shift:
    """Reconstitute a render-only view. Never ticks or modifies host state."""
    if not isinstance(data, dict) or not isinstance(data.get('profile'), dict):
        raise ValueError('invalid shift')
    profile_data = data['profile']
    profile = Profile(**{key: int(profile_data.get(key, default)) for key, default in
                        (('day', 1), ('bank', 0), ('grill', 0), ('fryer', 0),
                         ('patience', 0), ('total_served', 0))})
    result = Shift(profile, seed=0, team_size=int(data.get('team_size', 1)))
    result.remaining = max(0.0, float(data['remaining']))
    if not math.isfinite(result.remaining):
        raise ValueError('invalid clock')
    result.earnings = int(data['earnings'])
    result.served = int(data['served'])
    result.lost = int(data['lost'])
    result.streak = int(data.get('streak', 0))
    result.finished = bool(data['finished'])
    board = data['board']
    if not isinstance(board, list) or len(board) > 10 or any(x not in {'bun', 'patty', *TOPPING_NAMES} for x in board):
        raise ValueError('invalid board')
    result.board = board[:]
    patties = data['patties']
    if not isinstance(patties, dict):
        raise ValueError('invalid grill')
    result.patties = {}
    for key in GRILL_KEYS:
        p = patties.get(key)
        if p is None:
            result.patties[key] = None
        else:
            sides = [float(x) for x in p['sides']]
            if len(sides) != 2 or not all(math.isfinite(x) and 0 <= x <= 200 for x in sides):
                raise ValueError('invalid patty')
            face = int(p['face_down'])
            if face not in (0, 1):
                raise ValueError('invalid patty side')
            result.patties[key] = Patty(sides, face)
    fryer = data['fryer']
    coffee = data['coffee']
    result.fryer = Fryer(float(fryer['elapsed']), bool(fryer['active']))
    result.coffee = CoffeeMachine(float(coffee['elapsed']), bool(coffee['active']))
    if not all(math.isfinite(x) and x >= 0 for x in (result.fryer.elapsed, result.coffee.elapsed)):
        raise ValueError('invalid appliance clock')
    result.trash_count = max(0, min(result.TRASH_LIMIT, int(data.get('trash_count', 0))))
    result.dirty_tables = max(0, min(4, int(data.get('dirty_tables', 0))))
    result.cleaned = max(0, int(data.get('cleaned', 0)))
    recipes = {recipe.key: recipe for recipe in RECIPES}
    raw_orders = data['orders']
    if not isinstance(raw_orders, list) or len(raw_orders) > result.MAX_ORDERS:
        raise ValueError('invalid orders')
    result.orders = []
    for o in raw_orders:
        recipe = recipes[o['recipe']]
        patience, maximum = float(o['patience']), float(o['max_patience'])
        if not math.isfinite(patience) or not math.isfinite(maximum) or maximum <= 0:
            raise ValueError('invalid patience')
        result.orders.append(Order(
            int(o['number']), recipe, bool(o['needs_fries']), bool(o['needs_soda']),
            patience, maximum, bool(o['burger_done']), bool(o['fries_done']), bool(o['soda_done']),
            bool(o.get('needs_coffee', False)), bool(o.get('coffee_done', False))))
    result.held = item_from_data(held)
    return result


@dataclass
class _Player:
    id: str
    name: str
    slot: int
    host: bool
    x: float
    y: float
    heading: float = 0.0
    held: Item | None = None

    def public(self) -> dict[str, Any]:
        return {'id': self.id, 'name': self.name, 'slot': self.slot, 'host': self.host,
                'x': round(self.x, 3), 'y': round(self.y, 3), 'heading': round(self.heading, 2),
                'held': item_data(self.held), 'color': COLORS[self.slot]}


@dataclass
class _Peer:
    sock: socket.socket
    addr: Any
    joined_at: float = field(default_factory=time.monotonic)
    incoming: bytearray = field(default_factory=bytearray)
    outgoing: bytearray = field(default_factory=bytearray)
    player: _Player | None = None
    close_after_write: bool = False


class CoopServer:
    """Small single-threaded authority with up to eight real network clients."""
    def __init__(self, profile: Profile | None = None, save_path: Path | None = None,
                 host: str = '0.0.0.0', port: int = DEFAULT_PORT, code: str | None = None):
        self.profile = Profile(**vars(profile or Profile()))
        self.save_path = Path(save_path) if save_path is not None else None
        self.code = code or f'{secrets.randbelow(1_000_000):06d}'
        if not (len(self.code) == 6 and self.code.isascii() and self.code.isdigit()):
            raise ValueError('room code must contain six digits')
        self.host_token = secrets.token_hex(16)
        self.phase = 'lobby'
        self.epoch = 0
        self.shift: Shift | None = None
        self.host_id: str | None = None
        self._stop = threading.Event()
        self._selector = selectors.DefaultSelector()
        self._listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            self._listener.bind((host, int(port)))
            self._listener.listen(16)
            self._listener.setblocking(False)
            self.port = self._listener.getsockname()[1]
            self._selector.register(self._listener, selectors.EVENT_READ, None)
        except Exception:
            self._listener.close()
            self._selector.close()
            raise
        self._peers: dict[socket.socket, _Peer] = {}
        self._thread = threading.Thread(target=self._run, name='burger-coop-host', daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if threading.current_thread() is not self._thread:
            self._thread.join(timeout=2.0)

    @property
    def alive(self) -> bool:
        return self._thread.is_alive()

    def _watch(self, peer: _Peer) -> None:
        events = selectors.EVENT_READ | (selectors.EVENT_WRITE if peer.outgoing else 0)
        try:
            self._selector.modify(peer.sock, events, peer)
        except (ValueError, KeyError, OSError):
            pass

    def _send(self, peer: _Peer, message: dict[str, Any]) -> None:
        try:
            payload = _encode(message)
        except (TypeError, ValueError):
            return
        if len(peer.outgoing) + len(payload) > MAX_BUFFER:
            self._close(peer)
            return
        peer.outgoing.extend(payload)
        self._watch(peer)

    def _broadcast(self, message: dict[str, Any]) -> None:
        for peer in list(self._peers.values()):
            if peer.player:
                self._send(peer, message)

    def _reject(self, peer: _Peer, message: str) -> None:
        self._send(peer, {'type': 'rejected', 'message': message})
        peer.close_after_write = True

    def _close(self, peer: _Peer) -> None:
        if peer.sock not in self._peers:
            return
        self._peers.pop(peer.sock, None)
        try:
            self._selector.unregister(peer.sock)
        except (KeyError, ValueError, OSError):
            pass
        try:
            peer.sock.close()
        except OSError:
            pass
        if peer.player:
            self._broadcast({'type': 'chat', 'name': 'Система',
                             'text': f'{peer.player.name} вышел из комнаты.'})
            if self.shift:
                self.shift.team_size = max(1, sum(p.player is not None for p in self._peers.values()))
            if peer.player.host:
                # The room belongs to its host; no guest silently becomes host.
                self._stop.set()

    def _snapshot(self) -> dict[str, Any]:
        players = [p.player.public() for p in self._peers.values() if p.player]
        return {'type': 'snapshot', 'phase': self.phase, 'epoch': self.epoch,
                'host_id': self.host_id, 'players': players, 'shift': shift_data(self.shift)}

    def _save(self) -> None:
        if self.save_path:
            try:
                self.profile.save(self.save_path)
            except OSError:
                self._broadcast({'type': 'event', 'ok': False,
                                 'message': 'Не удалось сохранить прогресс хоста.', 'sound': 'bad'})

    def _join(self, peer: _Peer, msg: dict[str, Any]) -> None:
        if msg.get('protocol') != PROTOCOL_VERSION:
            self._reject(peer, 'Версии игры не совпадают. Обновите игру у всех участников.')
            return
        code = msg.get('code')
        if not isinstance(code, str) or not secrets.compare_digest(code, self.code):
            self._reject(peer, 'Неверный код комнаты.')
            return
        players = [p.player for p in self._peers.values() if p.player]
        if len(players) >= MAX_PLAYERS:
            self._reject(peer, 'Комната заполнена (максимум 8 игроков).')
            return
        token = msg.get('host_token', '')
        host = isinstance(token, str) and bool(token) and secrets.compare_digest(token, self.host_token)
        if host and self.host_id is not None:
            self._reject(peer, 'Хост уже подключён.')
            return
        used = {player.slot for player in players}
        slot = next(i for i in range(MAX_PLAYERS) if i not in used)
        name = _text(msg.get('name', ''), 18) or f'Игрок {slot + 1}'
        player = _Player(secrets.token_hex(6), name, slot, host,
                         -2.4 + (slot % 4) * 1.6, -5.2 + (slot // 4) * 1.1)
        peer.player = player
        if host:
            self.host_id = player.id
        if self.shift:
            self.shift.team_size = len(players) + 1
        self._send(peer, {'type': 'welcome', 'id': player.id, 'host': host})
        self._broadcast({'type': 'chat', 'name': 'Система', 'text': f'{name} вошёл в комнату.'})
        self._send(peer, self._snapshot())

    def _message(self, peer: _Peer, msg: Any) -> None:
        if not isinstance(msg, dict) or not isinstance(msg.get('type'), str):
            self._reject(peer, 'Некорректное сообщение.')
            return
        typ = msg['type']
        if not peer.player:
            if typ == 'join':
                self._join(peer, msg)
            else:
                self._reject(peer, 'Сначала войдите в комнату.')
            return
        player = peer.player
        if typ == 'move':
            try:
                x, y, heading = float(msg['x']), float(msg['y']), float(msg['heading'])
            except (KeyError, ValueError, TypeError, OverflowError):
                return
            if all(math.isfinite(v) for v in (x, y, heading)) and -8.65 <= x <= 8.65 and -8.65 <= y <= 8.65:
                player.x, player.y, player.heading = x, y, heading % 360.0
            return
        if typ == 'chat':
            text = _text(msg.get('text', ''), 140)
            if text:
                self._broadcast({'type': 'chat', 'name': player.name, 'text': text})
            return
        if typ == 'start':
            if not player.host or self.phase not in ('lobby', 'summary'):
                return
            count = sum(p.player is not None for p in self._peers.values())
            self.shift = Shift(self.profile, team_size=count)
            self.epoch += 1
            self.phase = 'playing'
            for p in self._peers.values():
                if p.player:
                    p.player.held = None
                    p.player.x = -2.4 + (p.player.slot % 4) * 1.6
                    p.player.y = -5.2 + (p.player.slot // 4) * 1.1
                    p.player.heading = 0.0
            self._broadcast({'type': 'event', 'ok': True, 'message': 'Смена началась!', 'sound': 'ding'})
            self._broadcast(self._snapshot())
            return
        if typ == 'upgrade':
            if player.host and self.phase == 'summary':
                key = msg.get('key')
                ok = isinstance(key, str) and self.profile.buy(key)
                self._save()
                self._send(peer, {'type': 'event', 'ok': bool(ok),
                                  'message': 'Улучшение куплено.' if ok else 'Недостаточно средств или достигнут максимум.',
                                  'sound': 'success' if ok else 'bad'})
                self._broadcast(self._snapshot())
            return
        if typ != 'action' or self.phase != 'playing' or not self.shift:
            return
        action, key = msg.get('action'), msg.get('station')
        if action not in ('interact', 'flip', 'wrap', 'discard'):
            return
        if action != 'discard':
            station = STATION_BY_KEY.get(key) if isinstance(key, str) else None
            if not station or math.hypot(station.x - player.x, station.y - player.y) > 2.55:
                self._send(peer, {'type': 'event', 'ok': False, 'message': 'Подойди ближе к станции.', 'sound': 'bad'})
                return
            if action == 'flip' and key not in GRILL_KEYS:
                return
            if action == 'wrap' and key != 'board':
                return
        # The shared kitchen has separate hands for each connected player.
        self.shift.held = player.held
        if action == 'interact':
            result = self.shift.interact(key)
        elif action == 'flip':
            result = self.shift.flip(key)
        elif action == 'wrap':
            result = self.shift.wrap()
        else:
            result = self.shift.discard_held()
        player.held = self.shift.held
        self.shift.held = None
        self._send(peer, {'type': 'event', 'ok': result.ok, 'message': result.message, 'sound': result.sound})
        self._broadcast(self._snapshot())

    def _read(self, peer: _Peer) -> None:
        try:
            data = peer.sock.recv(16384)
        except (BlockingIOError, InterruptedError):
            return
        except OSError:
            self._close(peer)
            return
        if not data:
            self._close(peer)
            return
        peer.incoming.extend(data)
        while b'\n' in peer.incoming:
            line, _, remainder = peer.incoming.partition(b'\n')
            peer.incoming = bytearray(remainder)
            if len(line) > MAX_LINE:
                self._reject(peer, 'Слишком большое сообщение.')
                return
            try:
                self._message(peer, json.loads(line.decode('utf-8')))
            except (ValueError, UnicodeDecodeError, TypeError, KeyError, OverflowError):
                self._reject(peer, 'Не удалось прочитать сообщение.')
                return
            if peer.close_after_write or peer.sock not in self._peers:
                return
        if len(peer.incoming) > MAX_LINE:
            self._reject(peer, 'Слишком большое сообщение.')

    def _write(self, peer: _Peer) -> None:
        try:
            sent = peer.sock.send(peer.outgoing)
            del peer.outgoing[:sent]
        except (BlockingIOError, InterruptedError):
            return
        except OSError:
            self._close(peer)
            return
        if not peer.outgoing and peer.close_after_write:
            self._close(peer)
        else:
            self._watch(peer)

    def _run(self) -> None:
        last_step = last_snapshot = time.monotonic()
        try:
            while not self._stop.is_set():
                for key, mask in self._selector.select(timeout=.04):
                    if key.data is None:
                        try:
                            sock, addr = self._listener.accept()
                            sock.setblocking(False)
                            if len(self._peers) >= MAX_PLAYERS + 8:
                                sock.close()
                                continue
                            peer = _Peer(sock, addr)
                            self._peers[sock] = peer
                            self._selector.register(sock, selectors.EVENT_READ, peer)
                        except (BlockingIOError, OSError):
                            pass
                    else:
                        peer = key.data
                        if mask & selectors.EVENT_READ:
                            self._read(peer)
                        if peer.sock in self._peers and mask & selectors.EVENT_WRITE:
                            self._write(peer)
                now = time.monotonic()
                dt = min(1.0, max(0.0, now - last_step))
                last_step = now
                for peer in list(self._peers.values()):
                    if not peer.player and now - peer.joined_at > 10:
                        self._close(peer)
                if self.phase == 'playing' and self.shift:
                    for event in self.shift.tick(dt):
                        self._broadcast({'type': 'event', 'ok': event.ok,
                                         'message': event.message, 'sound': event.sound})
                    if self.shift.finished:
                        self.phase = 'summary'
                        self._save()
                        self._broadcast(self._snapshot())
                if now - last_snapshot >= SNAPSHOT_INTERVAL:
                    self._broadcast(self._snapshot())
                    last_snapshot = now
        finally:
            for peer in list(self._peers.values()):
                self._close(peer)
            try:
                self._selector.unregister(self._listener)
            except (KeyError, ValueError, OSError):
                pass
            self._listener.close()
            self._selector.close()


class CoopClient:
    """Non-blocking client; all UI-facing events are delivered via poll()."""
    def __init__(self, host: str, port: int, name: str, code: str, host_token: str = ''):
        self.host, self.port = host, int(port)
        self._stop = threading.Event()
        self._send_queue: queue.Queue[bytes] = queue.Queue(maxsize=256)
        self._events: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=256)
        self._socket: socket.socket | None = None
        self._initial = _encode({'type': 'join', 'protocol': PROTOCOL_VERSION,
                                 'name': _text(name, 18), 'code': code, 'host_token': host_token})
        self._thread = threading.Thread(target=self._run, name='burger-coop-client', daemon=True)
        self._thread.start()

    def send(self, message: dict[str, Any]) -> bool:
        try:
            data = _encode(message)
            if len(data) > MAX_LINE:
                return False
            self._send_queue.put_nowait(data)
            return True
        except (queue.Full, TypeError, ValueError):
            return False

    def poll(self) -> list[dict[str, Any]]:
        events = []
        while True:
            try:
                events.append(self._events.get_nowait())
            except queue.Empty:
                return events

    def close(self) -> None:
        self._stop.set()
        if self._socket:
            try:
                self._socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        if threading.current_thread() is not self._thread:
            self._thread.join(timeout=1.0)

    def _event(self, message: dict[str, Any]) -> None:
        try:
            self._events.put_nowait(message)
        except queue.Full:
            # A paused/slow renderer may miss old snapshots, never grow unbounded.
            try:
                self._events.get_nowait()
                self._events.put_nowait(message)
            except (queue.Empty, queue.Full):
                pass

    def _run(self) -> None:
        import select
        sock = None
        incoming = bytearray()
        outgoing = bytearray(self._initial)
        error = ''
        try:
            sock = socket.create_connection((self.host, self.port), timeout=5.0)
            self._socket = sock
            sock.setblocking(False)
            while not self._stop.is_set():
                while len(outgoing) < MAX_BUFFER:
                    try:
                        outgoing.extend(self._send_queue.get_nowait())
                    except queue.Empty:
                        break
                readable, writable, _ = select.select([sock], [sock] if outgoing else [], [], .05)
                if writable:
                    try:
                        sent = sock.send(outgoing)
                        del outgoing[:sent]
                    except (BlockingIOError, InterruptedError):
                        pass
                if readable:
                    try:
                        data = sock.recv(65536)
                    except (BlockingIOError, InterruptedError):
                        continue
                    if not data:
                        error = 'Соединение с хостом закрыто.'
                        break
                    incoming.extend(data)
                    while b'\n' in incoming:
                        line, _, rest = incoming.partition(b'\n')
                        incoming = bytearray(rest)
                        if len(line) > MAX_BUFFER:
                            raise ValueError('packet too large')
                        message = json.loads(line.decode('utf-8'))
                        if isinstance(message, dict) and isinstance(message.get('type'), str):
                            self._event(message)
                    if len(incoming) > MAX_BUFFER:
                        raise ValueError('packet too large')
        except (OSError, ValueError, UnicodeDecodeError, TypeError) as exc:
            error = f'Не удалось подключиться: {exc}'
        finally:
            if sock:
                try:
                    sock.close()
                except OSError:
                    pass
            self._socket = None
            if not self._stop.is_set():
                self._event({'type': 'disconnected', 'message': error or 'Соединение закрыто.'})
