#!/bin/bash

# Try to switch to node 20 using nvm if possible
. ~/.nvm/nvm.sh

# When running with yarn, this inserts the switched to node version's bin before previous version
# that yarn inserts. This allows for using the switched version of node with yarn.
if nvm use 20 && [ -n "${NVM_BIN}" ]; then
  export PATH="${NVM_BIN}:${PATH}"
fi
