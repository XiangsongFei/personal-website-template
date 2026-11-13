"""Bounded, read-only resident OCI archive verifier. No extraction or import."""
import hashlib
import json
import subprocess
import sys
import tarfile


def verify(stream, expected):
    blobs = {}
    config = None
    manifest = None
    total = 0
    seen = set()
    with tarfile.open(fileobj=stream, mode='r|') as archive:
        for entry in archive:
            name = entry.name
            if name.startswith('/') or '..' in name.split('/') or name in seen:
                raise ValueError('UNSAFE_ARCHIVE')
            seen.add(name)
            if entry.isdir():
                continue
            if not entry.isfile() or entry.size > 1024 ** 3:
                raise ValueError('UNSAFE_ENTRY')
            total += entry.size
            if total > 1024 ** 3:
                raise ValueError('ARCHIVE_BUDGET')
            sha = hashlib.sha256()
            small = bytearray()
            reader = archive.extractfile(entry)
            for chunk in iter(lambda: reader.read(1024 * 1024), b''):
                sha.update(chunk)
                if entry.size <= 1024 * 1024:
                    small.extend(chunk)
            digest = 'sha256:' + sha.hexdigest()
            if name.startswith('blobs/sha256/'):
                if name != 'blobs/sha256/' + sha.hexdigest():
                    raise ValueError('BLOB_DIGEST')
                blobs[digest] = entry.size
            if digest == expected['config_digest']:
                config = json.loads(small)
            if digest == expected['archive_manifest_digest']:
                manifest = json.loads(small)
    if not config or not manifest:
        raise ValueError('IMAGE_METADATA_MISSING')
    if (config['os'], config['architecture'], config.get('variant')) != ('linux', 'arm64', 'v8'):
        raise ValueError('PLATFORM')
    if 'NODE_VERSION=24.22.1' not in config['config']['Env']:
        raise ValueError('NODE_VERSION')
    layers = expected['layers']
    if config['rootfs']['diff_ids'] != [x['diff_id'] for x in layers]:
        raise ValueError('LAYER_ORDER')
    if manifest['config']['digest'] != expected['config_digest']:
        raise ValueError('CONFIG_BINDING')
    if [x['digest'] for x in manifest['layers']] != [x['diff_id'] for x in layers]:
        raise ValueError('MANIFEST_BINDING')
    if any(blobs.get(x['diff_id']) != x['uncompressed_bytes'] for x in layers):
        raise ValueError('LAYER_CONTENT')
    return {'verified': True, 'platform': 'linux/arm64/v8', 'config': expected['config_digest'], 'layer_count': len(layers), 'blob_bytes': total}


if __name__ == '__main__':
    expected = json.load(sys.stdin)
    process = subprocess.Popen(['docker', '--context', 'desktop-linux', 'image', 'save', expected['engine_image_id']], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        result = verify(process.stdout, expected)
        while process.stdout.read(1024 * 1024):
            pass
        error = process.stderr.read()
        if process.wait(timeout=10) or error:
            raise ValueError('EXPORT_UNKNOWN')
        print(json.dumps(result))
    except BaseException:
        process.kill()
        process.wait()
        raise
