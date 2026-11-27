"""Run with a LuaJIT-enabled lupa wheel: python -m pip install -r tests/requirements.txt."""
from pathlib import Path
import os
from lupa.luajit21 import LuaRuntime

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)

core = LuaRuntime(unpack_returned_tuples=True)
core.globals().ZEWS_TEST = True
core.execute(Path('tests/core.lua').read_text(encoding='utf-8'))

for signature in (0x53EC8B55, 0x16197BE9, 0x12345678):
    for font_present in (False, True):
        runtime = LuaRuntime(unpack_returned_tuples=True)
        runtime.globals().TEST_SIGNATURE = signature
        runtime.globals().TEST_FONT_PRESENT = font_present
        runtime.execute(Path('tests/runtime.lua').read_text(encoding='utf-8'))
print('All LuaJIT core and mocked-runtime checks passed.')
