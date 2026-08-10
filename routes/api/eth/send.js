const ethers = require('ethers');
const { scientificToDecimal } = require('../numbers');
const Web3Interface = require('../utils/web3/web3Interface');

// speed: slow, average, fast
module.exports = (api) => {  
  /**
   * Preflights an ETH tx
   * @param {String} address 
   * @param {String} amount 
   * @param {Object} params 
   * @returns Object
   */
  api.eth.txPreflight = async (address, amount, params = {}) => {
    if (api.eth.interface == null) {
      throw new Error('No interface to connect to ETH for tx preflight call')
    } else if (api.eth.wallet == null) {
      throw new Error('No ETH wallet authenticated to use for tx preflight call')
    }

    const fromAddress = api.eth.wallet.address
    const signer = new ethers.VoidSigner(fromAddress, api.eth.interface.EtherscanProvider)
    const balance = await api.eth.interface.DefaultProvider.getBalance(fromAddress)
    const value = ethers.parseEther(scientificToDecimal(amount))

    let transaction = {}

    try {
      transaction = await signer.populateTransaction({
        to: address,
        from: fromAddress,
        value,
        chainId: api.eth.interface.network.id,
        gasLimit: BigInt(42000)
      });
    } catch(e) {  
      api.log(e.message, 'eth_preflight')    
      throw new Error(Web3Interface.decodeWeb3Error(e.message).message)
    }

    if (transaction.to == null) {
      throw new Error(`"${address}" is not a valid ETH destination.`)
    }

    const maxFee = transaction.gasLimit * transaction.maxFeePerGas
    const maxValue = maxFee + value

    if (maxValue > balance) {
      const adjustedValue = value - maxFee

      if (adjustedValue < BigInt(0)) {
        throw new Error(
          `Insufficient funds, cannot cover fee costs of at least ${ethers.formatEther(maxFee)} ETH.`
        );
      } else {
        return await api.eth.txPreflight(
          address,
          ethers.formatEther(adjustedValue),
          {
            feeTakenFromAmount: true,
          }
        );
      }
    }
    
    return {
      chainTicker: "ETH",
      to: transaction.to,
      from: transaction.from,
      balance: ethers.formatEther(balance),
      value: ethers.formatEther(transaction.value),
      fee: ethers.formatEther(maxFee),
      total: ethers.formatEther(maxValue),
      remainingBalance: ethers.formatEther(balance - maxValue),
      maxFeePerGas: ethers.formatEther(transaction.maxFeePerGas),
      gasLimit: ethers.formatEther(transaction.gasLimit),
      warnings: params.feeTakenFromAmount
        ? [
            {
              field: "value",
              message: `Original amount + fee is larger than balance, amount has been changed.`,
            },
          ]
        : [],
      transaction
    };
  }

  api.eth.sendTx = async (address, amount) => {
    const preflight = await api.eth.txPreflight(address, amount)
    let { transaction } = preflight

    const signer = new ethers.Wallet(
      api.eth.wallet.signer.signingKey.privateKey,
      api.eth.interface.InfuraProvider
    );

    try {
      if (typeof api.assertProtectedActionExecutionActive === "function") {
        api.assertProtectedActionExecutionActive();
      }
      const response = await signer.sendTransaction(transaction);

      try {
        if (!api.eth.temp.pending_txs[response.hash]) {
          api.eth.temp.pending_txs[response.hash] = {
            hash: response.hash,
            confirmations: 0,
            from: response.from,
            gasPrice: response.maxFeePerGas.toString(),
            gasLimit: response.gasLimit.toString(),
            to: response.to,
            value: response.value.toString(),
            nonce: response.nonce,
            data: response.data,
            chainId: response.data
          }
        }
      } catch(e) {
        console.log(`Error saving tx ${response.hash} to cache`)
        console.log(e)
      }
      

      return {
        to: response.to,
        from: response.from,
        value: ethers.formatEther(response.value),
        txid: response.hash,
        fee: ethers.formatEther(
          transaction.gasLimit * transaction.maxFeePerGas
        )
      }
    } catch(e) {
      api.log(e.message, 'eth_sendtx')
      throw new Error(Web3Interface.decodeWeb3Error(e.message).message)
    }
  }

  api.setPost('/eth/sendtx', async (req, res, next) => {
    const { toAddress, amount } = req.body

    try {
      res.send(JSON.stringify({
        msg: 'success',
        result: await api.eth.sendTx(toAddress, amount.toString()),
      }));
    } catch(e) {
      const retObj = {
        msg: 'error',
        result: e.message,
      };
      res.send(JSON.stringify(retObj));
    }
  });

  api.setPost('/eth/tx_preflight', async (req, res, next) => {
    const { toAddress, amount } = req.body

    try {
      const response = await api.eth.txPreflight(toAddress, amount.toString());
      delete response.transaction;

      res.send(JSON.stringify({
        msg: 'success',
        result: response
      }));
    } catch(e) {
      const retObj = {
        msg: 'error',
        result: e.message,
      };
      res.send(JSON.stringify(retObj));
    }
  });
    
  return api;
};
