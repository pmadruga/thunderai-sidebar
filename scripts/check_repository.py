#!/usr/bin/env python3
"""Check package inventory, manifest/schema structure, JSON, JS and vendors."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from build_release import ROOT, package_files


def check():
    files = package_files(ROOT)
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    assert manifest['name'] == 'ThunderAI Side Panel'
    assert manifest['browser_specific_settings']['gecko']['id'] == 'thunderai-sidebar@pedromadruga.com'
    assert manifest['manifest_version'] == 2
    assert re.fullmatch(r'\d+\.\d+\.\d+', manifest['version'])
    assert manifest['homepage_url'] == 'https://github.com/pmadruga/thunderai-sidebar'
    for path in ROOT.glob('_locales/*/messages.json'):
        data = json.loads(path.read_text())
        assert isinstance(data, dict), path
        assert all(isinstance(item, dict) and isinstance(item.get('message'), str) for item in data.values()), path
    for name, api in manifest.get('experiment_apis', {}).items():
        assert api['schema'] in files and api['parent']['script'] in files
        schemas = json.loads((ROOT / api['schema']).read_text())
        assert isinstance(schemas, list) and schemas
        assert any(schema['namespace'] == name for schema in schemas)
        for schema in schemas:
            functions = schema.get('functions', [])
            assert len({function['name'] for function in functions}) == len(functions)
            for function in functions:
                assert function['type'] == 'function'
                assert isinstance(function.get('parameters', []), list)
                for parameter in function.get('parameters', []):
                    assert isinstance(parameter['name'], str)
                    assert 'type' in parameter or '$ref' in parameter
    for path in files:
        if path.endswith(('.js', '.mjs')):
            subprocess.run(['node', '--check', str(ROOT / path)], check=True, capture_output=True)
    inventory = json.loads((ROOT / 'config/vendor-lock.json').read_text())
    for entry in inventory:
        for key in ['file', 'version', 'source', 'license', 'license_file', 'sha256']:
            assert entry.get(key), (entry.get('file'), key)
        assert hashlib.sha256((ROOT / entry['file']).read_bytes()).hexdigest() == entry['sha256'], entry['file']
        assert entry['license_file'] in files, entry['license_file']
    publication_files = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files', '--cached', '--others', '--exclude-standard'], text=True).splitlines()
    runtime_roots = {'api_webchat', 'experiments', 'js', 'options', 'pages', 'popup'}
    for name in publication_files:
        if name.split('/')[0] in runtime_roots and name.endswith(('.js', '.mjs')) and (ROOT / name).is_file():
            assert name in files, f'Runtime module missing from config/release-files.txt: {name}'
    tracked = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files'], text=True).splitlines()
    assert not any(path.startswith(('backup/', 'dist/')) or path.endswith(('.eml', '.xpi')) for path in tracked)
    print(f'Validated {len(files)} package paths, manifest/experiment structure, locale JSON, JavaScript syntax, and vendor hashes.')


if __name__ == '__main__':
    try:
        check()
    except (AssertionError, ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f'Repository check failed: {error}', file=sys.stderr)
        sys.exit(1)
