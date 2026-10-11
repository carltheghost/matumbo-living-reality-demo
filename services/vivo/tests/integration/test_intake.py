import importlib.util, tempfile, unittest, zipfile, hashlib, json
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location('vivo_recover',ROOT/'scripts/vivo/recover.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
spec2=importlib.util.spec_from_file_location('vivo_ownership',ROOT/'scripts/vivo/check_ownership.py')
o=importlib.util.module_from_spec(spec2);spec2.loader.exec_module(o)
class IntakeTests(unittest.TestCase):
 def fixture(self,path,items):
  z=path/'a.zip'
  with zipfile.ZipFile(z,'w') as f:
   for name,data in items:f.writestr(name,data)
  sources={'x':('a.zip',hashlib.sha256(z.read_bytes()).hexdigest(),'prefix','services/vivo')}
  return z,sources
 def test_exact_recovery(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);z,s=self.fixture(p,[('prefix/server/a.py','print(1)')]);w=p/'work'
   with patch.dict(m.SOURCES,s,clear=True):items=m.recover(w,{'x':z});self.assertEqual(items[0]['bytes'],8);self.assertEqual((w/'services/vivo/server/a.py').read_text(),'print(1)')
 def test_idempotent_verification(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);z,s=self.fixture(p,[('prefix/a.py','x')]);w=p/'work'
   with patch.dict(m.SOURCES,s,clear=True):self.assertEqual(m.recover(w,{'x':z}),m.recover(w,{'x':z},True))
 def test_changed_file_is_not_overwritten(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);z,s=self.fixture(p,[('prefix/a.py','x')]);w=p/'work'
   with patch.dict(m.SOURCES,s,clear=True):
    m.recover(w,{'x':z});q=w/'services/vivo/a.py';q.write_text('edited')
    with self.assertRaisesRegex(ValueError,'overwrite'):m.recover(w,{'x':z})
    self.assertEqual(q.read_text(),'edited')
 def test_bad_hash_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);z,s=self.fixture(p,[('prefix/a.py','x')]);z.write_bytes(z.read_bytes()+b'bad')
   with patch.dict(m.SOURCES,s,clear=True):
    with self.assertRaisesRegex(ValueError,'SHA-256'):m.recover(p/'work',{'x':z})
 def test_traversal_rejected_before_writes(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);z,s=self.fixture(p,[('prefix/ok.txt','ok'),('prefix/../../bad','bad')]);w=p/'work'
   with patch.dict(m.SOURCES,s,clear=True):
    with self.assertRaisesRegex(ValueError,'Unsafe'):m.recover(w,{'x':z})
   self.assertFalse((w/'services').exists())
 def test_wrong_prefix_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);z,s=self.fixture(p,[('wrong/a.py','x')])
   with patch.dict(m.SOURCES,s,clear=True):
    with self.assertRaisesRegex(ValueError,'Unsafe'):m.recover(p/'work',{'x':z})
 def test_symlink_destination_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);z,s=self.fixture(p,[('prefix/a.py','x')]);w=p/'work';(w/'services').mkdir(parents=True);(p/'outside').mkdir();(w/'services/vivo').symlink_to(p/'outside',target_is_directory=True)
   with patch.dict(m.SOURCES,s,clear=True):
    with self.assertRaisesRegex(ValueError,'symlink'):m.recover(w,{'x':z})
 def test_ownership_isolated(self):
  rules=json.loads((ROOT/'coordination/vivo/OWNERSHIP.json').read_text())
  self.assertEqual(o.violations(['services/vivo/web/input/targets.mjs'],'chat3',rules),[])
  self.assertEqual(o.violations(['services/vivo/server/app.py'],'chat3',rules),['services/vivo/server/app.py'])
 def test_no_cross_role_prefix_overlap(self):
  rules=json.loads((ROOT/'coordination/vivo/OWNERSHIP.json').read_text())
  for role,a in rules['workers'].items():
   for role2,b in rules['workers'].items():
    if role==role2:continue
    self.assertFalse(any(x.startswith(y)or y.startswith(x)for x in a['paths']for y in b['paths']))
if __name__=='__main__':unittest.main()
