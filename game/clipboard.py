"""Small clipboard adapter for sharing room invitations without another app."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys


class ClipboardError(RuntimeError):
    pass


def _windows(action: str, value: str = '') -> str:
    import ctypes
    from ctypes import wintypes

    user = ctypes.WinDLL('user32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    user.OpenClipboard.argtypes = [wintypes.HWND]
    user.OpenClipboard.restype = wintypes.BOOL
    user.CloseClipboard.restype = wintypes.BOOL
    user.EmptyClipboard.restype = wintypes.BOOL
    user.GetClipboardData.argtypes = [wintypes.UINT]
    user.GetClipboardData.restype = wintypes.HANDLE
    user.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
    user.SetClipboardData.restype = wintypes.HANDLE
    kernel.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    kernel.GlobalAlloc.restype = wintypes.HANDLE
    kernel.GlobalLock.argtypes = [wintypes.HANDLE]
    kernel.GlobalLock.restype = ctypes.c_void_p
    kernel.GlobalSize.argtypes = [wintypes.HANDLE]
    kernel.GlobalSize.restype = ctypes.c_size_t
    kernel.GlobalUnlock.argtypes = [wintypes.HANDLE]
    kernel.GlobalFree.argtypes = [wintypes.HANDLE]
    kernel.GlobalFree.restype = wintypes.HANDLE

    if not user.OpenClipboard(None):
        raise ClipboardError('Буфер обмена занят')
    handle = None
    try:
        if action == 'read':
            handle = user.GetClipboardData(13)  # CF_UNICODETEXT
            if not handle:
                raise ClipboardError('В буфере нет текста')
            pointer = kernel.GlobalLock(handle)
            if not pointer:
                raise ClipboardError('Не удалось прочитать буфер обмена')
            try:
                count = min(1025, kernel.GlobalSize(handle) // ctypes.sizeof(ctypes.c_wchar))
                return ctypes.wstring_at(pointer, count).split('\0', 1)[0][:1024]
            finally:
                kernel.GlobalUnlock(handle)
        data = (value + '\0').encode('utf-16-le')
        handle = kernel.GlobalAlloc(2, len(data))  # GMEM_MOVEABLE
        if not handle:
            raise ClipboardError('Не удалось выделить память')
        pointer = kernel.GlobalLock(handle)
        if not pointer:
            raise ClipboardError('Не удалось записать в буфер обмена')
        ctypes.memmove(pointer, data, len(data))
        kernel.GlobalUnlock(handle)
        if not user.EmptyClipboard() or not user.SetClipboardData(13, handle):
            raise ClipboardError('Не удалось записать в буфер обмена')
        handle = None  # Ownership transfers to Windows after SetClipboardData.
        return ''
    finally:
        if action == 'write' and handle:
            kernel.GlobalFree(handle)
        user.CloseClipboard()


def _command(action: str, value: str = '') -> str:
    if sys.platform == 'darwin':
        command = ['pbpaste'] if action == 'read' else ['pbcopy']
    elif os.environ.get('WAYLAND_DISPLAY') and shutil.which('wl-paste') and shutil.which('wl-copy'):
        command = ['wl-paste', '--no-newline'] if action == 'read' else ['wl-copy']
    elif shutil.which('xclip'):
        command = ['xclip', '-selection', 'clipboard', '-o' if action == 'read' else '-i']
    elif shutil.which('xsel'):
        command = ['xsel', '--clipboard', '--output' if action == 'read' else '--input']
    else:
        raise ClipboardError('Буфер обмена недоступен')
    try:
        result = subprocess.run(command, input=value if action == 'write' else None,
                                capture_output=True, text=True, timeout=2, check=True)
        return result.stdout[:1024]
    except (OSError, subprocess.SubprocessError) as exc:
        raise ClipboardError('Буфер обмена недоступен') from exc


def get_text() -> str:
    return _windows('read') if os.name == 'nt' else _command('read')


def set_text(value: str) -> None:
    if not isinstance(value, str) or len(value) > 1024:
        raise ClipboardError('Слишком длинный текст')
    if os.name == 'nt':
        _windows('write', value)
    else:
        _command('write', value)
