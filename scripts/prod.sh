#!/bin/bash

FULL_PATH=$(dirname $0)

${FULL_PATH}/setup-node.sh

${FULL_PATH}/build-gui-and-plugins.sh

# Start the electron app
echo ""
echo "Starting Verus-Desktop..."
yarn start