#!/usr/bin/env python3
"""Fail CI if a nominally green run did not execute the pinned falsy regressions."""
import re
import sys
from pathlib import Path


def verify(text):
    for field, expected in [('tests',90),('pass',90),('fail',0),('cancelled',0),('skipped',0),('todo',0)]:
        values=re.findall(r'^# '+field+r' (\d+)\s*$',text,re.M)
        if values != [str(expected)]:
            raise ValueError(f'Unexpected TAP {field}: {values}, expected {expected}')
    names=re.findall(r'^ok \d+ - (.+)$',text,re.M)
    groups=['falsy target rejection','falsy release transport rejection',
            'falsy synchronous submit throw','falsy fulfilled receipt','falsy late rejection']
    for group in groups:
        for value in ['undefined','null','false','0',"''"]:
            matched=[n for n in names if n.startswith(group+' '+value+' ')]
            if len(matched)!=1:
                raise ValueError(f'Missing or repeated regression: {group} {value}')
    print('Verified 90/90 input tests, including all 25 named falsy-rejection/control cases; zero skips.')


if __name__=='__main__':
    verify(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
