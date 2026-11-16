#!/usr/bin/env python3
"""Read-only Obsidian metadata/asset checks. No network or publication actions."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--styles', choices=['auto', 'required', 'none'], default='auto',
                        help='auto requires styles.css when root/src CSS exists; override for other build layouts')
    parser.add_argument('--release-json', type=Path)
    parser.add_argument('--downloaded', type=Path)
    parser.add_argument('--require-published', action='store_true')
    args = parser.parse_args()
    errors = []

    def check(condition, message):
        if not condition:
            errors.append(message)

    def read_json(path):
        value = json.loads(path.read_text())
        if not isinstance(value, dict):
            raise ValueError(f'{path}: expected a JSON object')
        return value

    manifest = read_json(args.repo / 'manifest.json')
    version = manifest.get('version')
    check(isinstance(version, str) and re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version),
          'Manifest version must be plain x.y.z')
    check(args.tag == version, 'Tag differs from manifest version')
    for key in ('id', 'name', 'author', 'description', 'minAppVersion'):
        check(isinstance(manifest.get(key), str) and bool(manifest[key].strip()),
              f'Manifest is missing nonempty {key}')
    check('isDesktopOnly' not in manifest or isinstance(manifest['isDesktopOnly'], bool),
          'isDesktopOnly must be a boolean')
    for name in ('package.json', 'package-lock.json'):
        path = args.repo / name
        if path.exists():
            data = read_json(path)
            check(data.get('version') == version, f'{name} version differs')
            if name == 'package-lock.json' and 'packages' in data:
                check(data['packages'].get('', {}).get('version') == version,
                      'Lockfile root package version differs')
    versions_path = args.repo / 'versions.json'
    if versions_path.exists():
        check(read_json(versions_path).get(version) == manifest.get('minAppVersion'),
              'Compatibility map entry is missing or differs')
    else:
        print('NOTE: no versions.json; verify compatibility mapping requirements for this repository.')

    css_used = args.styles == 'required' or (args.styles == 'auto' and (
        (args.repo / 'styles.css').exists() or any((args.repo / 'src').rglob('*.css'))))
    names = ['main.js', 'manifest.json'] + (['styles.css'] if css_used else [])
    hashes = {}
    for name in names:
        path = args.assets / name
        if not path.is_file() or path.stat().st_size == 0:
            check(False, f'Missing or empty build asset: {name}')
            continue
        hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    if 'manifest.json' in hashes:
        check(read_json(args.assets / 'manifest.json') == manifest,
              'Built manifest differs from source manifest')

    if args.release_json:
        release = read_json(args.release_json)
        check(release.get('tagName') == args.tag, 'Release tag differs')
        check(isinstance(release.get('isDraft'), bool), 'Release snapshot lacks isDraft')
        check(release.get('isPrerelease') is False, 'Release is prerelease or snapshot lacks isPrerelease')
        if args.require_published:
            check(release.get('isDraft') is False, 'Release is still a draft')
        assets = release.get('assets')
        if not isinstance(assets, list) or not all(isinstance(a, dict) for a in assets):
            check(False, 'Release snapshot lacks an asset list')
        else:
            uploaded = [a.get('name') for a in assets]
            check(len(uploaded) == len(names) and set(uploaded) == set(names),
                  f'Wrong uploaded asset set: {uploaded}; expected {names}')
            for item in assets:
                name = item.get('name')
                if name not in hashes:
                    continue
                check(item.get('size') == (args.assets / name).stat().st_size,
                      f'Uploaded size differs: {name}')
                if 'state' in item:
                    check(item['state'] == 'uploaded', f'Asset not fully uploaded: {name}')
                if item.get('digest'):
                    check(item['digest'] == 'sha256:' + hashes[name], f'Uploaded digest differs: {name}')
    elif args.require_published:
        check(False, '--require-published requires --release-json')

    if args.downloaded:
        for name in names:
            path = args.downloaded / name
            check(path.is_file() and name in hashes and
                  hashlib.sha256(path.read_bytes()).hexdigest() == hashes.get(name),
                  f'Download missing or different: {name}')
    if errors:
        for message in errors:
            print('FAIL:', message, file=sys.stderr)
        return 1
    print(f'PASS: {args.tag}; metadata and {len(names)} build assets checked.')
    if args.release_json:
        print('PASS: release snapshot checked' + ('; published stable release.' if args.require_published else '.'))
    if args.downloaded:
        print('PASS: downloaded assets match the build byte-for-byte.')
    for name, digest in hashes.items():
        print(f'{digest}  {name}')
    print('Not checked: source commit identity, CSS, runtime behavior, attestations, community approval.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as exc:
        print(f'FAIL: {exc}', file=sys.stderr)
        sys.exit(1)
