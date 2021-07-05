### This is experimental and unfinished software. Use at your own risk! No warranty for any kind of damage!

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

# Verus Wallet
The Verus Multicoin Wallet and Ecosystem GUI

## Build & Installation

#### Prerequirements:

1) [Install yarn](https://yarnpkg.com/)

2) [Install git](https://git-scm.com/)


#### Build & Start Verus-Desktop-GUI (frontend)

```shell
git clone --recursive https://github.com/VerusCoin/Verus --branch master --single-branch
cd Verus/gui/Verus-Desktop-GUI/react/
yarn install 
```
Leave the above process running and use a new terminal windows/tab when proceeding with the below steps.

Now please create a directory called `bin` inside `assets/` and afterwards copy `komodod` and `komodo-cli` to a new subfolder named after the operating system you are building Agama for: `linux64`, `osx` or `win64`. Inside this subfolder, create another directory called `verusd`
and copy `verusd` and `verus-cli` into it.

From within `Verus/` the structure will be `assets/bin/linux64` (for example on linux).


#### Start Verus App (electron)

```shell
cd Verus
yarn install
yarn start
```
To use debug/dev mode please stop the Verus App (electron) and either set `dev: true` and `debug: true` in `~/.verus/config.json` and then restart the app or replace step 3) from above with the start command below:

```shell
yarn start devmode
```

You are ready to dev!


## Bundling & packaging:

```shell
yarn run dist
```
We refer to the original [electron-builder](https://www.electron.build) website for more detailed information and further documentation.


