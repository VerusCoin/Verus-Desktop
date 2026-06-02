#!/bin/bash

FULL_PATH=$(dirname $0)

${FULL_PATH}/build-gui-and-plugins.sh

# Start the electron app
echo ""
echo "Starting Verus-Desktop..."
pnpm start
