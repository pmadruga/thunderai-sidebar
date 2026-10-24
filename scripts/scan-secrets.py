#!/usr/bin/env python3
"""Run Gitleaks against reachable history and intended worktree files, redacted."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--binary', required=True, type=Path)
args = parser.parse_args()
failed = False
with tempfile.TemporaryDirectory(prefix='thunderai-secret-scan-') as temp:
    temp = Path(temp)
    snapshot = temp / 'worktree'
    snapshot.mkdir()
    names = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=ROOT).decode().split('\0')
    for name in set(names):
        if not name:
            continue
        source = ROOT / name
        if source.is_symlink():
            raise SystemExit(f'Refusing to scan a symlink as a publication file: {name}')
        if source.is_file():
            target = snapshot / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
    for scope, command in [('history', ['git', '--log-opts=--all', str(ROOT)]), ('worktree', ['dir', str(snapshot)])]:
        report = temp / f'{scope}.json'
        result = subprocess.run([str(args.binary.resolve()), *command, '--redact=100', '--no-banner', '--no-color', '--ignore-gitleaks-allow', '--report-format=json', '--report-path', str(report), '--log-level=error'], cwd=ROOT, capture_output=True)
        if result.returncode not in (0, 1):
            raise SystemExit(f'Gitleaks {scope} scan failed to run (exit {result.returncode}); diagnostic output withheld to avoid leaking content.')
        findings = json.loads(report.read_text()) if report.exists() else []
        print(f'{scope}: {len(findings)} findings')
        for finding in findings:
            # Never print Match, Secret, author identity, or commit message.
            print(json.dumps({key: finding.get(key) for key in ['RuleID', 'File', 'StartLine', 'Commit']}))
        failed |= bool(findings) or result.returncode != 0
raise SystemExit(1 if failed else 0)
