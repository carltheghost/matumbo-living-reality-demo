#!/usr/bin/env python3
"""Transfer exact upstream vendor bytes to detached Git blobs. Never move any ref.

All seven downloads must match original ZIP size, SHA-256 and Git blob ID before
any POST. GitHub Actions supplies a job-scoped token; no credentials are logged.
This is not an original-source import and does not make the app ready.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT=Path(__file__).resolve().parents[2]
REPO='carltheghost/matumbo-living-reality-demo'
REF='refs/heads/vivo/chat1-authority-input-2026-10-10'
API=f'https://api.github.com/repos/{REPO}/git/blobs'


def validate(data, item):
    git=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
    if len(data)!=item['bytes'] or hashlib.sha256(data).hexdigest()!=item['sha256'] or git!=item['gitBlob']:
        raise ValueError('Original vendor bytes differ: '+item['path'])
    encoded=base64.b64encode(data).decode('ascii')
    if base64.b64decode(encoded,validate=True)!=data:
        raise ValueError('Base64 roundtrip mismatch')
    return encoded


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--local-root',type=Path)
    parser.add_argument('--upload',action='store_true')
    parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args()
    if args.upload:
        if args.local_root or os.environ.get('GITHUB_REPOSITORY')!=REPO or os.environ.get('GITHUB_REF')!=REF or os.environ.get('GITHUB_EVENT_NAME')!='push':
            raise SystemExit('Upload requires the exact authorized push branch; no PR-supplied code.')
        token=os.environ.get('GH_TOKEN')
        if not token:raise SystemExit('Missing job-scoped repository token')
    manifest=json.loads((ROOT/'scripts/vivo/vendor-transfer.json').read_text())
    if manifest['repository']!=REPO or len(manifest['files'])!=7:raise ValueError('Invalid manifest')
    staged=[]
    for item in manifest['files']:
        parsed=urlparse(item['url'])
        if parsed.scheme!='https' or parsed.netloc not in ['cdn.jsdelivr.net','storage.googleapis.com']:
            raise ValueError('Unapproved upstream')
        if not item['path'].startswith('services/vivo/web/vendor/field-lab/') or '..' in Path(item['path']).parts:
            raise ValueError('Invalid path')
        if args.local_root:
            data=(args.local_root/item['path']).read_bytes()
        else:
            with urlopen(item['url'],timeout=60) as response:
                data=response.read(item['bytes']+1)
        encoded=validate(data,item)
        try:validate(data+b'\0',item)
        except ValueError:pass
        else:raise AssertionError('Corruption was not rejected')
        staged.append((item,encoded))
    report={'schema':'vivo.vendor-transfer-result/1','sourceArchiveSha256':manifest['archiveSha256'],
            'commit':os.environ.get('GITHUB_SHA'),'runId':os.environ.get('GITHUB_RUN_ID'),
            'uploadRequested':args.upload,'refsChanged':False,'sourceImportComplete':False,'files':[]}
    for item,encoded in staged:
        row={**item,'base64Characters':len(encoded),'uploaded':False}
        if args.upload:
            request=Request(API,data=json.dumps({'encoding':'base64','content':encoded}).encode(),
                method='POST',headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json',
                'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'})
            try:
                with urlopen(request,timeout=120) as response:
                    result=json.load(response);row['httpStatus']=response.status
            except HTTPError as error:
                raise RuntimeError('Git blob POST failed: HTTP '+str(error.code)) from None
            if result.get('sha')!=item['gitBlob']:raise ValueError('Returned Git blob differs')
            row['uploaded']=True
        report['files'].append(row)
        print(item['gitBlob'],item['bytes'],len(encoded),'uploaded' if row['uploaded'] else 'verified locally',item['path'])
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(report,indent=2)+'\n')
    print('Verified',len(staged),'complete files; no commit, tree, reference, merge or deployment writes.')


if __name__=='__main__':main()
