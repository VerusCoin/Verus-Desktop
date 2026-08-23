#!/usr/bin/env bash

set -euo pipefail

readonly PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# These values are release inputs, not CI configuration. Keeping them inside
# this reviewed script prevents higher-precedence pipeline variables from
# silently replacing a built-in repository or revision.
readonly LOGIN_CONSENT_REPOSITORY="https://github.com/VerusCoin/verus-login-consent-client.git"
readonly LOGIN_CONSENT_COMMIT="3ec11d7604245f622b9a4ad992db785e9389c3cc"
readonly LOGIN_CONSENT_PATCH_SHA256="974c0a42acf04725206b8579fb503894349f13b3c551bf03838d8fea3f37b1c6"
readonly PBAAS_VISUALIZER_REPOSITORY="https://github.com/VerusCoin/verus-pbaas-visualizer.git"
readonly PBAAS_VISUALIZER_COMMIT="02a8b2914279e698370728cd1c6b64ec1360656e"
readonly PBAAS_VISUALIZER_PATCH_SHA256="e588f1587aa9212e7d58b0813239763fe57f01f8dc32d749efc12d52549bf79a"

validate_commit() {
  local name="$1"
  local commit="$2"

  if [[ ! "${commit}" =~ ^[0-9a-f]{40}$ ]]; then
    echo "${name} must be pinned to a full, lowercase 40-character Git commit." >&2
    exit 1
  fi
}

validate_sha256() {
  local name="$1"
  local digest="$2"

  if [[ ! "${digest}" =~ ^[0-9a-f]{64}$ ]]; then
    echo "${name} must be a full, lowercase SHA-256 digest." >&2
    exit 1
  fi
}

sha256_file() {
  node -e 'const crypto = require("crypto"); const fs = require("fs"); process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"
}

verify_build_output() {
  local name="$1"
  local build_dir="$2"
  local index_file="${build_dir}/index.html"

  if [[ ! -f "${index_file}" ]]; then
    echo "${name} did not produce its required build/index.html." >&2
    exit 1
  fi
  if grep -Fq "'unsafe-eval'" "${index_file}"; then
    echo "${name} build/index.html weakens CSP with unsafe-eval." >&2
    exit 1
  fi
  if ! grep -Fq 'http-equiv="Content-Security-Policy"' "${index_file}" ||
    ! grep -Fq "script-src 'self';" "${index_file}" ||
    ! grep -Fq "connect-src 'self';" "${index_file}"; then
    echo "${name} build/index.html is missing the required script-src 'self' meta CSP." >&2
    exit 1
  fi
  if [[ -n "$(find "${build_dir}" -type f -name '*.map' -print -quit)" ]]; then
    echo "${name} emitted a production source map." >&2
    exit 1
  fi
  if [[ -n "$(find "${build_dir}" -type l -print -quit)" ]]; then
    echo "${name} emitted a symbolic link instead of a self-contained build file." >&2
    exit 1
  fi
  if grep -R -I -q -E '(^|[^[:alnum:]_$])eval[[:space:]]*\(' "${build_dir}" ||
    grep -R -I -q -F 'sourceURL=webpack://' "${build_dir}"; then
    echo "${name} emitted an eval-based Webpack wrapper." >&2
    exit 1
  fi
}

