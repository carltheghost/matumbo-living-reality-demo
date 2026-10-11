"""Copy this build additively into an existing feature-branch checkout.
No commit, push, merge, deployment, package purchase or credentials are performed.
"""
import argparse,shutil,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('repository',type=Path);a=p.parse_args();repo=a.repository.resolve()
 def git(*args):return subprocess.check_output(['git','-C',str(repo),*args],text=True).strip()
 try:
  branch=git('branch','--show-current')
  if not branch or branch in ('main','master'):raise ValueError('Check out a feature branch first; this installer will not change main')
  if git('status','--porcelain'):raise ValueError('Use a clean worktree before installing')
  target=repo/'services/viva-shared'
  if target.exists():raise ValueError('The destination already exists; reconcile it instead of overwriting')
  if ROOT==repo or repo.is_relative_to(ROOT):raise ValueError('Choose a separate repository checkout')
  shutil.copytree(ROOT,target,ignore=shutil.ignore_patterns('data','__pycache__','*.pyc','*.sqlite*','.env','.venv','reports-08'))
  print('Installed additively on branch '+branch)
  print('Destination: services/viva-shared')
  print('Existing root and Studio files were not changed. Review the diff, run tests, then submit your PR.')
 except (ValueError,subprocess.CalledProcessError) as e:p.error(str(e))
if __name__=='__main__':main()
