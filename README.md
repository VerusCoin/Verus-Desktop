# Verus Desktop

The Verus Multicoin Wallet and Ecosystem desktop application

## Development Prerequisites

### Required Software

1) [Node.js](https://nodejs.org/en/download/)
    - **Note:** Node.js 20.x is recommended. Node.js 22 and higher are **not supported**.
2) [Yarn](https://yarnpkg.com/getting-started/install)
3) [Git](https://git-scm.com/)
4) [Verus CLI](https://verus.io/wallet)  (`verus` and `verusd` binaries)

### Cloning the Repository and Optional Plugins

Clone the Verus Desktop repository and the GUI submodule:
```bash
git clone --recursive https://github.com/VerusCoin/Verus-Desktop
```

#### Optional Plugins

Optional plugins can be cloned into the same directory level as the Verus Desktop folder.

The [Verus Login Consent Client](https://github.com/VerusCoin/verus-login-consent-client) is needed to handle deeplinks, including login.
```bash
git clone https://github.com/VerusCoin/verus-login-consent-client.git
```

The [Verus PBaaS visualizer](https://github.com/VerusCoin/verus-pbaas-visualizer) provides PBaaS network Visualizations in 3d graphs.
```bash
git clone https://github.com/VerusCoin/verus-pbaas-visualizer.git
```

### Verus Desktop Setup

From the Verus Desktop directory, create the following folder structure for your operating system:

| Operating System | Path                        |
|------------------|-----------------------------|
| Linux            | `assets/bin/linux64/verusd/`|
| macOS            | `assets/bin/osx/verusd/`    |
| Windows          | `assets/bin/win64/verusd/`  |

Copy both `verus` and `verusd` binaries into the appropriate folder (e.g. `assets/bin/linux64/verusd/`).

#### Deeplinks

Deeplinks require running a production build at least once. After that, you can run Verus Desktop in any mode and still have the deeplinks functional.

## Running

Verus Desktop can be run without building to allow for easier development or with building to test for production before packaging the app.

**Important:** Both the GUI and the PBaaS visualizer require the `NODE_OPTIONS=--openssl-legacy-provider` environment variable. This environment variable will cause an error when trying to run Verus Desktop. Make sure to use a **separate terminal** for the GUI and PBaaS visualizer.

### Development Mode (Without Building)

On Linux and macOS, run Verus Desktop with plugins in development mode using a single terminal with:
```bash
yarn install:all
yarn dev:all
```

On Windows, or to run each part separately, follow these steps.

#### GUI

Open a new terminal in the Verus Desktop directory:
```bash
export NODE_OPTIONS=--openssl-legacy-provider
cd gui/Verus-Desktop-GUI/react/
yarn install
```

You can run the GUI in two ways.

1. Without plugins:
    ```bash
    yarn start
    ```

2. With plugins:
    ```bash
    yarn start-no-dashboard
    ```

#### Optional: PBaaS visualizer

Open a new terminal, navigate to the PBaaS visualizer directory:
```bash
export NODE_OPTIONS=--openssl-legacy-provider
yarn install
yarn start
```

#### Optional: Login Consent Client 

Open a new terminal, navigate to the Login Consent Client directory:
```bash
yarn install
yarn start
```

#### Desktop

With the GUI and any optional plugins running, navigate to the Verus Desktop directory:
```bash
yarn install
yarn start devmode
```

#### Debugging

- If you see a blank white window after starting the desktop application, check if the GUI is running.
- If the GUI or PBaaS visualizer fails to start and you get this error:
    
    `Error: error:0308010C:digital envelope routines::unsupported`
    
    This indicates that the required environment variable is not set.
- If the GUI or PBaaS visualizer fails to start and you get this error:

    `Error: listen EADDRINUSE: address already in use :::9838`

    Then run the GUI with `yarn start-no-dashboard` to avoid dashboard conflicts.

- If you get a blank white window after trying to open the PBaaS visualizer, check if the PBaaS visualizer is running.
- If you get a smaller blank white window after using a deeplink, check if the Login Consent Client is running.

### Production Mode (With Building)

On Linux and macOS, run Verus Desktop with plugins using a single terminal with
```bash
yarn install:all
yarn start:all
```

On Windows, or to manually build the components and run Verus Desktop, follow these steps.

#### GUI

Open a new terminal in the Verus Desktop directory:
```bash
export NODE_OPTIONS=--openssl-legacy-provider
cd gui/Verus-Desktop-GUI/react/
yarn install
yarn build
```

#### Optional: PBaaS visualizer

Open a new terminal, navigate to the PBaaS visualizer directory:
```bash
export NODE_OPTIONS=--openssl-legacy-provider
yarn install
yarn build
```

After building, you will find the plugin files in the `/build` directory. Create the folder `assets/plugins/builtin/verus-pbaas-visualizer/` inside your Verus Desktop directory and copy the build files into it.

#### Optional: Login Consent Client 

Open a new terminal, navigate to the Login Consent Client directory:
```bash
yarn install
yarn build
```

After building, you will find the plugin files in the `/build` directory. Create the folder `assets/plugins/builtin/verus-login-consent-client/` inside your Verus Desktop directory and copy the build files into it.

#### Desktop

With the GUI and any optional plugins built, navigate to the Verus Desktop directory:
```bash
yarn install
yarn start
```

#### Debugging

- If you see a blank white window after starting the desktop application, the GUI needs to be built.
- If the GUI or PBaaS visualizer fails to build and you get this error:
    
    `Error: error:0308010C:digital envelope routines::unsupported`
    
    This indicates that the required environment variable is not set.
- If you get a blank white window after trying to open the PBaaS visualizer, the PBaaS visualizer needs to be built.
- If you get a smaller blank white window after using a deeplink, the Login Consent Client needs to be built.


## Creating Builds

| Operating System | File Type  |
|------------------|------------|
| Linux            | `.AppImage`|
| macOS            | `.dmg`     |
| Windows          | `.exe`     |

To create a build from Linux for Windows, you will need either Wine or a [Docker container](https://www.electron.build/multi-platform-build#to-build-app-for-windows-on-linux)

### Using Linux and macOS

On Linux and macOS, package Verus Desktop with plugins using a single terminal with:
```bash
yarn install:all
yarn dist:all
```

The packaged application will be packaged based on your operating system, and located in the `/dist` directory.

To create a build for Windows:
```bash
yarn install:all
yarn dist-win:all
```

### Windows or Manual Builds

To manually build the components and package Verus Desktop, follow these steps.

Build all dependencies, including the GUI and any optional plugins, before packaging the application. See [Production Mode (With Building)](#production-mode-with-building) for how to build. 

Package the application:
```shell
yarn dist-win
```

For manually building on Linux or macOS:
```shell
yarn dist
```

For more detailed information about the build process, see the original [electron-builder](https://www.electron.build) website.