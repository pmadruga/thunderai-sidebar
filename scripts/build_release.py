#!/usr/bin/env python3
"""Build deterministic XPIs from an explicit reviewed file inventory."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()


def package_files(root):
    locales = {line.strip() for line in (root / 'LANG.md').read_text().splitlines() if line.strip()}
    names = []
    for line in (root / 'release-files.txt').read_text().splitlines():
        name = line.strip()
        if not name or name.startswith('#'):
            continue
        path = PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or '\\' in name or name in names:
            raise ValueError(f'Invalid or duplicate package path: {name}')
        if path.parts[0] == '_locales' and (len(path.parts) < 3 or path.parts[1] not in locales):
            raise ValueError(f'Locale is not approved in LANG.md: {name}')
        source = root / name
        if not source.is_file() or any(p.is_symlink() for p in [source, *source.parents] if p != root.parent):
            raise ValueError(f'Package source is missing or is a symlink: {name}')
        source.resolve().relative_to(root.resolve())
        names.append(name)
    required = {'manifest.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', '_locales/en/messages.json'}
    if not required.issubset(names):
        raise ValueError('Package inventory is missing required manifest, policy, or license files')
    for locale in locales:
        if f'_locales/{locale}/messages.json' not in names:
            raise ValueError(f'Approved locale missing from inventory: {locale}')
    return sorted(names)


def build(root, output=None, release=False):
    root = Path(root).resolve()
    manifest = json.loads((root / 'manifest.json').read_text())
    version = manifest['version']
    names = package_files(root)
    if release:
        if git(root, 'status', '--porcelain', '--untracked-files=all'):
            raise ValueError('Release build requires a clean committed working tree')
        tags = git(root, 'tag', '--points-at', 'HEAD').splitlines()
        if f'v{version}' not in tags:
            raise ValueError(f'Release build requires tag v{version} at HEAD')
        tracked = set(git(root, 'ls-files').splitlines())
        missing = set(names) - tracked
        if missing:
            raise ValueError(f'Untracked files in release inventory: {sorted(missing)}')
    target = Path(output) if output else root / 'dist' / f'thunderai-side-panel-{version}.xpi'
    target.parent.mkdir(parents=True, exist_ok=True)
    # ZIP_STORED avoids differences between zlib versions across build machines.
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name in names:
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, (root / name).read_bytes())
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix(target.suffix + '.sha256').write_text(f'{digest}  {target.name}\n')
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', action='store_true', help='require a clean version-tagged commit')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        target = build(ROOT, args.output, args.release)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Build failed: {error}\n')
    print(f'Built {target} ({"release" if args.release else "development"}); SHA-256 sidecar written')
