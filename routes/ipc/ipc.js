/*
  Reasonably Secure Electron
  Copyright (C) 2019  Bishop Fox
  This program is free software; you can redistribute it and/or
  modify it under the terms of the GNU General Public License
  as published by the Free Software Foundation; either version 2
  of the License, or (at your option) any later version.
  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.
  You should have received a copy of the GNU General Public License
  along with this program; if not, write to the Free Software
  Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
--------------------------------------------------------------------------
Maps IPC calls to RPC calls, and provides other local operations such as
listing/selecting configs to the sandboxed code.
*/

const { ipcMain, BrowserWindow, IpcMainEvent } = require('electron');
const Ajv = require("ajv").default

class IPCMessage {
  constructor(id, type, method, data) {
    this.id = id;
    this.type = type;
    this.method = method;
    this.data = data
  }
}

// jsonSchema - A JSON Schema decorator, somewhat redundant given we're using TypeScript
// but it provides a stricter method of validating incoming JSON messages than simply
// casting the result of JSON.parse() to an interface.
function jsonSchema(schema) {
  const ajv = new Ajv({allErrors: true});
  schema["additionalProperties"] = false;
  const validate = ajv.compile(schema);
  return (target, propertyKey, descriptor) => {

    const originalMethod = descriptor.value;
    descriptor.value = (arg) => {
      const valid = validate(arg);
      if (valid) {
        return originalMethod(arg);
      } else {
        console.error(validate.errors);
        return Promise.reject(`Invalid schema: ${ajv.errorsText(validate.errors)}`);
      }
    };

    return descriptor;
  };
}

// IPC Methods used to start/interact with the RPCClient
class IPCHandlers {
  //TODO: Create IPC handlers and namespaces when appropriate
}

async function dispatchIPC(method, data) {
  console.log(`IPC Dispatch: ${method}`);

  // IPC handlers must start with "namespace_" this helps ensure we do not inadvertently
  // expose methods that we don't want exposed to the sandboxed code.
  if (['msg_'].some(prefix => method.startsWith(prefix))) {
    if (typeof IPCHandlers[method] === 'function') {
      const result = await IPCHandlers[method](data);
      return result;
    } else {
      return Promise.reject(`No handler for method: ${method}`);
    }
  } else {
    return Promise.reject(`Invalid method handler namespace for "${method}"`);
  }
}

function startIPCHandlers(appId) {
  // ipcMain.on(`ipc_${appId}`, async (event, msg) => {
  //   dispatchIPC(msg.method, msg.data).then((result) => {
  //     if (msg.id !== 0) {
  //       event.sender.send('ipc', {
  //         id: msg.id,
  //         type: 'response',
  //         method: 'success',
  //         data: result
  //       });
  //     }
  //   }).catch((err) => {
  //     console.error(`[startIPCHandlers] ${err}`);
  //     if (msg.id !== 0) {
  //       event.sender.send('ipc', {
  //         id: msg.id,
  //         type: 'response',
  //         method: 'error',
  //         data: err.toString()
  //       });
  //     }
  //   });
  // });

  // // This one doesn't have an event argument for some reason ...
  // ipcMain.on(`push_${appId}`, async (_, data) => {
  //   window.webContents.send('ipc', {
  //     id: 0,
  //     type: 'push',
  //     method: '',
  //     data: data
  //   });
  // });
}

function pushMessage(window, data, method) {
  window.webContents.send('ipc', {
    id: 0,
    type: 'push',
    method: method,
    data: data
  });
}

// Message always sent to plugin the first time it is initialized, 
// giving it the port of the main process rpc server, the ip of the 
// main process rpc server, and the appId the plugin was assigned
function initMessage(window, serverPort, appId, rpcExpiryMargin, encryptPost) {
  window.webContents.send('ipc', {
    id: 0,
    type: 'init',
    method: '',
    data: {
      rpc_port: serverPort,
      app_id: appId,
      expiry_margin: rpcExpiryMargin,
      post_encryption: encryptPost,
      window_id: window.id
    }
  });
}

module.exports = {
  startIPCHandlers,
  IPCMessage,
  pushMessage,
  initMessage
}