const ethers = require('ethers');
const { scientificToDecimal } = require('../numbers');
const Web3Interface = require('../utils/web3/web3Interface');

// speed: slow, average, fast
module.exports = (api) => {  
  /**
   * Preflights an ERC20 tx
   * @param {String} contractId
   * @param {String} address 
   * @param {String} amount 
   * @param {Object} params 
   * @returns Object
   */
   api.erc20.txPreflight = async (contractId, address, amount, params = {}) => {
    if (api.erc20.contracts[contractId] == null) {
      throw new Error(`No interface to connect to ${contractId} for tx preflight call`)
    } else if (api.erc20.wallet == null) {
      throw new Error('No ERC20 wallet authenticated to use for tx preflight call')
    }

    const web3Provider = api.erc20.contracts[contractId]

    const fromAddress = api.erc20.wallet.address
    const signer = new ethers.VoidSigner(fromAddress, web3Provider.interface.DefaultProvider)
    const contract = web3Provider.contract.connect(signer)
    const balance = BigInt(await contract.balanceOf(signer.getAddress()))
    const maxFeePerGas = (await web3Provider.interface.InfuraProvider.getFeeData()).maxFeePerGas;
    const amountBn = ethers.parseUnits(
      scientificToDecimal(amount),
      web3Provider.decimals
    );
    let gasEst = null
    let gasLimit;
    let transaction = null 

    try {
      gasEst = BigInt(await contract.transfer.estimateGas(address, amountBn))
      gasLimit = gasEst + (gasEst / BigInt(3));
    } catch(e) {   
      api.log(e.message, 'erc20_preflight')   
      throw new Error(Web3Interface.decodeWeb3Error(e.message).message)
    }
    
    const maxFee = gasLimit * maxFeePerGas
    
    return {
      chainTicker: web3Provider.symbol,
      to: address,
      from: fromAddress,
      balance: ethers.formatUnits(balance, web3Provider.decimals),
      value: ethers.formatUnits(amountBn, web3Provider.decimals),
      fee: ethers.formatEther(maxFee),
      total: ethers.formatUnits(amountBn, web3Provider.decimals),
      remainingBalance: ethers.formatUnits(
        balance - amountBn,
        web3Provider.decimals
      ),
      maxFeePerGas: ethers.formatEther(maxFeePerGas),
      gasLimit: ethers.formatEther(gasLimit),
      warnings: [],
      transaction,
      decimals: web3Provider.decimals,
    };
  }

  api.erc20.sendTx = async (contractId, address, amount) => {
    if (api.erc20.contracts[contractId] == null) {
      throw new Error(`No interface to connect to ${contractId} for tx send call`)
    } else if (api.erc20.wallet == null) {
      throw new Error('No ERC20 wallet authenticated to use for tx send call')
    }

    const web3Provider = api.erc20.contracts[contractId]

    await api.erc20.txPreflight(contractId, address, amount)
    
    const privKey = api.erc20.wallet.signer.signingKey.privateKey
    const dummySigner = new ethers.VoidSigner(api.erc20.wallet.address, web3Provider.interface.DefaultProvider)
    const contract = web3Provider.contract.connect(dummySigner)
    const amountBn = ethers.parseUnits(
      scientificToDecimal(amount),
      web3Provider.decimals
    );
    const signableContract = web3Provider.contract.connect(
      new ethers.Wallet(
        ethers.hexlify(privKey),
        web3Provider.interface.InfuraProvider
      )
    );
    let gasEst = null
    let response = null

    try {
      gasEst = BigInt(await contract.transfer.estimateGas(address, amountBn))
      if (typeof api.assertProtectedActionExecutionActive === "function") {
        api.assertProtectedActionExecutionActive();
      }
      response = await signableContract.transfer(
        address,
        amountBn
      );
    } catch(e) {    
      api.log(e.message, 'erc20_sendtx')  
      throw new Error(Web3Interface.decodeWeb3Error(e.message).message)
    }

    const maxFee = response.maxFeePerGas * response.gasLimit;

    try {
      if (!api.erc20.contracts[contractId].temp.pending_txs[response.hash]) {
        api.erc20.contracts[contractId].temp.pending_txs[response.hash] = {
          hash: response.hash,
          confirmations: 0,
          from: response.from,
          gasPrice: response.maxFeePerGas.toString(),
          gasLimit: response.gasLimit.toString(),
          to: address,
          value: amountBn.toString(),
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
      to: address,
      from: response.from,
      fee: Number(ethers.formatEther(maxFee)),
      value: ethers.formatUnits(amountBn, web3Provider.decimals),
      txid: response.hash
    };
  }

  api.setPost('/erc20/sendtx', async (req, res, next) => {
    const { chainTicker, toAddress, amount } = req.body

    try {
      res.send(JSON.stringify({
        msg: 'success',
        result: await api.erc20.sendTx(chainTicker, toAddress, amount.toString()),
      }));
    } catch(e) {
      const retObj = {
        msg: 'error',
        result: e.message,
      };
      res.send(JSON.stringify(retObj));
    }
  });

  api.setPost('/erc20/tx_preflight', async (req, res, next) => {
    const { chainTicker, toAddress, amount } = req.body

    try {
      const response = await api.erc20.txPreflight(chainTicker, toAddress, amount.toString());
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
