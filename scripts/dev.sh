#!/bin/bash

FULL_PATH=$(dirname $0)

source $FULL_PATH/directories.sh
$FULL_PATH/setup-node.sh

# Start desktop GUI
(
  echo "Starting Verus-Desktop-GUI..."
  export NODE_OPTIONS=--openssl-legacy-provider
  cd $GUI_DIR
  yarn start-no-dashboard
) &

# Check if the login consent client exists and start it if possible
if [ -d "$LOGIN_CONSENT_CLIENT_DIR" ]; then
  (
    echo "Starting verus-login-consent-client..."
    cd $LOGIN_CONSENT_CLIENT_DIR
    yarn start
  ) &
fi

# Check if the pbass visualizer exists and start it if possible
if [ -d "$PBAAS_VISUALIZER_DIR" ]; then
  (
    echo "Starting verus-pbaas-visualizer..."
    export NODE_OPTIONS=--openssl-legacy-provider
    cd $PBAAS_VISUALIZER_DIR
    # Discard the webpack dashboard output to not clutter the terminal
    yarn start > /dev/null 2>&1
  ) &
fi

# Start the electron app in development mode
echo "Starting Verus-Desktop..."
yarn start devmode

cleanup() {
  echo "Cleaning up processes..."
  jobs -p | xargs kill

  # Give the login consent client time to close gracefully
  sleep 1
}

trap cleanup EXIT