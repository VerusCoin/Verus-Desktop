/*
MIT License

Copyright (c) 2017 Yuki Akiyama
Copyright (c) 2017 - 2019 SuperNET

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

const tls = require('tls');
const net = require('net');
const EventEmitter = require('events').EventEmitter;
const MAX_MESSAGE_BUFFER = 8 * 1024 * 1024;
const MAX_MESSAGES_PER_CHUNK = 1000;
const MAX_PENDING_REQUESTS = 1000;
const ALLOWED_SUBSCRIPTIONS = new Set([
  "server.peers.subscribe",
  "blockchain.numblocks.subscribe",
  "blockchain.headers.subscribe",
  "blockchain.address.subscribe",
  "blockchain.scripthash.subscribe",
]);
// Verus ElectrumX servers send these empty, ID-less capability hints while
// servicing longer requests. They do not carry data or update client state.
const IGNORED_EMPTY_NOTIFICATIONS = new Set([
  "blockchain.estimatefee",
  "blockchain.relayfee",
]);

const makeRequest = (method, params, id) => {
  return JSON.stringify({
    jsonrpc: '2.0',
    method,
    params,
    id,
  });
}

const createRecursiveParser = (maxDepth, delimiter) => {
  const MAX_DEPTH = maxDepth;
  const DELIMITER = delimiter;
  const recursiveParser = (n, buffer, callback) => {
    if (buffer.length === 0) {
      return {
        code: 0,
        buffer: buffer,
      };
    }

    if (n > MAX_DEPTH) {
      return {
        code: 1,
        buffer: buffer,
      };
    }

    const xs = buffer.split(DELIMITER);

    if (xs.length === 1) {
      return {
        code: 0,
        buffer: buffer,
      };
    }

    callback(xs.shift(), n);

    return recursiveParser(n + 1, xs.join(DELIMITER), callback);
  }

  return recursiveParser;
}

const createPromiseResult = (resolve, reject, method) => {
  return (err, result) => {
    if (err) {
      console.log(`electrum error for ${method}:`);
      console.log(err);
      //resolve(err);
      reject(err);
    } else {
      resolve(result);
    }
  }
}

const isObjectResult = (result) =>
  result != null && typeof result === "object" && !Array.isArray(result);

const isValidResultForMethod = (method, result) => {
  switch (method) {
  case "server.version":
    return typeof result === "string" || Array.isArray(result);
  case "server.banner":
  case "server.donation_address":
  case "blockchain.block.header":
  case "blockchain.block.get_chunk":
  case "blockchain.transaction.broadcast":
    return typeof result === "string";
  case "server.peers.subscribe":
  case "blockchain.address.get_history":
  case "blockchain.scripthash.get_history":
  case "blockchain.address.get_mempool":
  case "blockchain.address.listunspent":
  case "blockchain.scripthash.listunspent":
    return Array.isArray(result);
  case "blockchain.address.get_balance":
  case "blockchain.scripthash.get_balance":
  case "blockchain.block.get_header":
  case "blockchain.headers.subscribe":
  case "blockchain.transaction.get_merkle":
    return isObjectResult(result);
  case "blockchain.estimatefee":
  case "blockchain.relayfee":
    return typeof result === "number" && Number.isFinite(result);
  case "server.ping":
    return result === null;
  case "blockchain.transaction.get":
    return typeof result === "string" || isObjectResult(result);
  default:
    return result !== undefined;
  }
};

class MessageParser {
  constructor(callback, maxBufferLength = MAX_MESSAGE_BUFFER) {
    this.buffer = '';
    this.callback = callback;
    this.maxBufferLength = maxBufferLength;
  }

  run(chunk) {
    this.buffer += String(chunk);
    if (this.buffer.length > this.maxBufferLength) {
      throw new Error("Electrum response exceeded the maximum message buffer");
    }

    let delimiterIndex;
    let parsedMessages = 0;
    while ((delimiterIndex = this.buffer.indexOf("\n")) !== -1) {
      if (++parsedMessages > MAX_MESSAGES_PER_CHUNK) {
        throw new Error("Electrum server sent too many messages in one chunk");
      }
      const body = this.buffer.slice(0, delimiterIndex);
      this.buffer = this.buffer.slice(delimiterIndex + 1);
      this.callback(body, parsedMessages - 1);
    }
  }
}

const util = {
  makeRequest,
  createRecursiveParser,
  createPromiseResult,
  MessageParser,
};

const getSocket = (protocol, host, port, options = {}) => {
  switch (protocol) {
  case 'tcp':
    return net.createConnection({ host, port });
  case 'tls':
  case 'ssl':
    return tls.connect({
      ...options,
      host,
      port,
      servername: net.isIP(host) ? undefined : host,
      rejectUnauthorized: true,
      checkServerIdentity: tls.checkServerIdentity,
    });
  }

  throw new Error('unknown protocol');
}

const initSocket = (self, protocol, socketTimeout, options) => {
  const conn = getSocket(protocol, self.host, self.port, options);

  conn.setTimeout(socketTimeout);
  conn.on('timeout', () => {
    console.log('socket timeout');
    self.onError(new Error('socket timeout'));
  });
  conn.setEncoding('utf8');
  conn.setKeepAlive(true, 0);
  conn.setNoDelay(true);
  conn.on('close', (e) => {
    self.onClose(e);
  });
  conn.on('data', (chunk) => {
    self.onReceive(chunk);
  });
  conn.on('end', (e) => {
    self.onEnd(e);
  });
  conn.on('error', (e) => {
    self.onError(e);
  });

  return conn;
}

class Client {
  constructor(port, host, protocol = 'tcp', socketTimeout = 10000, options = void 0) {
    this.id = 0;
    this.port = port;
    this.host = host;
    this.protocol = protocol;
    this.socketTimeout = socketTimeout;
    this.socketOptions = options || {};
    this.protocolVersion = null;
    this.callbackMessageQueue = {};
    this.subscribe = new EventEmitter();
    this.conn = null;
    this.mp = new util.MessageParser((body, n) => {
      this.onMessage(body, n);
    });
    this.status = 0;
    this.connectPromise = null;
  }

  setProtocolVersion(version) {
    this.protocolVersion = version;
  }

  connect() {
    if (this.status === 2) {
      return Promise.resolve();
    }
    if (this.status === 1 && this.connectPromise) return this.connectPromise;

    this.status = 1;
    this.connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      const rejectConnection = (error) => {
        if (settled) return;
        settled = true;
        this.status = 0;
        reject(error);
      };
      const readyEvent = this.protocol === "tcp" ? "connect" : "secureConnect";
      const closeBeforeReady = () => rejectConnection(new Error("Electrum connection closed before it was ready"));

      try {
        this.conn = initSocket(this, this.protocol, this.socketTimeout, this.socketOptions);
      } catch (e) {
        rejectConnection(e);
        return;
      }

      this.conn.once("error", rejectConnection);
      this.conn.once("close", closeBeforeReady);
      this.conn.once(readyEvent, () => {
        if (settled) return;
        if (this.protocol !== "tcp" && !this.conn.authorized) {
          return rejectConnection(
            this.conn.authorizationError || new Error("Electrum TLS certificate was not authorized")
          );
        }

        settled = true;
        this.conn.removeListener("error", rejectConnection);
        this.conn.removeListener("close", closeBeforeReady);
        // The configured timeout applies to handshakes and individual requests,
        // not to healthy pooled connections while they are idle.
        this.conn.setTimeout(0);
        this.status = 2;
        this.onConnect();
        resolve();
      });
    });
    return this.connectPromise.finally(() => {
      this.connectPromise = null;
    });
  }

  close() {
    this.status = 0;
    if (this.conn) {
      this.conn.destroy();
      this.conn = null;
    }
    this.onClose();
  }

  request(method, params) {
    if (this.status !== 2 || !this.conn) {
      return Promise.reject(new Error('Connection error'));
    }
    if (typeof method !== "string" || !/^[a-z0-9._]{1,128}$/i.test(method) || !Array.isArray(params)) {
      return Promise.reject(new Error("Invalid Electrum request"));
    }
    if (Object.keys(this.callbackMessageQueue).length >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new Error("Too many pending Electrum requests"));
    }

    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const content = util.makeRequest(method, params, id);

      this.callbackMessageQueue[id] = {
        callback: util.createPromiseResult(resolve, reject, method),
        method,
        timeout: null,
      };
      this.callbackMessageQueue[id].timeout = setTimeout(() => {
        const pending = this.callbackMessageQueue[id];
        if (!pending) return;

        delete this.callbackMessageQueue[id];
        pending.callback(new Error(`Electrum request timed out: ${method}`));
        this.close();
      }, this.socketTimeout);

      try {
        this.conn.write(`${content}\n`);
      } catch (e) {
        clearTimeout(this.callbackMessageQueue[id].timeout);
        delete this.callbackMessageQueue[id];
        reject(e);
        this.close();
      }
    });
  }

  response(msg) {
    if (!Number.isSafeInteger(msg.id) || msg.id <= 0) {
      throw new Error("Invalid Electrum response id");
    }
    const pending = this.callbackMessageQueue[msg.id];

    if (pending) {
      const hasError = Object.prototype.hasOwnProperty.call(msg, "error") && msg.error != null;
      const hasResult = Object.prototype.hasOwnProperty.call(msg, "result");
      if (hasError === hasResult) throw new Error(`Invalid response for ${pending.method}`);
      if (hasResult && !isValidResultForMethod(pending.method, msg.result)) {
        throw new Error(`Unexpected result type for ${pending.method}`);
      }
      clearTimeout(pending.timeout);
      delete this.callbackMessageQueue[msg.id];
      if (hasError) pending.callback(msg.error);
      else pending.callback(null, msg.result);
    } else {
      throw new Error("Electrum response did not match a pending request");
    }
  }

  onMessage(body, n) {
    try {
      const msg = JSON.parse(body);
      if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
        throw new Error("Invalid Electrum JSON-RPC message");
      }

      if (msg.id !== void 0) {
        this.response(msg);
      } else {
        const isKnownEmptyNotification =
          msg.jsonrpc === "2.0" &&
          IGNORED_EMPTY_NOTIFICATIONS.has(msg.method) &&
          msg.params === undefined &&
          Object.keys(msg).every((key) => key === "jsonrpc" || key === "method");
        if (isKnownEmptyNotification) return;

        if (!ALLOWED_SUBSCRIPTIONS.has(msg.method) || !Array.isArray(msg.params)) {
          throw new Error("Unexpected Electrum subscription event");
        }
        this.subscribe.emit(msg.method, msg.params);
      }
    } catch (e) {
      this.onProtocolError(e);
    }
  }

  onConnect() {
  }

  onClose() {
    this.status = 0;
    Object.keys(this.callbackMessageQueue).forEach((key) => {
      clearTimeout(this.callbackMessageQueue[key].timeout);
      this.callbackMessageQueue[key].callback(new Error('close connect'));
      delete this.callbackMessageQueue[key];
    });
  }

  onReceive(chunk) {
    try {
      this.mp.run(chunk);
    } catch (e) {
      this.onProtocolError(e);
    }
  }

  onEnd() {
  }

  onProtocolError(e) {
    this.close();
  }

  onError(e) {
    this.close();
  }
}

class ElectrumJSCore extends Client {
  constructor(port, host, protocol, timeout, options) {
    super(port, host, protocol, timeout, options);
  }

  onClose() {
    super.onClose();
    const list = [
      'server.peers.subscribe',
      'blockchain.numblocks.subscribe',
      'blockchain.headers.subscribe',
      'blockchain.address.subscribe'
    ];

    list.forEach(event => this.subscribe.removeAllListeners(event));
  }

  // ref: http://docs.electrum.org/en/latest/protocol.html
  serverVersion(client_name, protocol_version) {
    let params = [];
    if (client_name) params.push(client_name);
    else params.push('');

    if (protocol_version) params.push(protocol_version.toString());

    return this.request('server.version', params);
  }

  serverPing() {
    return this.request('server.ping', []);
  }

  serverBanner() {
    return this.request('server.banner', []);
  }

  serverDonationAddress() {
    return this.request('server.donation_address', []);
  }

  serverPeersSubscribe() {
    return this.request('server.peers.subscribe', []);
  }

  blockchainAddressGetBalance(str) {
    return this.request(this.protocolVersion && this.protocolVersion === '1.4' ? 'blockchain.scripthash.get_balance' : 'blockchain.address.get_balance', [str]);
  }

  blockchainAddressGetHistory(str) {
    return this.request(this.protocolVersion && this.protocolVersion === '1.4' ? 'blockchain.scripthash.get_history' : 'blockchain.address.get_history', [str]);
  }

  blockchainAddressGetMempool(address) {
    return this.request('blockchain.address.get_mempool', [address]);
  }

  blockchainAddressListunspent(str) {
    return this.request(this.protocolVersion && this.protocolVersion === '1.4' ? 'blockchain.scripthash.listunspent' : 'blockchain.address.listunspent', [str]);
  }

  blockchainBlockGetHeader(height) {
    return this.request(this.protocolVersion && this.protocolVersion === '1.4' ? 'blockchain.block.header' : 'blockchain.block.get_header', [height]);
  }

  blockchainBlockGetChunk(index) {
    return this.request('blockchain.block.get_chunk', [index]);
  }

  blockchainEstimatefee(number) {
    return this.request('blockchain.estimatefee', [number]);
  }

  blockchainHeadersSubscribe() {
    return this.request('blockchain.headers.subscribe', []);
  }

  blockchainRelayfee() {
    return this.request('blockchain.relayfee', []);
  }

  blockchainTransactionBroadcast(rawtx) {
    return this.request('blockchain.transaction.broadcast', [rawtx]);
  }

  blockchainTransactionGet(tx_hash, verbose) {
    return this.request('blockchain.transaction.get', verbose ? [tx_hash, true] : [tx_hash]);
  }

  blockchainTransactionGetMerkle(tx_hash, height) {
    return this.request('blockchain.transaction.get_merkle', [tx_hash, height]);
  }
}

ElectrumJSCore.MessageParser = MessageParser;
ElectrumJSCore.ALLOWED_SUBSCRIPTIONS = ALLOWED_SUBSCRIPTIONS;
ElectrumJSCore.IGNORED_EMPTY_NOTIFICATIONS = IGNORED_EMPTY_NOTIFICATIONS;
ElectrumJSCore.isValidResultForMethod = isValidResultForMethod;

module.exports = ElectrumJSCore;
