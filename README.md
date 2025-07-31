# Verus Desktop Wallet

The Verus Multicoin Wallet and Ecosystem GUI

## Build & Installation

### Prerequisites

1) [Node.js](https://nodejs.org/en/download/)
    - **Note:** Node.js 20.x is recommended. Node.js 22 and higher are **not supported**
2) [Yarn](https://yarnpkg.com/getting-started/install)
3) [Git](https://git-scm.com/)

### Getting the Code

Clone the Verus Desktop repository and the GUI submodule:
```bash
git clone --recursive --branch master https://github.com/VerusCoin/Verus-Desktop
```

### Verus Desktop GUI Setup

The GUI requires the `NODE_OPTIONS=--openssl-legacy-provider` environment variable.

**Note:** This variable is only for building the GUI, not for running Verus Desktop. It will cause an error when trying to run Verus Desktop.


Open a new terminal window or tab and run:
```bash
export NODE_OPTIONS=--openssl-legacy-provider
cd Verus-Desktop/gui/Verus-Desktop-GUI/react/
yarn install
yarn build
```

This will build the GUI for later use.

**Continue the next steps in a new terminal window or tab to avoid issues with the environment variable.**

### Verus Desktop Setup

To set up Verus Desktop, you’ll need to add the required binaries and any plugins you wish to use.

#### Verus Daemon

Verus Desktop needs the Verus CLI binaries. You can download them from [https://verus.io/wallet](https://verus.io/wallet).

From the `Verus-Desktop` directory, create the following folder structure for your operating system:

- **Linux**: `assets/bin/linux64/verusd`
- **macOS**: `assets/bin/osx/verusd`
- **Windows**: `assets/bin/win64/verusd`

Copy both `verusd` and `verus-cli` into the appropriate folder (e.g. `assets/bin/linux64/verusd/`).

#### Plugins

There are two built-in plugins:

- [Verus Login Consent Client](https://github.com/VerusCoin/verus-login-consent-client)
- [Verus PBaaS Visualizer](https://github.com/VerusCoin/verus-pbaas-visualizer)

To add these plugins to Verus Desktop

1. Clone them anywhere on your system:
    ```bash
    git clone https://github.com/VerusCoin/verus-login-consent-client
    git clone https://github.com/VerusCoin/verus-pbaas-visualizer
    ```

2. Generate builds:
    ```bash
    yarn install
    yarn build
    ```
    This will generate a `/build` directory inside each plugin project.

3. Create the following folders in your Verus Desktop project:
    - `Verus-Desktop/assets/plugins/builtin/verus-login-consent-client/`
    - `Verus-Desktop/assets/plugins/builtin/verus-pbaas-visualizer/`

    Then copy the contents of each plugin's `/build` directory into its corresponding folder. 
    
    For example, copy all the files from `verus-login-consent-client/build/` into `Verus-Desktop/assets/plugins/builtin/verus-login-consent-client/`.


The plugins are now ready to use.

### Starting Verus Desktop

From the root directory, run:
```shell
yarn install
yarn start
```

This will start the application.

### Bundling & Packaging:

To create a packaged application, run:
```shell
yarn run dist
```

The packaged application will be built and packaged based on your operating system, and located in the `/dist` directory:
| Operating System | Output File Type |
|------------------|------------------|
| Linux            | `.AppImage`      |
| macOS            | `.dmg`           |
| Windows          | `.exe`           |

For more detailed information about the build process, see the original [electron-builder](https://www.electron.build) website.


