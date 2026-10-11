#!/usr/bin/env python3
"""Require the pinned 102-test input run, including all hostile and falsy cases."""
import re
import sys
from pathlib import Path

EXPECTED_TESTS = 102
FALSY_GROUPS = (
    'falsy target rejection', 'falsy release transport rejection',
    'falsy synchronous submit throw', 'falsy fulfilled receipt', 'falsy late rejection',
)
FALSY_VALUES = ('undefined', 'null', 'false', '0', "''")
HOSTILE_NAMES = tuple(
    f'untrusted rejection description: {reason}, {timing}, {kind}'
    for reason in ('null-prototype', 'message-getter', 'toString')
    for timing in ('async', 'sync')
    for kind in ('grab.target', 'grab.end')
)


def verify(text):
    for field, expected in [('tests', EXPECTED_TESTS), ('pass', EXPECTED_TESTS),
                            ('fail', 0), ('cancelled', 0), ('skipped', 0), ('todo', 0)]:
        values = re.findall(r'^# ' + field + r' (\d+)\s*$', text, re.M)
        if values != [str(expected)]:
            raise ValueError(f'Unexpected TAP {field}: {values}, expected {expected}')
    if re.findall(r'^1\.\.(\d+)\s*$', text, re.M) != [str(EXPECTED_TESTS)]:
        raise ValueError('Missing, repeated, or incorrect TAP plan')
    if re.search(r'^not ok\b|^ok .* # (?:SKIP|TODO)\b', text, re.M | re.I):
        raise ValueError('Failed, skipped, or TODO test in TAP body')
    entries = re.findall(r'^ok (\d+) - (.+)$', text, re.M)
    if [int(n) for n, _ in entries] != list(range(1, EXPECTED_TESTS + 1)):
        raise ValueError('Missing or repeated top-level test results')
    names = [name for _, name in entries]
    if len(set(names)) != EXPECTED_TESTS:
        raise ValueError('Duplicate test name')
    for group in FALSY_GROUPS:
        for value in FALSY_VALUES:
            matched = [n for n in names if n.startswith(group + ' ' + value + ' ')]
            if len(matched) != 1:
                raise ValueError(f'Missing or repeated regression: {group} {value}')
    for name in HOSTILE_NAMES:
        if names.count(name) != 1:
            raise ValueError('Missing or repeated hostile-object case: ' + name)
    print('Verified 102/102 input tests: 25 falsy cases and 12 hostile-object cases; zero failures/skips.')


if __name__ == '__main__':
    verify(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
