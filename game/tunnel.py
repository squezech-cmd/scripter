"""Optional, outbound-only internet co-op through Cloudflare Quick Tunnels.

The local gateway accepts WebSockets on loopback only and forwards them to the
host's existing TCP authority. The shareable URL contains a long random path
and the ordinary room code. The tunnel is opt-in, temporary, and depends on a
third-party service; Cloudflare can see traffic. It is not an official server.
"""
from __future__ import annotations

from collections import deque
from http import HTTPStatus
import hmac
import os
from pathlib import Path
import queue
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit

from websockets.exceptions import ConnectionClosed
from websockets.sync.server import serve

from .net import MAX_BUFFER, MAX_PLAYERS

TOKEN_RE = re.compile(r'^[A-Za-z0-9_-]{24,64}$')
HOST_RE = re.compile(r'^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com$')
URL_RE = re.compile(r'https://([a-z0-9-]+\.trycloudflare\.com)\b', re.I)


def new_token() -> str:
    return secrets.token_urlsafe(24)


def invitation(base_url: str, token: str, code: str) -> str:
    parts = urlsplit(base_url)
    if (parts.scheme != 'https' or not parts.hostname or not HOST_RE.fullmatch(parts.hostname)
            or parts.username or parts.password or parts.port not in (None, 443)
            or parts.path not in ('', '/') or parts.query or parts.fragment):
        raise ValueError('invalid tunnel address')
    if not TOKEN_RE.fullmatch(token) or not (len(code) == 6 and code.isascii() and code.isdigit()):
        raise ValueError('invalid invitation')
    # The code is a URL fragment, so it is not included in the WebSocket request.
    return f'https://{parts.hostname}/burger/{token}#{code}'


def parse_invitation(value: str) -> tuple[str, str]:
    """Validate an invitation, returning the secure WebSocket URL and room code."""
    if not isinstance(value, str) or len(value) > 256:
        raise ValueError('invalid invitation')
    parts = urlsplit(value.strip())
    try:
        port = parts.port
    except ValueError as exc:
        raise ValueError('invalid invitation') from exc
    if (parts.scheme.lower() != 'https' or not parts.hostname or
            not HOST_RE.fullmatch(parts.hostname) or parts.username or parts.password or
            port not in (None, 443) or parts.query):
        raise ValueError('invalid invitation')
    path = parts.path.split('/')
    if (len(path) != 3 or path[1] != 'burger' or not TOKEN_RE.fullmatch(path[2]) or
            not (len(parts.fragment) == 6 and parts.fragment.isascii() and parts.fragment.isdigit())):
        raise ValueError('invalid invitation')
    return f'wss://{parts.hostname}/burger/{path[2]}', parts.fragment


class WebSocketGateway:
    """A bounded WS-to-TCP bridge, exposed only on 127.0.0.1."""
    def __init__(self, game_port: int, token: str):
        if not TOKEN_RE.fullmatch(token):
            raise ValueError('invalid gateway token')
        self.game_port = int(game_port)
        self.path = '/burger/' + token
        self._stop = threading.Event()
        self._slots = threading.BoundedSemaphore(MAX_PLAYERS + 8)
        self._sockets: set[socket.socket] = set()
        self._lock = threading.Lock()
        self._server = serve(self._handle, '127.0.0.1', 0,
                             process_request=self._authorize, compression=None,
                             max_size=MAX_BUFFER, close_timeout=1)
        self.port = self._server.socket.getsockname()[1]
        self._thread = threading.Thread(target=self._server.serve_forever,
                                        name='burger-ws-gateway', daemon=True)
        self._thread.start()

    def _authorize(self, connection, request):
        if not hmac.compare_digest(request.path, self.path):
            return connection.respond(HTTPStatus.NOT_FOUND, 'Not found\n')
        return None

    def _handle(self, ws):
        if self._stop.is_set() or not self._slots.acquire(blocking=False):
            ws.close(1013, 'Room busy')
            return
        upstream = None
        try:
            upstream = socket.create_connection(('127.0.0.1', self.game_port), timeout=3)
            upstream.settimeout(.5)
            with self._lock:
                self._sockets.add(upstream)

            def to_websocket():
                try:
                    while not self._stop.is_set():
                        try:
                            data = upstream.recv(16384)
                        except socket.timeout:
                            continue
                        if not data:
                            break
                        ws.send(data)
                except (OSError, ConnectionClosed):
                    pass
                finally:
                    try:
                        ws.close()
                    except (OSError, ConnectionClosed):
                        pass

            reader = threading.Thread(target=to_websocket, name='burger-ws-upstream', daemon=True)
            reader.start()
            try:
                while not self._stop.is_set():
                    try:
                        data = ws.recv(timeout=.5)
                    except TimeoutError:
                        continue
                    if not isinstance(data, bytes):
                        ws.close(1003, 'Binary messages only')
                        break
                    upstream.sendall(data)
            except (OSError, ConnectionClosed):
                pass
            finally:
                try:
                    upstream.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                reader.join(timeout=1)
        except (OSError, ConnectionClosed):
            pass
        finally:
            if upstream:
                with self._lock:
                    self._sockets.discard(upstream)
                upstream.close()
            self._slots.release()

    def stop(self):
        if self._stop.is_set():
            return
        self._stop.set()
        self._server.shutdown()
        with self._lock:
            sockets = list(self._sockets)
        for sock in sockets:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        self._thread.join(timeout=1)


