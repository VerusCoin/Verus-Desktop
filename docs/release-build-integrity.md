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

Before dependency installation, all security and build jobs source
`scripts/useBuildNode.sh` to select Node **22.23.4**, satisfying Electron 42's
Node >=22.12 installation requirement. If that exact version is not already
active, the helper downloads an official Node archive into a temporary
directory, checks its hard-coded SHA-256 against the reviewed
[official checksum list](https://nodejs.org/dist/v22.23.4/SHASUMS256.txt), and
prepends the extracted runtime to `PATH`. Linux and macOS x64/arm64 hosts are
supported. The Windows packaging container uses the Linux host runtime.
Container image digests and the application dependency lockfiles remain the
other pinned inputs. When changing the build runtime, update its exact version
and all four archive hashes together.

Use the same toolchain for a local build:

```sh
source scripts/useBuildNode.sh
yarn install --frozen-lockfile --non-interactive
```

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
`NODE_ENV=production`. The pinned Node 22 builder jobs enable OpenSSL's legacy
provider only for compatibility with the built-ins' reviewed Webpack 4 build.

The pipeline runs the root and renderer security regression suites in a
dedicated `security` stage. Packaging jobs do not begin unless that stage
passes.

## Electron runtime

Electron is pinned to **42.11.16** and requires macOS 12 or newer and Windows 10
or newer. File selection uses Electron's
`webUtils.getPathForFile` through the existing isolated preload bridge because
the runtime no longer exposes `File.path`.

## Artifact checksums

Each release job runs `scripts/writeArtifactChecksums.js` after packaging. It
writes a deterministic GNU-compatible `<artifact>.sha256` sidecar containing
the SHA-256 of the final AppImage, Windows installer, or DMG. The pipeline
publishes the installer and checksum sidecar together.

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
