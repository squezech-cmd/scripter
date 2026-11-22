"""Run a real Panda3D game session without a window or audio device."""
import os
from pathlib import Path
import subprocess
import sys


def test_offscreen_shift_and_ui(tmp_path):
    root = Path(__file__).resolve().parents[1]
    env = os.environ.copy()
    # The game must never touch a developer's actual career while testing.
    env.update(XDG_DATA_HOME=str(tmp_path), APPDATA=str(tmp_path))
    result = subprocess.run(
        [sys.executable, str(root / 'tests' / 'integration_scenario.py'), '--offscreen'],
        cwd=root, env=env, text=True, capture_output=True, timeout=60,
    )
    assert result.returncode == 0, result.stdout + '\n' + result.stderr
    assert 'OFFSCREEN INTEGRATION OK' in result.stdout


def test_offscreen_coop_ui_and_real_tcp(tmp_path):
    root = Path(__file__).resolve().parents[1]
    env = os.environ.copy()
    env.update(XDG_DATA_HOME=str(tmp_path), APPDATA=str(tmp_path))
    result = subprocess.run(
        [sys.executable, str(root / 'tests' / 'coop_ui_scenario.py'), '--offscreen'],
        cwd=root, env=env, text=True, capture_output=True, timeout=60,
    )
    assert result.returncode == 0, result.stdout + '\n' + result.stderr
    assert 'COOP UI INTEGRATION OK' in result.stdout
