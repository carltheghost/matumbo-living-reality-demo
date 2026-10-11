"""Verify exact packaged code/model bytes; this is not a device test."""
import hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
report=json.loads((root/'integrity.json').read_text())
failed=[]
for name,expected in report['sha256'].items():
 p=root/name
 if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=expected:failed.append(name)
if failed:raise SystemExit('Integrity mismatch: '+', '.join(failed))
print('Verified '+str(len(report['sha256']))+' packaged files')
