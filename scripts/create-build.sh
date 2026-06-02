#!/bin/bash

FULL_PATH=$(dirname $0)

${FULL_PATH}/build-gui-and-plugins.sh

# Build the the electron app
echo ""
echo "Building Verus-Desktop..."
pnpm dist
