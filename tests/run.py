"""Run with a LuaJIT-enabled lupa wheel: python -m pip install -r tests/requirements.txt."""
from pathlib import Path
import os
from lupa.luajit21 import LuaRuntime

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)

core = LuaRuntime(unpack_returned_tuples=True)
core.globals().ZEWS_TEST = True
core.execute(Path('tests/core.lua').read_text(encoding='utf-8'))

runtime_test = Path('tests/runtime.lua').read_text(encoding='utf-8')
scenarios = []
for signature in (0x53EC8B55, 0x16197BE9, 0x12345678):
    for font_present in (False, True):
        for legacy in (False, True):
            scenarios.append(dict(TEST_SIGNATURE=signature, TEST_FONT_PRESENT=font_present,
                                  TEST_LEGACY_MIMGUI=legacy))
# Missing optional font/color helpers must not break the main window or HUD.
scenarios.extend([
    dict(TEST_FONT_PRESENT=True, TEST_LEGACY_MIMGUI=True, TEST_MINIMAL_MIMGUI=True),
    dict(TEST_FONT_PRESENT=True, TEST_LEGACY_MIMGUI=True, TEST_FONT_ERROR=True),
    dict(TEST_REQUIRE_ERROR=True),
])
for scenario in scenarios:
    runtime = LuaRuntime(unpack_returned_tuples=True)
    for key, value in scenario.items():
        runtime.globals()[key] = value
    runtime.execute(runtime_test)
print(f'All LuaJIT core checks and {len(scenarios)} mocked-runtime scenarios passed.', flush=True)
