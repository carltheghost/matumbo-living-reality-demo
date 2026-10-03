"""Create a reproducible static-demo ZIP and per-file integrity manifest."""
from pathlib import Path
import argparse
import hashlib
import json
import tempfile
import zipfile
from build_pages import build, ROOT


def package(destination):
    destination = Path(destination).resolve()
    if destination == ROOT or any(destination.is_relative_to(ROOT / part) for part in ('src','vendor','assets','public')):
        raise ValueError('Package output must be separate from source assets.')
    destination.mkdir(parents=True, exist_ok=True)
    archive_path = destination / 'matumbo-static-demo.zip'
    if archive_path.exists():
        raise ValueError('Use a fresh output directory; an existing archive will not be replaced.')
    with tempfile.TemporaryDirectory(prefix='.package-', dir=destination) as scratch:
        scratch = Path(scratch).resolve()
        assert scratch.is_relative_to(destination)
        build(scratch)
        files = sorted((file for file in scratch.rglob('*') if file.is_file()), key=lambda file:file.relative_to(scratch).as_posix())
        manifest = {'type':'static-demo','credentialsRequired':False,'externalDeployment':False,
            'serverIncluded':False,'fileCount':len(files),'entrypoint':'index.html',
            'files':[{'path':file.relative_to(scratch).as_posix(),'bytes':file.stat().st_size,
                'sha256':hashlib.sha256(file.read_bytes()).hexdigest()} for file in files]}
        manifest_bytes = (json.dumps(manifest, indent=2, sort_keys=True) + '\n').encode('utf-8')
        with zipfile.ZipFile(archive_path,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
            for file in files:
                info = zipfile.ZipInfo(file.relative_to(scratch).as_posix(),date_time=(2026,1,1,0,0,0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info,file.read_bytes(),compresslevel=9)
            info = zipfile.ZipInfo('manifest.json',date_time=(2026,1,1,0,0,0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info,manifest_bytes,compresslevel=9)
        (destination / 'manifest.json').write_bytes(manifest_bytes)
        with zipfile.ZipFile(archive_path) as archive:
            if archive.testzip() is not None:
                raise ValueError('Archive integrity failed.')
            for entry in manifest['files']:
                assert hashlib.sha256(archive.read(entry['path'])).hexdigest() == entry['sha256']
        digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
        (destination / 'SHA256.txt').write_text(f'{digest} *{archive_path.name}\n', encoding='ascii')
    return {'archive':str(archive_path),'fileCount':len(files),'sha256':digest,'verified':True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output')
    print(json.dumps(package(parser.parse_args().output)))
