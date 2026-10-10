#!/usr/bin/env python3
"""Check a supporting window's changed paths; does not merge or stage files."""
import argparse,json,subprocess
from pathlib import Path

def violations(paths,role,rules):
    prefixes=rules['workers'][role]['paths']
    return [p for p in paths if not any(p.startswith(prefix) for prefix in prefixes)]

def main():
    p=argparse.ArgumentParser();p.add_argument('role',choices=['chat2','chat3','chat4','chat5']);p.add_argument('--base',required=True);p.add_argument('--repo',type=Path,default=Path.cwd());a=p.parse_args()
    rules=json.loads((a.repo/'coordination/vivo/OWNERSHIP.json').read_text())
    def git(*args):return subprocess.check_output(['git','-C',str(a.repo),*args])
    # Include committed, staged and unstaged changes, not merely committed HEAD.
    git('merge-base','--is-ancestor',a.base,'HEAD')
    paths=set(git('diff','--no-renames','--name-only','-z',a.base).decode().strip('\0').split('\0'))-{''}
    bad=violations(sorted(paths),a.role,rules)
    if bad:raise SystemExit('Out of scope: '+', '.join(bad))
    print(f'{a.role}: {len(paths)} changed tracked paths within owned boundaries. Check new untracked files before staging; never git add -A.')
if __name__=='__main__':main()
