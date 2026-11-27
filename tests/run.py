"""Run with a LuaJIT-enabled lupa wheel: python -m pip install -r tests/requirements.txt."""
from pathlib import Path
import json
import os
import re
from lupa.luajit21 import LuaRuntime

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)

# The old mocks accidentally invented generic PushID/PushStyleVar functions.
# Check every direct call against actual generated binding exports, offline.
contract = json.loads(Path('tests/mimgui_api.json').read_text(encoding='utf-8'))
exports = set(contract['functions'] + contract['binding_helpers'] + contract['moonloader_helpers'])
source = Path('zews.lua').read_text(encoding='utf-8')
used = set(re.findall(r'imgui\.([A-Za-z0-9_]+)\s*\(', source))
assert not (used - exports), f'Calls absent from mimgui binding: {sorted(used - exports)}'
assert not re.search(r'imgui\.(?:PushID|PopID|PushStyleVar|SetDpiScalingMode)\s*\(', source)
assert 'loadOptionalFont' not in source
print(f'PASS: {len(used)} direct API calls checked against generated mimgui exports', flush=True)

core = LuaRuntime(unpack_returned_tuples=True)
core.globals().ZEWS_TEST = True
core.execute(Path('tests/core.lua').read_text(encoding='utf-8'))

runtime_test = Path('tests/runtime.lua').read_text(encoding='utf-8')
scenarios = []
for signature in (0x53EC8B55, 0x16197BE9, 0x12345678):
    for mode in ('standard', 'legacy', 'minimal'):
        scenarios.append(dict(TEST_SIGNATURE=signature,
                              TEST_LEGACY_MIMGUI=mode != 'standard',
                              TEST_MINIMAL_MIMGUI=mode == 'minimal'))
scenarios.append(dict(TEST_REQUIRE_ERROR=True))
for scenario in scenarios:
    runtime = LuaRuntime(unpack_returned_tuples=True)
    for key, value in scenario.items():
        runtime.globals()[key] = value
    runtime.execute(runtime_test)
print(f'All LuaJIT core checks and {len(scenarios)} mocked-runtime scenarios passed.', flush=True)
