#!/bin/bash

FULL_PATH=$(dirname $0)

source ${FULL_PATH}/directories.sh
${FULL_PATH}/setup-node.sh

# Build the desktop GUI
(
  echo ""
  echo "Building Verus-Desktop-GUI..."
  export NODE_OPTIONS=--openssl-legacy-provider
  cd ${GUI_DIR}
  yarn build
)

# Build and copy the login consent client if it exists
if [ -d "${LOGIN_CONSENT_CLIENT_DIR}" ]; then
  echo ""
  echo "Building verus-login-consent-client..."
  (
    cd ${LOGIN_CONSENT_CLIENT_DIR}
    yarn build
  )

  # Copy the build files over
  echo ""
  echo "Copying the build of verus-login-consent-client..."
  if [ ! -d "${LOGIN_CONSENT_CLIENT_PLUGIN_DIR}" ]; then
    mkdir -p ${LOGIN_CONSENT_CLIENT_PLUGIN_DIR}
  fi
  cp -r ${LOGIN_CONSENT_CLIENT_DIR}/build/* ${LOGIN_CONSENT_CLIENT_PLUGIN_DIR}
fi

# Build and copy the pbaas visualizer if it exists
if [ -d "${PBAAS_VISUALIZER_DIR}" ]; then
  echo ""
  echo "Building verus-pbaas-visualizer..."
  (
    export NODE_OPTIONS=--openssl-legacy-provider
    cd ${PBAAS_VISUALIZER_DIR}
    yarn build
  )

  # Copy the build files over
  echo ""
  echo "Copying the build of verus-pbaas-visualizer..."
  if [ ! -d "${PBAAS_VISUALIZER_PLUGIN_DIR}" ]; then
    mkdir -p ${PBAAS_VISUALIZER_PLUGIN_DIR}
  fi
  cp -r ${PBAAS_VISUALIZER_DIR}/build/* ${PBAAS_VISUALIZER_PLUGIN_DIR}
fi