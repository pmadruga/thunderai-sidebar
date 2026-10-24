import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('build_release', Path(__file__).resolve().parents[1] / 'scripts/build_release.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class ReleasePackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.files = ['manifest.json', 'LICENSE', 'docs/THIRD_PARTY_NOTICES.md', 'docs/PRIVACY.md', '_locales/en/messages.json']
        for name in self.files:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('content')
        (self.root / 'manifest.json').write_text(json.dumps({'version': '1.2.3'}))
        (self.root / 'config').mkdir(exist_ok=True)
        (self.root / 'config/locales.txt').write_text('en\n')
        self.inventory(self.files)

    def tearDown(self):
        self.temp.cleanup()

    def inventory(self, names):
        (self.root / 'config/release-files.txt').write_text('\n'.join(names) + '\n')

    def test_deterministic_archive_excludes_unlisted_private_files(self):
        (self.root / 'private-export.json').write_text('synthetic private data')
        first = packager.build(self.root, self.root / 'first.xpi')
        for name in self.files:
            os.utime(self.root / name, (2000000000, 2000000000))
        second = packager.build(self.root, self.root / 'second.xpi')
        self.assertEqual(first.read_bytes(), second.read_bytes())
        with zipfile.ZipFile(first) as archive:
            self.assertEqual(archive.namelist(), sorted(self.files))
            self.assertTrue(all(info.date_time == (1980, 1, 1, 0, 0, 0) for info in archive.infolist()))
        self.assertTrue(first.with_suffix('.xpi.sha256').exists())

    def test_rejects_unapproved_locale(self):
        (self.root / '_locales/xx').mkdir()
        (self.root / '_locales/xx/messages.json').write_text('{}')
        self.inventory(self.files + ['_locales/xx/messages.json'])
        with self.assertRaisesRegex(ValueError, 'not approved'):
            packager.package_files(self.root)

    def test_rejects_traversal_duplicate_and_symlink(self):
        for extra in ['../outside', 'LICENSE']:
            self.inventory(self.files + [extra])
            with self.assertRaises(ValueError):
                packager.package_files(self.root)
        link = self.root / 'linked.txt'
        link.symlink_to(self.root / 'LICENSE')
        self.inventory(self.files + ['linked.txt'])
        with self.assertRaisesRegex(ValueError, 'symlink'):
            packager.package_files(self.root)

    def test_release_requires_clean_version_tagged_commit(self):
        with patch.object(packager, 'git', return_value=' M manifest.json'):
            with self.assertRaisesRegex(ValueError, 'clean committed'):
                packager.build(self.root, release=True)
        with patch.object(packager, 'git', side_effect=['', 'v1.2.3']):
            with self.assertRaisesRegex(ValueError, 'v1.2.3'):
                packager.build(self.root, release=True)
        with patch.object(packager, 'git', side_effect=['', 'sidebar-v1.2.3', '\n'.join(self.files)]):
            self.assertTrue(packager.build(self.root, release=True).is_file())


if __name__ == '__main__':
    unittest.main()
