"""Negative fixtures for complete-import verification; no original bytes edited."""
import copy
import hashlib
import tempfile
import unittest
from pathlib import Path
from verify_source_import import verify


class ImportVerificationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.target = self.root / 'services/vivo/example.bin'
        self.target.parent.mkdir(parents=True)
        data = b'\x00\xff\r\nexact bytes\x00'
        self.target.write_bytes(data)
        self.archives = {'fixture.zip': {'sha256': 'archive-fixture', 'members': 1,
                                         'destination': 'services/vivo/'}}
        self.manifest = {'schema': 'vivo.source-import/1', 'archives': self.archives,
                         'files': [{'path': 'services/vivo/example.bin', 'archive': 'fixture.zip',
                                    'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                                    'gitBlob': hashlib.sha1(b'blob ' + str(len(data)).encode()
                                                           + b'\0' + data).hexdigest()}]}

    def check(self):
        return verify(self.root, self.manifest, self.archives)

    def test_exact_binary_bytes(self):
        self.assertEqual(self.check()['count'], 1)

    def test_missing_member_fails(self):
        self.target.unlink()
        with self.assertRaisesRegex(ValueError, 'missing'):
            self.check()

    def test_mutation_fails(self):
        self.target.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'byte/hash mismatch'):
            self.check()

    def test_truncated_inventory_fails(self):
        self.manifest['files'] = []
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            self.check()

    def test_duplicate_member_fails(self):
        self.manifest['files'] *= 2
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            self.check()

    def test_wrong_git_blob_fails(self):
        self.manifest['files'][0]['gitBlob'] = '0' * 40
        with self.assertRaisesRegex(ValueError, 'byte/hash mismatch'):
            self.check()

    def test_wrong_archive_fails(self):
        self.manifest['archives'] = copy.deepcopy(self.archives)
        self.manifest['archives']['fixture.zip']['sha256'] = 'wrong'
        with self.assertRaisesRegex(ValueError, 'Archive identity'):
            self.check()

    def test_traversal_fails(self):
        self.manifest['files'][0]['path'] = 'services/vivo/../outside'
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            self.check()

    def test_wrong_destination_fails(self):
        self.manifest['files'][0]['path'] = 'other/example.bin'
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            self.check()

    def test_symlink_fails(self):
        self.target.unlink()
        self.target.symlink_to(self.root / 'outside')
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            self.check()


if __name__ == '__main__':
    unittest.main(verbosity=2)
