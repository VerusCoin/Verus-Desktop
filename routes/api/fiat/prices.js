const { requestJson, requestXml } = require('../utils/request/request')
const { DOMParser } = require('@xmldom/xmldom');
const { getCoinObj } = require('../../coinDataTranslated');

module.exports = (api) => {
  api.fiat = {}
  
  api.fiat.supportedCurrencies = [
    'AUD',
    'BRL',
    'GBP',
    'BGN',
    'CAD',
    'HRK',
    'CZK',
    'CNY',
    'DKK',
    'EUR',
    'HKD',
    'HUF',
    'INR',
    'IDR',
    'ILS',
    'JPY',
    'KRW',
    'MYR',
    'MXN',
    'NZD',
    'NOK',
    'PHP',
    'PLN',
    'RON',
    'RUB',
    'SGD',
    'ZAR',
    'SEK',
    'CHF',
    'THB',
    'TRY',
    'USD'
  ]

  api.fiat.coinpaprika_coin_ids = {
    ["WBTC"]: "wbtc-wrapped-bitcoin",
    ["VRSC"]: "vrsc-verus-coin"
  }

  api.fiat.get_fiatrates = () => {
    return new Promise(async (resolve, reject) => {
      // Temporary until electron is updated to handle new ECP auth
      resolve({
        msg: "success", result: {
          ["USD"]: 1
        }
      });
      
      // const url = `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`

      // try {
      //   const response = await requestXml(
      //     "GET",
      //     url
      //   );

      //   const parser = new DOMParser();
      //   const xmlDoc = parser.parseFromString(response, "text/xml");
      //   let exchangeRates = {}

      //   x = xmlDoc.getElementsByTagName('Cube');
      //   for (i = 0; i < x.length; i++) {
      //     const currency = x[i].getAttribute('currency')
      //     const rate = x[i].getAttribute('rate')

      //     if (
      //       currency != null &&
      //       /^[a-zA-Z]+$/.test(currency) &&
      //       rate != null &&
      //       !isNaN(Number(rate))
      //     ) {
      //       exchangeRates[currency] = Number(rate)
      //     }
      //   }

      //   exchangeRates['EUR'] = 1

      //   for (const currencyTicker in exchangeRates) {
      //     if (currencyTicker !== 'USD') {
      //       if (
      //         exchangeRates["USD"] == null ||
      //         exchangeRates["USD"] == 0
      //       ) {
      //         exchangeRates[currencyTicker] = null;
      //       } else {
      //         exchangeRates[currencyTicker] =
      //           exchangeRates[currencyTicker] / exchangeRates["USD"];
      //       }
      //     }
      //   }

      //   exchangeRates['USD'] = 1

      //   resolve({ msg: "success", result: exchangeRates });
      // } catch(e) {
      //   api.log(`fiat price error: unable to request ${url}`, 'fiat.prices');
      //   reject(new Error(`Unable to request ${url}`))
      // }
    })
  }

  /**
   * Fetches price for specified cryptocurrency (uppercase ticker) from atomic explorer
   * in specified currency. If no currency specified, fetches price in all available currencies.
   */
  api.fiat.get_fiatprice = (coin) => {
    return new Promise(async (resolve, reject) => {
      let url

      try {
        const fiatRates = await api.fiat.get_fiatrates()

        if (coin === "VRSCTEST" || api.is_pbaas(coin)) {
          const results = {'USD': 0}

          Object.keys(fiatRates.result).map(fiatCurrency => {
            results[fiatCurrency] = 0
          })

          return new Promise((resolve) => resolve(results))
        }

        const coinObj = getCoinObj(coin);
        const param = api.fiat.coinpaprika_coin_ids[coin]
          ? api.fiat.coinpaprika_coin_ids[coin]
          : coin.toLowerCase() + "-" + coinObj.name.replace(/ /g, "-").toLowerCase();
        url = `https://api.coinpaprika.com/v1/coins/${param}/ohlcv/today`

        

        const res = await requestJson(
          "GET",
          url
        );

        if (res.error || !res || !res[0] || !res[0].close) {
          reject(new Error(`Failed to get price for ${coin} through CoinPaprika API. ${url}`))
        } else {
          const priceCloseUsd = res[0].close;

          let priceCloseAllCurrencies = { 'USD': priceCloseUsd }

          if (fiatRates.msg === 'success') {
            Object.keys(fiatRates.result).map(fiatCurrency => {
              if (priceCloseAllCurrencies[fiatCurrency] == null) {
                // Multiply rate of coin in dollars by rate of dollars to all fiat currencies
                priceCloseAllCurrencies[fiatCurrency] =
                  priceCloseUsd * fiatRates.result[fiatCurrency];
              }
            })
          }

          resolve({
            msg: "success",
            result: priceCloseAllCurrencies
          });
        }
      } catch(e) {
        api.log(`coinpaprika price error: unable to request ${url}`, 'fiat.prices');
        api.log(e, 'fiat.prices');
        reject(e)
      }
    });
  }

  //TODO: Clean this up to be one function without making GUI component messier
  api.setGet('/native/get_fiatprice', (req, res, next) => {
    const coin = req.query.chainTicker
    const currency = req.query.currency

    api.fiat.get_fiatprice(coin, currency)
    .then((priceObj) => {
      res.send(JSON.stringify(priceObj));
    })
    .catch(e => {
      res.send(
        JSON.stringify({
          msg: "error",
          result:
            e.message != null && e.message.includes("No fiat value found")
              ? ("No fiat value found for " + coin)
              : e.message,
        })
      );
    })
  });

  api.setGet('/eth/get_fiatprice', (req, res, next) => {
    const coin = req.query.chainTicker
    const currency = req.query.currency

    api.fiat.get_fiatprice(coin, currency)
    .then((priceObj) => {
      res.send(JSON.stringify(priceObj));
    })
    .catch(e => {
      res.send(JSON.stringify({
        msg: 'error',
        result:
            e.message != null && e.message.includes("No fiat value found")
              ? ("No fiat value found for " + coin)
              : e.message,
      }));
    })
  });

  api.setGet('/erc20/get_fiatprice', async (req, res, next) => {
    const chainTicker = req.query.chainTicker
    const currency = req.query.currency

    if (api.erc20.contracts[chainTicker] != null) {
      api.fiat
        .get_fiatprice(api.erc20.contracts[chainTicker].symbol, currency)
        .then((priceObj) => {
          res.send(JSON.stringify(priceObj));
        })
        .catch((e) => {
          res.send(
            JSON.stringify({
              msg: "error",
              result:
                e.message != null && e.message.includes("No fiat value found")
                  ? ("No fiat value found for " + chainTicker)
                  : e.message,
            })
          );
        });
    } else {
      res.send(JSON.stringify({
        msg: 'error',
        result: `No interface for ${chainTicker}`
      }));
    }
  });

  api.setGet('/electrum/get_fiatprice', (req, res, next) => {
    const coin = req.query.chainTicker
    const currency = req.query.currency

    api.fiat.get_fiatprice(coin, currency)
    .then((priceObj) => {
      res.send(JSON.stringify(priceObj));
    })
    .catch(e => {
      res.send(
        JSON.stringify({
          msg: "error",
          result:
            e.message != null && e.message.includes("No fiat value found")
              ? "No fiat value found for " + coin
              : e.message,
        })
      );
    })
  });

  return api
}
