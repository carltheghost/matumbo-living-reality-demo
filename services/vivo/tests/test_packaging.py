import unittest,re,hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class PackagingTests(unittest.TestCase):
 def test_original_studio_retained_exactly(self):
  original=(ROOT/'web/studio-original.html').read_bytes();bridged=(ROOT/'web/studio.html').read_bytes();self.assertEqual(bridged.replace(b'<script src="studio-bridge.js"></script>',b''),original)
 def test_private_model_photo_not_in_web(self):
  self.assertFalse(any(p.suffix.lower() in ('.jpg','.jpeg')for p in (ROOT/'web').rglob('*')))
 def test_vendor_model_present(self):
  self.assertGreater((ROOT/'web/vendor/field-lab/hand_landmarker.task').stat().st_size,7000000)
 def test_recording_does_not_request_microphone(self):
  self.assertIn('audio:false',(ROOT/'web/camera.js').read_text());self.assertNotIn('audio:true',(ROOT/'web/camera.js').read_text())
 def test_public_binding_requires_creation_key(self):
  from server.config import validate_network_settings
  with self.assertRaisesRegex(ValueError,'VIVA_CREATE_KEY'):
   validate_network_settings('0.0.0.0','https://viva.example',None,'/data/viva.sqlite',ROOT/'web')
 def test_bridge_explicit_not_silent_sync(self):
  s=(ROOT/'web/studio-bridge.js').read_text();self.assertIn('confirm(',s);self.assertIn('viva-bridge-universe',s);self.assertIn('candidate.initialEnergy=candidate.energy()',s)
