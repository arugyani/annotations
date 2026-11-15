# Releasing Annotations

The source of truth is `manifest.json`. Use a plain `x.y.z` version and an identical Git tag, with no `v` prefix. Update `package.json`, the lockfile, `versions.json`, and `docs/RELEASE_NOTES.md` together. The release validator rejects mismatches.

## Build and validate

Use Node.js 24:

```sh
npm ci
npm run package
```

This runs the TypeScript check, Obsidian's recommended ESLint rules with zero warnings, formatting, engine/DOM tests, a minified build, and distribution checks. `release/<version>/` contains the three Obsidian assets, release notes, and a local `SHA256SUMS` file. Only source is committed; generated builds and archives are ignored.

The bundle validator rejects unexpected runtime imports or bundled dependencies and enforces a 128 kB JavaScript size budget. `onload` registers extensions, commands, events, views, and settings; initial workspace refresh waits for layout readiness. There is no vault-wide startup scan or network work. Pop-out controls use their owning document, deferred Markdown views are type-checked before access, and rendered highlights unload with their render context.

## Publish from a local build

GitHub Actions is not required. Run all checks locally with `npm run package`, then upload the generated files using GitHub CLI. The following commands are for a new version whose tag and release do not yet exist; substitute that version for `1.0.8` on future releases.

```sh
# From the repository root, after committing the version and source changes:
npm ci
RELEASE_TAG=1.0.8 npm run package
git tag -a 1.0.8 -m 'Annotations 1.0.8'
git push origin main 1.0.8
gh release create 1.0.8 --repo arugyani/annotations --verify-tag --draft \
  --title 'Annotations 1.0.8' --notes-file docs/RELEASE_NOTES.md \
  release/1.0.8/main.js release/1.0.8/manifest.json release/1.0.8/styles.css
```

Inspect the draft and install the package in a separate vault. Exercise highlight creation, optional note editing, undo/redo, target movement, malformed-footer refusal, sidebar filtering, Reading view, plugin reload, and reduced motion. Download the release files into a fresh directory and run `shasum -a 256 -c /path/to/local/release/1.0.8/SHA256SUMS` there to verify them. On Linux, use `sha256sum` with the same checksum file.

After verification, publish the regular release:

```sh
gh release edit 1.0.8 --repo arugyani/annotations --draft=false --prerelease=false --latest
```

Upload only `main.js`, `manifest.json`, and `styles.css`. Keep release notes and checksums local; put the notes in the release description. The tag must match the committed manifest version exactly. Keep published tags and assets unchanged; make a new version for subsequent fixes. The local build remains the default release path.

## Optional artifact attestations

After publishing, run the manual attestation workflow on the release tag:

```sh
gh workflow run attest-release.yml --repo arugyani/annotations --ref 1.0.8
```

It runs only for tags in a public repository. The workflow uses a standard Ubuntu runner without a package cache or uploaded build artifacts. Standard runners in public repositories are free and do not use the private-repository compute allowance. No billing settings need to change.

The workflow validates a fresh source build and compares it byte-for-byte with the published files before it creates provenance attestations. It cannot publish or replace a release. If GitHub prevents the workflow from running, the locally validated release remains usable; report the missing attestation rather than claiming success.

Verify a downloaded file with:

```sh
gh attestation verify main.js --repo arugyani/annotations
```

See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) and [artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).

## Community submission

1. Ensure the source repository is public so Obsidian can review it.
2. Publish the reviewed draft as a regular GitHub release. Draft and prerelease assets are not installable through the community directory.
3. Sign in to [Obsidian Community](https://community.obsidian.md), link the owning GitHub account, and submit the repository. The directory reads `manifest.json` from the default branch.
4. Resolve automated/human review feedback with a new version and release.

The ID `comments` is already registered to another plugin. The ID and display name `annotations` / `Annotations` had no conflicting entry in the official directory at this audit; recheck when submitting. Existing pre-submission builds require the installation-folder switch described in the release notes. Their Markdown data format is retained.

## Verification limits

Automated tests cover stored data, anchor movement, undo/redo, invalid metadata, optional notes, selection direction, synced settings, and DOM ownership/text safety. Native runtime checks are performed only in a synthetic vault. Mobile hardware, the exact minimum app version, and third-party theme/plugin combinations are not certified by those checks.

## Official references

- [Plugin guidelines](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Releasing/Plugin%20guidelines.md)
- [Optimize plugin load time](https://docs.obsidian.md/plugins/guides/load-time)
- [Deferred views](https://docs.obsidian.md/plugins/guides/defer-views)
- [Pop-out windows](https://docs.obsidian.md/plugins/guides/pop-out-windows)
- [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Submit a plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin)
