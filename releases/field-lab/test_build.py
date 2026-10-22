import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('release_build', Path(__file__).with_name('build.py'))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'source'
        self.out = Path(self.tmp.name) / 'release'
        for folder in build.SCOPES:
            (self.root / folder).mkdir(parents=True, exist_ok=True)
        (self.root / build.PHONE).mkdir(parents=True, exist_ok=True)
        for name in build.REQUIRED:
            (self.root / build.PHONE / name).write_text('// canonical module\n', encoding='utf-8')
        (self.root / build.PHONE / 'index.html').write_text('<!doctype html><html><head><title>Vivo World · Local field</title></head><body><script type="module" src="./static-shared.js"></script><script type="module" src="./bootstrap.mjs"></script><script type="module" src="./companion.mjs"></script></body></html>', encoding='utf-8')
        (self.root / 'services/vivo/web/vivo-sw.js').write_text("const SHELL_CACHE = 'old';\nconst SHELL = ['phone/index.html'];\n", encoding='utf-8')

    def run_build(self):
        return build.assemble(self.root, self.out, 'a' * 40)

    def test_actual_markup_and_imports_retained(self):
        m = self.run_build()
        alias = (self.out / m['entry']).read_text()
        self.assertIn('./bootstrap.mjs', alias)
        self.assertIn('Unified 2026.10.22', alias)
        self.assertNotIn('<iframe', alias)
        self.assertFalse(m['requiresOriginalHtml'])

    def test_canonical_entry_and_engine_unchanged(self):
        self.run_build()
        for name in build.REQUIRED:
            self.assertEqual((self.root / build.PHONE / name).read_bytes(), (self.out / build.PHONE / name).read_bytes())

    def test_manifest_matches_every_copied_or_generated_runtime_file(self):
        m = self.run_build()
        for name, data in m['files'].items():
            raw = (self.out / name).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), data['sha256'])
            self.assertEqual(len(raw), data['bytes'])
        sw = m['files']['services/vivo/web/vivo-sw.js']
        self.assertIn('sourceSha256', sw)
        self.assertEqual(sw['provenance'], 'release-assembly')

    def test_offline_alias_is_cached_with_unique_release_shell(self):
        self.run_build()
        sw = (self.out / 'services/vivo/web/vivo-sw.js').read_text()
        self.assertIn("'phone/field-lab-unified.html'", sw)
        self.assertIn('vivo-phone-shell-unified-aaaaaaaaaaaa', sw)
        self.assertIn("'phone/index.html'", sw)

    def test_existing_output_is_not_overwritten(self):
        self.out.mkdir()
        with self.assertRaises(FileExistsError): self.run_build()

    def test_source_output_overlap_refused(self):
        with self.assertRaises(ValueError): build.assemble(self.root, self.root / 'dist', 'a' * 40)

    def test_missing_module_fails_before_creating_output(self):
        (self.root / build.PHONE / 'engine.mjs').unlink()
        with self.assertRaises(FileNotFoundError): self.run_build()
        self.assertFalse(self.out.exists())

    def test_symlink_refused(self):
        (self.root / build.PHONE / 'escape').symlink_to('/tmp')
        with self.assertRaises(ValueError): self.run_build()

    def test_fonts_env_and_private_keys_not_packaged(self):
        for name in ['private.env', '.env.local', 'font.woff2', 'private.key']:
            (self.root / build.PHONE / name).write_text('not exported')
        m = self.run_build()
        for name in ['.env.local', 'font.woff2', 'private.key']:
            self.assertFalse((self.out / build.PHONE / name).exists())
            self.assertIn((build.PHONE / name).as_posix(), m['excluded'])

    def test_legacy_launcher_refused(self):
        p = self.root / build.PHONE / 'index.html'
        p.write_text(p.read_text() + 'Choose original Field Lab')
        with self.assertRaises(ValueError): self.run_build()

    def test_cli_retains_full_dotted_release_name(self):
        output = self.out.with_name('release.2026.10.22')
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('build.py')),
            '--source', str(self.root), '--out', str(output), '--commit', 'a' * 40],
            capture_output=True, text=True, check=True)
        archive = Path(json.loads(result.stdout)['archive'])
        self.assertEqual(archive.name, 'release.2026.10.22.zip')
        self.assertTrue(archive.is_file())

if __name__ == '__main__': unittest.main()
