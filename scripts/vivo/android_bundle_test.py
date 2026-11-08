import importlib.util, json, tempfile, unittest, hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('android_bundle',Path(__file__).with_name('android_bundle.py'))
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
class BundleTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
  self.source=self.root/'services/vivo/web';self.dest=self.root/'services/vivo/android-companion/app/build/generated/vivo/assets'
  for path in m.REQUIRED:
   f=self.source/path;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(('fixture '+path).encode())
 def test_manifest_records_exact_bytes_and_original_origin(self):
  manifest=m.bundle(self.root,self.dest);self.assertEqual(len(m.REQUIRED),len(manifest['files']))
  self.assertEqual('https://carltheghost.github.io',manifest['origin'])
  for e in manifest['files']:
   data=(self.dest/'vivo'/e['path']).read_bytes();self.assertEqual(hashlib.sha256(data).hexdigest(),e['sha256'])
 def test_no_unrelated_file_or_user_directory_can_be_targeted(self):
  for dest in [self.root,self.source,self.root/'services/vivo/android-companion/app/build',self.root/'outside']:
   with self.assertRaises(ValueError):m.bundle(self.root,dest)
 def test_missing_dependency_fails_before_touching_existing_output(self):
  old=self.dest/'vivo';old.mkdir(parents=True);(old/'retained.txt').write_text('retain')
  (self.source/m.REQUIRED[0]).unlink()
  with self.assertRaises(ValueError):m.bundle(self.root,self.dest)
  self.assertEqual('retain',(old/'retained.txt').read_text())
 def test_test_and_private_hidden_directories_are_not_bundled(self):
  for path in ['tests/private.txt','.private/key.json','node_modules/a.js','phone/tests/demo.js']:
   f=self.source/path;f.parent.mkdir(parents=True,exist_ok=True);f.write_text('ignore')
  self.assertEqual(len(m.REQUIRED),len(m.bundle(self.root,self.dest)['files']))
 def test_detectable_secret_files_fail_closed(self):
  (self.source/'credentials.json').write_text('not a real credential')
  with self.assertRaises(ValueError):m.bundle(self.root,self.dest)
 def test_symlink_to_other_source_is_not_shipped(self):
  (self.source/'outside.js').symlink_to(self.source/m.REQUIRED[0])
  with self.assertRaises(ValueError):m.bundle(self.root,self.dest)
 def test_build_is_deterministic(self):
  a=m.bundle(self.root,self.dest);b=m.bundle(self.root,self.dest);self.assertEqual(a,b)
 def test_only_generated_subdirectory_is_refreshed(self):
  self.dest.mkdir(parents=True);(self.dest/'other.txt').write_text('untouched')
  m.bundle(self.root,self.dest);self.assertEqual('untouched',(self.dest/'other.txt').read_text())
if __name__=='__main__':unittest.main()
