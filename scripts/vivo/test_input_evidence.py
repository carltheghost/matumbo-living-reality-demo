#!/usr/bin/env python3
"""Negative controls for the input evidence gate; these are not input tests."""
import contextlib
import io
import unittest
from assert_input_evidence import EXPECTED_TESTS, FALSY_GROUPS, FALSY_VALUES, HOSTILE_NAMES, verify


def evidence():
    names = [f'ordinary case {i}' for i in range(65)]
    names += [f'{g} {v} regression' for g in FALSY_GROUPS for v in FALSY_VALUES]
    names += list(HOSTILE_NAMES)
    assert len(names) == EXPECTED_TESTS
    return '\n'.join(['TAP version 13'] + [f'ok {i} - {n}' for i, n in enumerate(names, 1)] +
                     ['1..102', '# tests 102', '# pass 102', '# fail 0', '# cancelled 0', '# skipped 0', '# todo 0', ''])


class EvidenceGateTests(unittest.TestCase):
    def check(self, text):
        with contextlib.redirect_stdout(io.StringIO()):
            verify(text)

    def test_complete_expected_run(self):
        self.check(evidence())

    def test_old_90_summary_is_not_certified(self):
        with self.assertRaises(ValueError):
            self.check(evidence().replace('102', '90'))

    def test_all_twelve_hostile_names_are_required_even_if_totals_match(self):
        for name in HOSTILE_NAMES:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.check(evidence().replace(name, 'different case'))

    def test_all_falsy_cases_remain_required(self):
        for group in FALSY_GROUPS:
            for value in FALSY_VALUES:
                with self.subTest(group=group, value=value), self.assertRaises(ValueError):
                    self.check(evidence().replace(f'{group} {value} regression', 'different case'))

    def test_skipped_case_cannot_hide_behind_zero_skipped_summary(self):
        with self.assertRaises(ValueError):
            self.check(evidence().replace('ordinary case 0', 'ordinary case 0 # SKIP'))

    def test_failure_cannot_hide_behind_zero_failed_summary(self):
        with self.assertRaises(ValueError):
            self.check(evidence().replace('ok 1 -', 'not ok 1 -'))

    def test_missing_or_duplicate_plan_is_rejected(self):
        for data in [evidence().replace('1..102', ''), evidence() + '1..102\n']:
            with self.subTest(data=data[-60:]), self.assertRaises(ValueError):
                self.check(data)

    def test_repeated_ordinal_is_rejected(self):
        with self.assertRaises(ValueError):
            self.check(evidence().replace('ok 102 -', 'ok 101 -'))

    def test_repeated_summary_is_rejected(self):
        with self.assertRaises(ValueError):
            self.check(evidence() + '# tests 102\n')


if __name__ == '__main__':
    unittest.main(verbosity=2)
