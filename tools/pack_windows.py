"""Wrap Panda3D's Windows build in one self-extracting, auto-starting EXE.

Downloads pinned public-domain 7-Zip tools and a hash-verified Cloudflare
connector. The connector is only launched if the player selects internet co-op.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
from urllib.request import urlopen, Request

ROOT = Path(__file__).resolve().parents[1]
SFX_URL = 'https://api.github.com/repos/sammtcbn/sfx_builder/contents/7zSD.sfx?ref=master'
SFX_SHA256 = 'e228a2be6f84651b86e60d8d9b674a41315301d8e3dde9e22d3481cb4eb6fe3f'
SEVEN_URL = 'https://registry.npmjs.org/7zip-bin/-/7zip-bin-5.2.0.tgz'
SEVEN_SHA256 = '04f9738ee00be8be53f5d06254a9e6e4b5117b17f8b74058477d870e62764a7d'
CLOUDFLARED_URL = 'https://registry.npmjs.org/@botharness/cloudflared-win32-x64/-/cloudflared-win32-x64-1.7.0.tgz'
CLOUDFLARED_ARCHIVE_SHA256 = 'c06ba96daae04319a1b685a9b8ee2d9265e6210d8830b0c39a0a2a1b56e1b288'
# The executable hash is also published by the official Cloudflare 2026.10.6 release.
CLOUDFLARED_SHA256 = 'd521b3bf68982165f0d06d76732f22d9a105ef057ff3ae4c0986f3a23190950f'


def download(url: str) -> bytes:
    req = Request(url, headers={'User-Agent': 'BurgerShiftDiner-build/1.0'})
    with urlopen(req, timeout=120) as response:
        return response.read()


def checked(data: bytes, expected: str, what: str) -> bytes:
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected:
        raise RuntimeError(f'{what} failed SHA-256 verification: {actual}')
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT/'build'/'win_amd64')
    parser.add_argument('--output', type=Path, default=ROOT/'BurgerShift.exe')
    parser.add_argument('--sevenzip', type=Path, help='use a locally installed 7z/7za executable')
    parser.add_argument('--sfx', type=Path, help='use a locally downloaded matching 7zSD.sfx')
    parser.add_argument('--cloudflared', type=Path, help='use a local, hash-matching Cloudflare connector')
    args=parser.parse_args()
    source=args.source.resolve(); output=args.output.resolve()
    if not (source/'BurgerShiftGame.exe').is_file():
        raise SystemExit('Windows build missing. First run: python setup.py build_apps')
    with tempfile.TemporaryDirectory(prefix='burger-build-') as temp:
        temp=Path(temp)
        if args.sfx:
            sfx=checked(args.sfx.read_bytes(),SFX_SHA256,'SFX module')
        else:
            api=json.loads(download(SFX_URL))
            sfx=checked(base64.b64decode(api['content']),SFX_SHA256,'SFX module')
        if args.sevenzip:
            seven=str(args.sevenzip.resolve())
        elif shutil.which('7za') or shutil.which('7z'):
            seven=shutil.which('7za') or shutil.which('7z')
        else:
            archive=checked(download(SEVEN_URL),SEVEN_SHA256,'7zip-bin archive')
            if os.name=='nt': member='package/win/x64/7za.exe'
            elif sys_platform()=='linux': member='package/linux/x64/7za'
            elif sys_platform()=='darwin': member='package/mac/x64/7za'
            else: raise SystemExit('Supply a 7-Zip executable with --sevenzip on this platform.')
            with tarfile.open(fileobj=io.BytesIO(archive),mode='r:gz') as tar:
                f=tar.extractfile(member)
                if f is None: raise RuntimeError('7za executable missing from archive')
                binary=temp/Path(member).name
                binary.write_bytes(f.read()); binary.chmod(0o755)
                seven=str(binary)
        if args.cloudflared:
            connector = checked(args.cloudflared.read_bytes(), CLOUDFLARED_SHA256, 'cloudflared')
        else:
            archive = checked(download(CLOUDFLARED_URL), CLOUDFLARED_ARCHIVE_SHA256, 'cloudflared archive')
            with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as tar:
                member = tar.extractfile('package/bin/cloudflared.exe')
                if member is None: raise RuntimeError('cloudflared executable missing from archive')
                connector = checked(member.read(), CLOUDFLARED_SHA256, 'cloudflared')
        (temp/'cloudflared.exe').write_bytes(connector)
        package=temp/'payload.7z'
        subprocess.run([seven,'a','-t7z','-mx=7','-mmt=2',str(package),'*'],cwd=source,check=True)
        subprocess.run([seven,'a','-t7z','-mx=7','-mmt=2',str(package),'cloudflared.exe'],cwd=temp,check=True)
        config=(
            ';!@Install@!UTF-8!\n'
            'Title="Burger Shift: Diner Edition"\n'
            'Progress="yes"\n'
            'RunProgram="BurgerShiftGame.exe"\n'
            ';!@InstallEnd@!\n'
        ).encode('utf-8')
        output.parent.mkdir(parents=True,exist_ok=True)
        with output.open('wb') as f:
            f.write(sfx); f.write(config)
            with package.open('rb') as payload: shutil.copyfileobj(payload,f)
        print(f'Created {output} ({output.stat().st_size / 1024 / 1024:.1f} MiB)')


def sys_platform():
    import sys
    return sys.platform


if __name__=='__main__': main()
