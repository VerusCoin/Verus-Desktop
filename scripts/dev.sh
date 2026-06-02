#!/bin/bash

FULL_PATH=$(dirname $0)

source ${FULL_PATH}/directories.sh

kill_tree() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null
}

cleanup() {
  # In the case where the main Electron process crashes or gets terminated,
  # give the webpack servers extra time to finish before killing them
  sleep 5
  echo "Cleaning up processes..."
  for pid in $(jobs -p); do
    kill_tree "$pid"
  done

  # Give the login consent client time to close gracefully
  sleep 1
}

trap cleanup EXIT INT TERM

# Start desktop GUI
(
  echo ""
  echo "Starting Verus-Desktop-GUI..."
  source ${FULL_PATH}/setup-node.sh
  export NODE_OPTIONS=--openssl-legacy-provider
  cd ${GUI_DIR}
  yarn start-no-dashboard
) &

# Check if the login consent client exists and start it if possible
if [ -d "${LOGIN_CONSENT_CLIENT_DIR}" ]; then
  (
    echo ""
    echo "Starting verus-login-consent-client..."
    cd ${LOGIN_CONSENT_CLIENT_DIR}
    pnpm start
  ) &
fi

# Check if the pbaas visualizer exists and start it if possible
if [ -d "${PBAAS_VISUALIZER_DIR}" ]; then
  (
    echo ""
    echo "Starting verus-pbaas-visualizer..."
    source ${FULL_PATH}/setup-node.sh
    export NODE_OPTIONS=--openssl-legacy-provider
    cd ${PBAAS_VISUALIZER_DIR}
    # Discard the webpack dashboard output to not clutter the terminal
    yarn start > /dev/null 2>&1
  ) &
fi

echo ""
echo "Starting Verus-Desktop..."
pnpm debug
