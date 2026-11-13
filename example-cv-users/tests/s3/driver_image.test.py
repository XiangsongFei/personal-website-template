"""Small in-memory OCI fixtures; never invokes Docker or extracts files."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import unittest

spec = importlib.util.spec_from_file_location('image_verify', Path(__file__).parent / 'driver/image_verify.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture(change_config=None, change_manifest=None, unsafe=None, corrupt=False):
    layer = b'controlled-offline-layer'
    digest = lambda b: 'sha256:' + hashlib.sha256(b).hexdigest()
    lid = digest(layer)
    config = {'os': 'linux', 'architecture': 'arm64', 'variant': 'v8', 'config': {'Env': ['NODE_VERSION=24.22.1']}, 'rootfs': {'diff_ids': [lid]}}
    if change_config:
        change_config(config)
    config_raw = json.dumps(config).encode()
    cid = digest(config_raw)
    manifest = {'config': {'digest': cid}, 'layers': [{'digest': lid}]}
    if change_manifest:
        change_manifest(manifest)
    manifest_raw = json.dumps(manifest).encode()
    mid = digest(manifest_raw)
    expected = {'config_digest': cid, 'archive_manifest_digest': mid, 'layers': [{'diff_id': lid, 'uncompressed_bytes': len(layer)}]}
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode='w') as archive:
        for name, blob in [('blobs/sha256/' + lid[7:], layer + b'corruption' if corrupt else layer), ('blobs/sha256/' + cid[7:], config_raw), ('blobs/sha256/' + mid[7:], manifest_raw)]:
            info = tarfile.TarInfo(name)
            info.size = len(blob)
            archive.addfile(info, io.BytesIO(blob))
        if unsafe:
            info = tarfile.TarInfo(unsafe)
            archive.addfile(info, io.BytesIO())
    data.seek(0)
    return data, expected


class ResidentVerifier(unittest.TestCase):
    def test_valid_content(self):
        data, expected = fixture()
        self.assertTrue(module.verify(data, expected)['verified'])

    def test_frozen_platform_and_version(self):
        for field, value in [('os', 'other'), ('architecture', 'amd64'), ('variant', 'v7')]:
            with self.subTest(field=field):
                data, expected = fixture(lambda c: c.update({field: value}))
                with self.assertRaisesRegex(ValueError, 'PLATFORM'):
                    module.verify(data, expected)
        data, expected = fixture(lambda c: c['config'].update(Env=['NODE_VERSION=24.13.0']))
        with self.assertRaisesRegex(ValueError, 'NODE_VERSION'):
            module.verify(data, expected)

    def test_layer_content_and_order(self):
        data, expected = fixture(corrupt=True)
        with self.assertRaisesRegex(ValueError, 'BLOB_DIGEST'):
            module.verify(data, expected)
        data, expected = fixture(lambda c: c['rootfs'].update(diff_ids=[]))
        with self.assertRaisesRegex(ValueError, 'LAYER_ORDER'):
            module.verify(data, expected)
        data, expected = fixture()
        expected['layers'][0]['uncompressed_bytes'] += 1
        with self.assertRaisesRegex(ValueError, 'LAYER_CONTENT'):
            module.verify(data, expected)

    def test_registry_and_save_manifests_are_not_interchangeable(self):
        data, expected = fixture(change_manifest=lambda m: m['config'].update(digest='sha256:' + '0' * 64))
        with self.assertRaisesRegex(ValueError, 'CONFIG_BINDING'):
            module.verify(data, expected)
        data, expected = fixture()
        expected['archive_manifest_digest'] = 'sha256:' + '0' * 64
        with self.assertRaisesRegex(ValueError, 'IMAGE_METADATA_MISSING'):
            module.verify(data, expected)

    def test_path_traversal_and_absolute_paths(self):
        for name in ['../escape', '/absolute']:
            data, expected = fixture(unsafe=name)
            with self.assertRaisesRegex(ValueError, 'UNSAFE_ARCHIVE'):
                module.verify(data, expected)


if __name__ == '__main__':
    unittest.main(verbosity=2)