def cloudflared_path() -> str | None:
    """Locate the pinned binary in the packaged app, or one installed by a developer."""
    override = os.environ.get('BURGER_CLOUDFLARED')
    if override:
        return override if Path(override).is_file() else None
    name = 'cloudflared.exe' if os.name == 'nt' else 'cloudflared'
    choices = [Path(sys.executable).resolve().parent / name,
               Path(__file__).resolve().parents[1] / name]
    for path in choices:
        if path.is_file():
            return str(path)
    return shutil.which(name)


class QuickTunnel:
    """Manage one cloudflared process without blocking the game/UI thread."""
    START_TIMEOUT = 60.0

    def __init__(self, local_port: int, executable: str | None = None):
        self.executable = executable or cloudflared_path()
        if not self.executable:
            raise FileNotFoundError('cloudflared не найден')
        self.local_port = int(local_port)
        self.started = time.monotonic()
        self._events: queue.SimpleQueue[dict] = queue.SimpleQueue()
        self._stop = threading.Event()
        self._process: subprocess.Popen | None = None
        self._thread = threading.Thread(target=self._run, name='burger-quick-tunnel', daemon=True)
        self._thread.start()

    def poll(self) -> list[dict]:
        events = []
        while True:
            try:
                events.append(self._events.get_nowait())
            except queue.Empty:
                return events

    def _run(self):
        announced = False
        recent_lines = deque(maxlen=5)
        try:
            # Do not consume a user's existing Cloudflare configuration or token.
            with tempfile.TemporaryDirectory(prefix='burger-tunnel-') as temp:
                config = Path(temp) / 'empty.yml'
                config.write_text('{}\n', encoding='utf-8')
                env = {k: v for k, v in os.environ.items()
                       if not k.startswith(('TUNNEL_', 'CF_TUNNEL_'))}
                command = [self.executable, 'tunnel', '--config', str(config),
                           '--no-autoupdate', '--protocol', 'http2', '--metrics', '127.0.0.1:0',
                           '--url', f'http://127.0.0.1:{self.local_port}']
                flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
                self._process = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                                 text=True, encoding='utf-8', errors='replace',
                                                 bufsize=1, env=env, creationflags=flags)
                if self._stop.is_set():
                    self._process.terminate()
                address = None
                registered = False
                assert self._process.stdout is not None
                for line in self._process.stdout:
                    # Diagnostics must not reveal the temporary invitation URL.
                    recent_lines.append(URL_RE.sub('https://[redacted]', line.strip())[:300])
                    match = URL_RE.search(line)
                    if match and HOST_RE.fullmatch(match.group(1).lower()):
                        address = 'https://' + match.group(1).lower()
                    if 'registered tunnel connection' in line.lower():
                        registered = True
                    if address and registered and not announced and not self._stop.is_set():
                        announced = True
                        self._events.put({'type': 'ready', 'url': address})
                self._process.wait()
                if not self._stop.is_set():
                    self._events.put({'type': 'closed' if announced else 'error',
                                      'detail': recent_lines[-1] if recent_lines else 'cloudflared exited'})
        except (OSError, ValueError) as exc:
            if not self._stop.is_set():
                self._events.put({'type': 'closed' if announced else 'error', 'detail': str(exc)[:300]})
        finally:
            self._process = None

    def stop(self):
        self._stop.set()
        process = self._process
        if process and process.poll() is None:
            try:
                process.terminate()
                process.wait(timeout=1)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    process.kill()
                except OSError:
                    pass
        if threading.current_thread() is not self._thread:
            self._thread.join(timeout=1)