build_builtin() {
  local name="$1"
  local repository="$2"
  local commit="$3"
  local expected_patch_sha256="$4"
  local checkout_dir="${BUILD_SOURCE_ROOT}/${name}"
  local output_dir="${PROJECT_ROOT}/assets/plugins/builtin/${name}"
  local security_patch="${PROJECT_ROOT}/scripts/patches/${name}-csp.patch"
  local actual_commit
  local actual_patch_sha256
  local build_node_options="${NODE_OPTIONS:-}"
  local reviewed_lock_sha256

  if [[ ! -f "${security_patch}" ]]; then
    echo "Missing required renderer security patch for ${name}." >&2
    exit 1
  fi

  actual_patch_sha256="$(sha256_file "${security_patch}")"
  if [[ "${actual_patch_sha256}" != "${expected_patch_sha256}" ]]; then
    echo "Security patch SHA-256 mismatch for ${name}: got ${actual_patch_sha256}; expected ${expected_patch_sha256}." >&2
    exit 1
  fi

  echo "Building ${name} from ${repository}@${commit}"
  git clone --no-checkout "${repository}" "${checkout_dir}"
  git -C "${checkout_dir}" checkout --detach "${commit}"

  actual_commit="$(git -C "${checkout_dir}" rev-parse HEAD)"
  if [[ "${actual_commit}" != "${commit}" ]]; then
    echo "Resolved ${name} to ${actual_commit}; expected ${commit}." >&2
    exit 1
  fi

  if [[ ! -f "${checkout_dir}/yarn.lock" ]]; then
    echo "Pinned ${name} source ${commit} does not contain the required yarn.lock." >&2
    exit 1
  fi
  # The patch is intentionally applied only after verifying the exact source
  # revision. A changed upstream tree must fail here and be reviewed rather
  # than silently producing an eval-based bundle that the packaged CSP blocks.
  git -C "${checkout_dir}" apply --check "${security_patch}"
  git -C "${checkout_dir}" apply "${security_patch}"
  git -C "${checkout_dir}" diff --check

  if grep -Eq '"node-sass"[[:space:]]*:' "${checkout_dir}/package.json"; then
    echo "${name} still depends on native node-sass and cannot be built portably." >&2
    exit 1
  fi
  if ! grep -Eq '"sass"[[:space:]]*:[[:space:]]*"1\.77\.8"' "${checkout_dir}/package.json"; then
    echo "${name} is missing the reviewed, exact Dart Sass dependency." >&2
    exit 1
  fi
  if ! grep -Fq '<% if (isProduction)' "${checkout_dir}/www/index.html"; then
    echo "${name} must apply its file-renderer CSP only to production output." >&2
    exit 1
  fi
  reviewed_lock_sha256="$(sha256_file "${checkout_dir}/yarn.lock")"

  if [[ " ${build_node_options} " != *" --openssl-legacy-provider "* ]]; then
    build_node_options="${build_node_options:+${build_node_options} }--openssl-legacy-provider"
  fi

  (
    cd "${checkout_dir}"
    yarn install --frozen-lockfile --non-interactive
    if [[ "$(sha256_file yarn.lock)" != "${reviewed_lock_sha256}" ]]; then
      echo "Frozen dependency install changed ${name}/yarn.lock." >&2
      exit 1
    fi
    NODE_OPTIONS="${build_node_options}" NODE_ENV=production yarn run build
  )

  if [[ ! -d "${checkout_dir}/build" ]]; then
    echo "${name} did not produce its expected build directory." >&2
    exit 1
  fi
  verify_build_output "${name}" "${checkout_dir}/build"

  if ! grep -R -I -q -F "/builtin/${name}/index.html" "${checkout_dir}/build"; then
    echo "${name} did not bind IPC to its exact packaged loopback entry point." >&2
    exit 1
  fi

  if [[ "${name}" == "verus-login-consent-client" ]]; then
    if ! grep -R -I -q -F 'submit_id_provisioning_request' "${checkout_dir}/build" ||
      ! grep -R -I -q -F 'get_id_provisioning_status' "${checkout_dir}/build" ||
      ! grep -R -I -q -F 'provisioning_capability' "${checkout_dir}/build"; then
      echo "${name} did not route HTTPS provisioning through the hardened backend transport." >&2
      exit 1
    fi
  fi

  mkdir -p "${output_dir}"
  find "${output_dir}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  cp -R "${checkout_dir}/build/." "${output_dir}/"
}

main() {
  validate_commit "LOGIN_CONSENT_COMMIT" "${LOGIN_CONSENT_COMMIT}"
  validate_commit "PBAAS_VISUALIZER_COMMIT" "${PBAAS_VISUALIZER_COMMIT}"
  validate_sha256 "LOGIN_CONSENT_PATCH_SHA256" "${LOGIN_CONSENT_PATCH_SHA256}"
  validate_sha256 "PBAAS_VISUALIZER_PATCH_SHA256" "${PBAAS_VISUALIZER_PATCH_SHA256}"

  BUILD_SOURCE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/verus-desktop-builtins.XXXXXX")"
  readonly BUILD_SOURCE_ROOT
  trap 'rm -rf -- "${BUILD_SOURCE_ROOT}"' EXIT

  build_builtin \
    "verus-login-consent-client" \
    "${LOGIN_CONSENT_REPOSITORY}" \
    "${LOGIN_CONSENT_COMMIT}" \
    "${LOGIN_CONSENT_PATCH_SHA256}"

  build_builtin \
    "verus-pbaas-visualizer" \
    "${PBAAS_VISUALIZER_REPOSITORY}" \
    "${PBAAS_VISUALIZER_COMMIT}" \
    "${PBAAS_VISUALIZER_PATCH_SHA256}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
