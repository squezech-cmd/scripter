"""Cross-platform Panda3D distribution; Windows builds are created on Linux too."""
import os
from setuptools import setup

platforms = [p for p in os.environ.get('BURGER_BUILD_PLATFORMS', 'win_amd64').split(',') if p]
setup(
    name='burger-shift-diner',
    version='0.2.0',
    options={
        'build_apps': {
            'gui_apps': {'BurgerShiftGame': 'main.py'},
            'platforms': platforms,
            'plugins': ['pandagl', 'p3tinydisplay', 'p3openal_audio'],
            'include_patterns': ['assets/**/*.png', 'assets/**/*.wav', 'assets/**/*.ttf',
                                 'assets/**/*.bam', 'assets/fonts/LICENSE*', 'assets/licenses/*.txt'],
            'use_optimized_wheels': False,
            'pypi_extra_indexes': [],
            'log_filename': '$USER_APPDATA/BurgerShiftDiner/game.log',
            'log_append': False,
        },
    },
)
