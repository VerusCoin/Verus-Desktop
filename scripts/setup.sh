#!/bin/bash

set -e
set -o pipefail

FULL_PATH=$(dirname $0)

source $FULL_PATH/directories.sh
$FULL_PATH/setup-node.sh

# Install dependencies for the desktop GUI
(
  echo "Installing dependencies for Verus-Desktop-GUI..."
  export NODE_OPTIONS=--openssl-legacy-provider
  cd $GUI_DIR
  yarn install
)

# Check if the login consent client exists and install dependencies if possible
if [ -d "$LOGIN_CONSENT_CLIENT_DIR" ]; then
  (
    echo "Installing dependencies for verus-login-consent-client..."
    cd $LOGIN_CONSENT_CLIENT_DIR
    yarn install
  )
fi

# Check if the pbass visualizer exists and install dependencies if possible
if [ -d "$PBAAS_VISUALIZER_DIR" ]; then
  (
    echo "Installing dependencies for verus-pbaas-visualizer..."
    export NODE_OPTIONS=--openssl-legacy-provider
    cd $PBAAS_VISUALIZER_DIR
    yarn install
  )
fi

# Install dependencies for the electron app
echo "Installing dependencies for Verus-Desktop..."
yarn install