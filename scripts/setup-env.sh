#!/bin/bash

# Check for nvm.
if [ -f "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
fi

if ! command -v nvm &> /dev/null; then
  echo "nvm not found, please install nvm before trying again"
  exit 1
fi

# Setup Node 20 and yarn.
nvm install 20
npm install -g yarn

# Setup Node 24 and pnpm.
nvm install 24.15.0
npm install -g pnpm@11.4.0
