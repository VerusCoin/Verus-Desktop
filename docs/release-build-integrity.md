# Release build integrity

The release pipeline treats source revisions, dependency lockfiles, and container
images as immutable build inputs.

## Pinned inputs

The exact built-in application repositories and commits are hard-coded as
read-only release inputs in `scripts/buildBuiltinPlugins.sh`; CI variables
cannot override them. The Linux and Windows build
jobs use Docker images addressed by full SHA-256 digest rather than a mutable
tag. The macOS job runs on the controlled `Ventura` host runner and therefore
does not have a container image to pin.

To update a built-in application, review the target commit, replace the full
40-character commit in `scripts/buildBuiltinPlugins.sh`, and confirm that the commit contains a
tracked `yarn.lock`. `scripts/buildBuiltinPlugins.sh` checks out the commit in a
detached state, verifies the resolved revision, requires that lockfile, and
installs with `--frozen-lockfile --non-interactive`. It also requires and applies
the corresponding SHA-256-pinned patch in `scripts/patches/`. Those patches remove
eval-based production source generation and keep built-in API traffic on the
exact loopback backend allowed by the packaged CSP. A patch that no longer
matches its reviewed hash or no longer applies cleanly stops the release and
requires review alongside the commit bump.

After each built-in compiles, the build script checks the emitted files again.
It requires a meta CSP containing `script-src 'self'`, rejects `unsafe-eval`,
source-map files, and eval-based Webpack wrappers, and only then copies the
renderer into the packaged assets.

To update a container builder, resolve the digest from the registry manifest and
replace the complete `image@sha256:<digest>` reference. Do not replace it with a
tag-only reference.

## Dependency installs

All release installs use Yarn's frozen lockfile mode. A missing or stale
lockfile stops the build instead of silently resolving a new dependency graph.
This applies to the root application, the GUI submodule, and both cloned
built-in applications. The built-ins are explicitly built with
`NODE_ENV=production`. The pinned Node 20 builder jobs enable OpenSSL's legacy
provider only for compatibility with the built-ins' reviewed Webpack 4 build.

The pipeline runs the root and renderer security regression suites in a
dedicated `security` stage. Packaging jobs do not begin unless that stage
passes.

## Artifact checksums

Each release job runs `scripts/writeArtifactChecksums.js` after packaging. It
writes a deterministic GNU-compatible `<artifact>.sha256` sidecar containing
the SHA-256 of the final AppImage, Windows installer, or DMG. The pipeline
publishes the installer and checksum sidecar together and also retains the
sidecar as a GitLab job artifact.

The checksum records the exact bytes produced by CI; it is not an independent
signature. Consumers still need to obtain it through a trusted release channel.

The sidecar can be verified with either of these commands:

```sh
sha256sum -c Verus-Desktop-v1.2.6.dmg.sha256
shasum -a 256 -c Verus-Desktop-v1.2.6.dmg.sha256
```

Run the focused validation with:

```sh
node --test test/releaseBuildIntegrity.spec.js
```
