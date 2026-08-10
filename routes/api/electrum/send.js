const coinSelect = require('coinselect');
const { transaction } = require('agama-wallet-lib/src/transaction-builder');
const { fromSats, toSats } = require('agama-wallet-lib/src/utils');
const { toPublicPreflightResult } = require('./security');

// TODO: error handling, input vars check

// speed: slow, average, fast
module.exports = (api) => {  
  api.maxSpendBalance = (utxoList, fee) => {
    let maxSpendBalance = 0;

    for (let i = 0; i < utxoList.length; i++) {
      maxSpendBalance += Number(utxoList[i].value);
    }

    if (fee) {
      return Number(maxSpendBalance) - Number(fee);
    } else {
      return maxSpendBalance;
    }
  }

  api.electrum.createPreflightObj = (
    chainTicker,
    toAddress,
    fromAddress,
    balance,
    inputAmount,
    txValue,
    fee,
    totalInterest,
    rawTx,
    feePerByte
  ) => {
    let warnings = [];

    if (Number(toSats(inputAmount)) !== Number(txValue)) {
      warnings.push({
        field: "value",
        message: `Original amount + fee (${(inputAmount + fromSats(Number(fee))).toFixed(8)}) is larger than balance, amount has been changed.`
      });
    }

    return {
      chainTicker,
      to: toAddress,
      from: fromAddress,
      balance: fromSats(balance),
      value: fromSats(txValue),
      fee: fromSats(fee),
      feePerByte: feePerByte,
      total: fromSats(txValue + fee),
      remainingBalance: fromSats(balance - (txValue + fee)) + (totalInterest == null ? 0 : fromSats(totalInterest)),
      warnings,
      interest: totalInterest == null || totalInterest == 0 ? null : fromSats(totalInterest),
      rawTx
    };
  };

  api.electrum.conditionalListunspent = (grainedControlUtxos, ecl, address, network, full, verify) => {
    return new Promise((resolve, reject) => {
      if (grainedControlUtxos) {
        resolve(grainedControlUtxos);
      } else {
        api.electrum.listunspent(
          ecl,
          address,
          network,
          true,
          verify === true ? true : null
        )
        .then((utxoList) => {
          resolve(utxoList);
        });
      }
    });
  };

  api.electrum.txPreflight = async (
    chainTicker,
    toAddress,
    amount,
    verify,
    lumpFee,
    feePerByte,
    noSigature,
    offlineTx,
    unsigned,
    customUtxos,
    votingTx,
    opreturn,
    customWif,
    customFromAddress
  ) => {
    // TODO: unconf output(s) error message
    const network = api.validateChainTicker(chainTicker);
    let ecl = api.electrum.coinData[network.toLowerCase()].nspv ? {} : await api.ecl(network);
    let fee =
      lumpFee && Number(lumpFee) !== 0
        ? Number(lumpFee)
        : api.electrumServers[chainTicker.toLowerCase()].txfee;
    let value = toSats(Number(amount));
    let fromAddress = customFromAddress ? customFromAddress : api.electrumKeys[chainTicker.toLowerCase()].pub

    if (feePerByte) {
      fee = 0;
    }

    api.log("electrum createrawtx =>", "electrum.tx_preflight");

    return new Promise((resolve, reject) => {
      api.electrum.conditionalListunspent(
        customUtxos ? customUtxos : false,
        ecl,
        fromAddress,
        network,
        true,
        verify
      )
      .then(utxoList => {
        if (utxoList && utxoList.length && utxoList[0] && utxoList[0].txid) {
          let utxoListFormatted = [];
          let totalInterest = 0;
          let interestClaimThreshold = 200;

          for (let i = 0; i < utxoList.length; i++) {
            if (chainTicker === "komodo" || chainTicker.toLowerCase() === "kmd") {
              if (utxoList[i].confirmations > 0) {
                let _formattedUtxo = {
                  txid: utxoList[i].txid,
                  vout: utxoList[i].vout,
                  value: Number(utxoList[i].amountSats),
                  interestSats: Number(utxoList[i].interestSats),
                  verified: utxoList[i].verified ? utxoList[i].verified : false,
                  height: utxoList[i].height,
                  currentHeight: utxoList[i].currentHeight
                };

                if (utxoList[i].hasOwnProperty("dpowSecured")) {
                  _formattedUtxo.dpowSecured = utxoList[i].dpowSecured;
                  dpowSecured = true;
                }

                utxoListFormatted.push(_formattedUtxo);
              }
            } else {
              if (utxoList[i].confirmations > 0) {
                let _formattedUtxo = {
                  txid: utxoList[i].txid,
                  vout: utxoList[i].vout,
                  value: Number(utxoList[i].amountSats),
                  verified: utxoList[i].verified ? utxoList[i].verified : false,
                  height: utxoList[i].height,
                  currentHeight: utxoList[i].currentHeight
                };

                if (utxoList[i].hasOwnProperty("dpowSecured")) {
                  _formattedUtxo.dpowSecured = utxoList[i].dpowSecured;
                  dpowSecured = true;
                }

                utxoListFormatted.push(_formattedUtxo);
              }
            }
          }

          api.log(
            "electrum listunspent unformatted ==>",
            "electrum.tx_preflight"
          );
          api.log(utxoList, "electrum.tx_preflight");

          api.log(
            "electrum listunspent formatted ==>",
            "electrum.tx_preflight"
          );
          api.log(utxoListFormatted, "electrum.tx_preflight");

          const _maxSpendBalance = Number(
            api.maxSpendBalance(utxoListFormatted)
          );
          
          let targets = [
            {
              address: toAddress,
              value: value > _maxSpendBalance ? _maxSpendBalance : value
            }
          ];
          api.log("targets =>", "electrum.tx_preflight");
          api.log(targets, "electrum.tx_preflight");

          targets[0].value = targets[0].value + fee;

          api.log(`default fee ${fee}`, "electrum.tx_preflight");
          api.log("targets ==>", "electrum.tx_preflight");
          api.log(targets, "electrum.tx_preflight");

          // default coin selection algo blackjack with fallback to accumulative
          // make a first run, calc approx tx fee
          // if ins and outs are empty reduce max spend by txfee
          const firstRun = coinSelect(
            utxoListFormatted,
            targets,
            feePerByte ? feePerByte : 0
          );
          let inputs = firstRun.inputs;
          let outputs = firstRun.outputs;

          if (feePerByte) {
            api.log(`btc fee per byte ${feePerByte}`, "electrum.tx_preflight");
            fee = firstRun.fee;
          }

          api.log("coinselect res =>", "electrum.tx_preflight");
          api.log("coinselect inputs =>", "electrum.tx_preflight");
          api.log(inputs, "electrum.tx_preflight");
          api.log("coinselect outputs =>", "electrum.tx_preflight");
          api.log(outputs, "electrum.tx_preflight");
          api.log("coinselect calculated fee =>", "electrum.tx_preflight");
          api.log(fee, "electrum.tx_preflight");

          if (!outputs) {
            targets[0].value = targets[0].value - fee;
            api.log("second run", "electrum.tx_preflight");
            api.log("coinselect adjusted targets =>", "electrum.tx_preflight");
            api.log(targets, "electrum.tx_preflight");

            const secondRun = coinSelect(utxoListFormatted, targets, 0);
            inputs = secondRun.inputs;
            outputs = secondRun.outputs;
            fee = fee ? fee : secondRun.fee;

            api.log("second run coinselect inputs =>", "electrum.tx_preflight");
            api.log(inputs, "electrum.tx_preflight");
            api.log(
              "second run coinselect outputs =>",
              "electrum.tx_preflight"
            );
            api.log(outputs, "electrum.tx_preflight");
            api.log("second run coinselect fee =>", "electrum.tx_preflight");
            api.log(fee, "electrum.tx_preflight");
          }

          if (!outputs) {
            throw new Error(
              "Insufficient funds. Failed to calculate acceptable transaction amount with current fee."
            );
          } else {
            let _change = 0;

            if (outputs && outputs.length === 2) {
              _change = outputs[1].value - fee;
            }

            if (!feePerByte && _change === 0) {
              outputs[0].value = outputs[0].value - fee;
            }

            if (feePerByte) {
              value = outputs[0].value;
            } else {
              if (_change > 0) {
                value = outputs[0].value - fee;
              }
            }

            api.log(
              "adjusted outputs, value - default fee =>",
              "electrum.tx_preflight"
            );
            api.log(outputs, "electrum.tx_preflight");

            // check if any outputs are unverified
            if (inputs && inputs.length) {
              for (let i = 0; i < inputs.length; i++) {
                if (!inputs[i].verified) {
                  utxoVerified = false;
                  break;
                }
              }

              for (let i = 0; i < inputs.length; i++) {
                if (
                  inputs[i].hasOwnProperty("dpowSecured") &&
                  !inputs[i].dpowSecured
                ) {
                  dpowSecured = false;
                  break;
                }
              }

              for (let i = 0; i < inputs.length; i++) {
                if (Number(inputs[i].interestSats) > interestClaimThreshold) {
                  totalInterest += Number(inputs[i].interestSats);
                }
              }
            }

            const _maxSpend = api.maxSpendBalance(utxoListFormatted);

            if (value > _maxSpend) {
              throw new Error(
                `Spend value is too large. Max available amount is ${Number(
                  _maxSpend * (0.00000001).toFixed(8)
                )}`
              );
            } else {
              api.log(
                `maxspend ${_maxSpend} (${_maxSpend * 0.00000001})`,
                "electrum.tx_preflight"
              );
              api.log(`value ${value}`, "electrum.tx_preflight");
              api.log(
                `sendto ${toAddress} amount ${value} (${value * 0.00000001})`,
                "electrum.tx_preflight"
              );
              api.log(
                `changeto ${fromAddress} amount ${_change} (${_change *
                  0.00000001})`,
                "electrum.tx_preflight"
              );

              // account for KMD interest
              if (
                (network === "komodo" || network.toLowerCase() === "kmd") &&
                totalInterest > 0
              ) {
                // account for extra vout
                // const _feeOverhead = outputs.length === 1 ? estimateTxSize(0, 1) * feeRate : 0;
                const _feeOverhead = 0;

                api.log(
                  `max interest to claim ${totalInterest} (${totalInterest *
                    0.00000001})`,
                  "electrum.tx_preflight"
                );
                api.log(
                  `estimated fee overhead ${_feeOverhead}`,
                  "electrum.tx_preflight"
                );
                api.log(
                  `current change amount ${_change} (${_change *
                    0.00000001}), boosted change amount ${_change +
                    (totalInterest - _feeOverhead)} (${(_change +
                    (totalInterest - _feeOverhead)) *
                    0.00000001})`,
                  "electrum.tx_preflight"
                );

                if (_maxSpend - fee === value) {
                  _change = totalInterest - _change - _feeOverhead;

                  if (toAddress === fromAddress) {
                    value += _change;
                    _change = 0;
                    api.log(
                      `send to self ${toAddress} = ${fromAddress}`,
                      "electrum.tx_preflight"
                    );
                    api.log(
                      `send to self old val ${value}, new val ${value +
                        _change}`,
                      "electrum.tx_preflight"
                    );
                  }
                } else {
                  _change = _change + (totalInterest - _feeOverhead);
                }
              }

              if (!inputs && !outputs) {
                throw new Error("Can't find best fit utxo. Try lower amount.");
              } else {
                let vinSum = 0;

                for (let i = 0; i < inputs.length; i++) {
                  vinSum += inputs[i].value;
                }

                let voutSum = 0;

                for (let i = 0; i < outputs.length; i++) {
                  voutSum += outputs[i].value;
                }

                const _estimatedFee = vinSum - outputs[0].value - _change;

                api.log(
                  `vin sum ${vinSum} (${vinSum * 0.00000001})`,
                  "electrum.tx_preflight"
                );
                api.log(
                  `vout sum ${voutSum} (${voutSum * 0.00000001})`,
                  "electrum.tx_preflight"
                );
                api.log(
                  `estimatedFee ${_estimatedFee} (${_estimatedFee *
                    0.00000001})`,
                  "electrum.tx_preflight"
                );
                // double check no extra fee is applied
                api.log(
                  `vin - vout ${vinSum - value - _change}`,
                  "electrum.tx_preflight"
                );

                if (vinSum - value - _change > fee) {
                  _change += fee;
                  api.log(
                    `double fee, increase change by ${fee}`,
                    "electrum.tx_preflight"
                  );
                } else if (vinSum - value - _change === 0) {
                  // max amount spend edge case
                  api.log(
                    `zero fee, reduce output size by ${fee}`,
                    "electrum.tx_preflight"
                  );
                  value = value - fee;
                }

                api.log(`change ${_change}`, "electrum.tx_preflight");
                api.log(
                  `network ${network.toLowerCase()}`,
                  "electrum.tx_preflight"
                );
                api.log(
                  `estimated fee ${_estimatedFee}`,
                  "electrum.tx_preflight"
                );

                // 1h kmd interest lee way to mitigate client-server time diff
                if (
                  _estimatedFee < 0 &&
                  network.toLowerCase() === "kmd" &&
                  _change > 0
                ) {
                  api.log(
                    "estimated fee < 0, subtract 20k sats fee",
                    "electrum.tx_preflight"
                  );
                  const _changeOld = _change;
                  _change -= fee * 2;

                  if (
                    Math.abs(Math.abs(_changeOld) - Math.abs(_change)) >= fee &&
                    Math.abs(Math.abs(_changeOld) - Math.abs(_change)) < fee * 2
                  ) {
                    api.log(
                      "subtracted fee is less than 20k sats, subtract 10k sats",
                      "electrum.tx_preflight"
                    );
                    _change -= fee;
                  }
                  _change = _change < 0 ? 0 : _change;
                  api.log(
                    `change adjusted ${_change}`,
                    "electrum.tx_preflight"
                  );
                }

                // TODO: use individual dust thresholds
                if (_change > 0 && _change <= 1000) {
                  api.log(
                    `change is < 1000 sats, donate ${_change} sats to miners`,
                    "electrum.tx_preflight"
                  );
                  _change = 0;
                }

                let _rawtx;

                if (noSigature) {
                  resolve(
                    api.electrum.createPreflightObj(
                      chainTicker,
                      toAddress,
                      fromAddress,
                      _maxSpendBalance,
                      amount,
                      value,
                      fee,
                      totalInterest != null && totalInterest < 0 ? 0 : totalInterest,
                      undefined,
                      feePerByte
                    )
                  );
                } else {
                  if (unsigned) {
                    _rawtx = transaction(
                      toAddress,
                      fromAddress,
                      api.getNetworkData(network),
                      inputs,
                      _change,
                      value,
                      { unsigned: true }
                    );
                  } else {
                    if (!offlineTx) {
                      let wif

                      // Preserve the send path's existing key-selection semantics,
                      // but do not read any private key during a no-signature
                      // public preflight.
                      if (customWif) wif = customWif
                      if (votingTx) wif = api.elections.priv
                      else wif = api.electrumKeys[chainTicker.toLowerCase()].priv

                      _rawtx = transaction(
                        toAddress,
                        fromAddress,
                        wif,
                        api.electrumJSNetworks[network] ||
                          api.getNetworkData(network),
                        inputs,
                        _change,
                        value,
                        opreturn ? { opreturn } : null
                      );
                    }
                  }

                  resolve(
                    api.electrum.createPreflightObj(
                      chainTicker,
                      toAddress,
                      fromAddress,
                      _maxSpendBalance,
                      amount,
                      value,
                      fee,
                      totalInterest != null && totalInterest < 0 ? 0 : totalInterest,
                      _rawtx,
                      feePerByte
                    )
                  );
                }
              }
            }
          }
        } else {
          throw new Error("No utxos provided to send with.");
        }
      })
      .catch(err => {

        reject(err);
      });
    })
    
  };

  api.setPost('/electrum/sendtx', async (req, res, next) => {
    const {
      chainTicker,
      toAddress,
      amount,
      verify,
      lumpFee,
      feePerByte,
      noSigature,
      offlineTx,
      unsigned,
      customUtxos,
      votingTx,
      opreturn,
      customWif,
      customFromAddress
    } = req.body
    let preflightRes

    api.electrum
      .txPreflight(
        chainTicker,
        toAddress,
        amount,
        verify,
        lumpFee,
        feePerByte,
        noSigature,
        offlineTx,
        unsigned,
        customUtxos,
        votingTx,
        opreturn,
        customWif,
        customFromAddress
      )
      .then(async (preflightObj) => {
        preflightRes = preflightObj;
        const chainTickerUc = api.validateChainTicker(chainTicker);
       
        const ecl = await api.ecl(chainTickerUc);
        if (typeof api.assertProtectedActionExecutionActive === "function") {
          api.assertProtectedActionExecutionActive();
        }
        let resObj = ecl.blockchainTransactionBroadcast(preflightRes.rawTx);

        return resObj;
      })
      .then(broadcastRes => {
        
        const { chainTicker, fromAddress, rawTx } = preflightRes

        if (broadcastRes && JSON.stringify(broadcastRes).indexOf("fee not met") > -1) {
          const retObj = {
            msg: "error",
            result: "Missing fee.",
          };

          res.send(JSON.stringify(retObj));
        } else if (
          broadcastRes &&
          JSON.stringify(broadcastRes).indexOf("bad-txns-inputs-spent") > -1
        ) {
          const retObj = {
            msg: "error",
            result: "Bad transaction inputs spent.",
          };

          res.send(JSON.stringify(retObj));
        } else if (broadcastRes && broadcastRes.length === 64) {
          if (JSON.stringify(broadcastRes).indexOf("bad-txns-in-belowout") > -1) {
            const retObj = {
              msg: "error",
              result: "Insufficient funds.",
            };

            res.send(JSON.stringify(retObj));
          } else {
            api.updatePendingTxCache(chainTicker, broadcastRes, {
              pub: fromAddress,
              rawtx: rawTx
            });

            const retObj = {
              msg: "success",
              result: { ...preflightRes, txid: broadcastRes }
            };

            res.send(JSON.stringify(retObj));
          }
        } else if (
          broadcastRes &&
          JSON.stringify(broadcastRes).indexOf("bad-txns-in-belowout") > -1
        ) {
          const retObj = {
            msg: "error",
            result: "Insufficient funds.",
          };

          res.send(JSON.stringify(retObj));
        } else {
          const retObj = {
            msg: "error",
            result: broadcastRes.message,
          };

          res.send(JSON.stringify(retObj));
        }
      })
      .catch(e => {
        const retObj = {
          msg: 'error',
          result: e.message,
        };
        res.send(JSON.stringify(retObj));
      });
  }, true);

  api.setPost('/electrum/tx_preflight', (req, res, next) => {
    const {
      chainTicker,
      toAddress,
      amount,
      verify,
      lumpFee,
      feePerByte,
      customUtxos,
      customFromAddress
    } = req.body;

    // This route supplies confirmation data only. Transaction signing and raw
    // transaction construction are reserved for /electrum/sendtx.
    api.electrum.txPreflight(
        chainTicker,
        toAddress,
        amount,
        verify,
        lumpFee,
        feePerByte,
        true,
        false,
        false,
        customUtxos,
        false,
        undefined,
        undefined,
        customFromAddress
      )
      .then(preflightObj => {
        res.send(
          JSON.stringify({
            msg: "success",
            result: toPublicPreflightResult(preflightObj)
          })
        );
      })
      .catch(e => {
        const retObj = {
          msg: "error",
          result: e.message
        };
        res.send(JSON.stringify(retObj));
      });
  }, true);
    
  return api;
};
