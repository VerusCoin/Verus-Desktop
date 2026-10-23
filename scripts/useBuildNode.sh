#!/usr/bin/env bash

# Source this file so the verified build runtime remains on the caller's PATH.
# The container images stay pinned; Electron 42's installer requires Node >=22.12.
verus_use_build_node() {
  local version="22.23.4"
  local platform architecture expected_sha256 temporary_directory archive actual_sha256

  if [[ "$(node --version 2>/dev/null)" == "v${version}" ]]; then
    return 0
  fi

  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)
      platform="linux"; architecture="x64"
      expected_sha256="b8492284c76a54baf58d61668dd0e41ee0fc98adabf9503d30f05d08f55b4406" ;;
    Linux-aarch64|Linux-arm64)
      platform="linux"; architecture="arm64"
      expected_sha256="f7a1e486dbc8b286847815b477d4fb5e9fb963ed4489c3e1588853d685f589f9" ;;
    Darwin-x86_64)
      platform="darwin"; architecture="x64"
      expected_sha256="efcc2b0db6f94bf53eddb038fe2b370277a042bd29e4f19b8f8e23598795b819" ;;
    Darwin-arm64)
      platform="darwin"; architecture="arm64"
      expected_sha256="c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428" ;;
    *)
      echo "Unsupported build host for Node ${version}: $(uname -s)-$(uname -m)." >&2
      return 1 ;;
  esac

  if ! command -v curl >/dev/null || ! command -v tar >/dev/null; then
    echo "Installing the pinned build Node requires curl and tar." >&2
    return 1
  fi
  if ! command -v sha256sum >/dev/null && ! command -v shasum >/dev/null; then
    echo "Verifying the pinned build Node requires sha256sum or shasum." >&2
    return 1
  fi

  temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/verus-build-node.XXXXXX")" || {
    echo "Could not create a temporary directory for the pinned build Node." >&2
    return 1
  }
  archive="${temporary_directory}/node.tar.gz"

  # These hashes are reviewed release inputs from the official SHASUMS256.txt.
  # The Windows packaging job runs in Linux, so select the host, not the target.
  if ! curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 \
    "https://nodejs.org/dist/v${version}/node-v${version}-${platform}-${architecture}.tar.gz" \
    --output "${archive}"; then
    echo "Failed to download the pinned Node ${version} build runtime." >&2
    rm -rf -- "${temporary_directory}"
    return 1
  fi

  if command -v sha256sum >/dev/null; then
    actual_sha256="$(sha256sum "${archive}")"
  else
    actual_sha256="$(shasum -a 256 "${archive}")"
  fi
  if [[ "${actual_sha256%% *}" != "${expected_sha256}" ]]; then
    echo "SHA-256 mismatch for the pinned Node ${version} build runtime." >&2
    rm -rf -- "${temporary_directory}"
    return 1
  fi
  if ! tar -xzf "${archive}" --strip-components=1 -C "${temporary_directory}"; then
    echo "Failed to extract the verified Node ${version} build runtime." >&2
    rm -rf -- "${temporary_directory}"
    return 1
  fi
  if [[ "$("${temporary_directory}/bin/node" --version)" != "v${version}" ]]; then
    echo "The verified Node ${version} build runtime could not run on this host." >&2
    rm -rf -- "${temporary_directory}"
    return 1
  fi

  export PATH="${temporary_directory}/bin:${PATH}"
  hash -r
  echo "Using Node $(node --version) for the release build."
}

verus_use_build_node
