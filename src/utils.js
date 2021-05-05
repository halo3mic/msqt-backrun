require('dotenv').config()
const ethers = require('ethers')
ARCHER_API_KEY = process.env.ARCHER_API_KEY
const config = require('./config')
const fs = require('fs');
const csvWriter = require('csv-write-stream')
const fetch = require('node-fetch')

/**
 * Returns local time as a BigNumber
 */
function getCurrentTime() {
    return ethers.BigNumber.from(Math.floor(Date.now() / 1000).toString());
}

/**
 * Returns the breakeven gas price for an opportunity.
 * @param {BigNumber} reward in terms of ETH
 * @param {BigNumber | String} gasEstimate 
 */
function getBreakEvenGasPrice(reward, gasEstimate) {
    let breakEvenGasPrice = reward.div(gasEstimate);
    return breakEvenGasPrice;
}

/**
 * Helper function for submitting bytecode to Archer
 * @param {tx} tx 
 */
function convertTxDataToByteCode(tx) {
    const txData = tx.data
    const dataBytes = ethers.utils.hexDataLength(txData);
    const dataBytesHex = ethers.utils.hexlify(dataBytes);
    const dataBytesPadded = ethers.utils.hexZeroPad(dataBytesHex, 32);

    return ethers.utils.hexConcat([
      tx.to, 
      dataBytesPadded, 
      txData
    ]).split('0x')[1]
}

async function handleArcherResponse(response) {
    console.log("handleArcherResponse::status", response.status);
    let json = await response.json();
    // console.log("handleArcherResponse", json)
    if (response.status == 200) {
        console.log("handleArcherResponse::ok", json);
        // logToCsv(json, ARCHER_PASSES_PATH)
    }
    else if (response.status == 406) {
        // logToCsv(json, ARCHER_FAILS_PATH)
        if (json.reason == "opportunity too late") {
            return;
        }
        else if (json.reason == "opportunity too early") {
            // TODO - wait and resubmit
        }
    }
    else {
        console.log("handleArcherResponse::err", json);
    }
}


async function broadcastToArcherWithOpts(
    botId, query, trade, targetBlock, gasLimit, 
    estimatedProfitBeforeGas, 
    queryBreakEven = ethers.BigNumber.from("0"),
    inputAmount = ethers.BigNumber.from("0"),
    inputAsset = "ETH",
    queryInsertLocations = [],
    tradeInsertLocations = [],
    blockDeadline = null, 
    deadline = null
) {
    // console.log(
    //     "broadcastToArcher::targetBlock", targetBlock, 
    //     gasLimit.toString(), 
    //     ethers.utils.formatUnits(estimatedProfitBeforeGas)
    // );

    const bodyObject = {
      bot_id: botId, // ID of bot
      target_block: targetBlock.toString(), // Target block where you'd like the trade to take place
      trade, // bytecode for trade
      estimated_profit_before_gas: estimatedProfitBeforeGas.toString(), // expected profit in wei before accounting for gas
      gas_estimate: gasLimit.toString(), // Expected gas usage of trade
    //   query, // OPTIONAL: query bytecode to run before trade
      query_breakeven: queryBreakEven.toString(), // OPTIONAL: query return value minimum to continue with trade
      input_amount: inputAmount.toString(), // OPTIONAL: value to withdraw from dispatcher liquidity
      input_asset: inputAsset, // OPTIONAL: asset to withdraw from dispatcher liquidity
    //   query_insert_locations: queryInsertLocations, // OPTIONAL: locations in query to insert values
    //   trade_insert_locations: tradeInsertLocations, // OPTIONAL: location in trade to insert values
      deadline_block_number: blockDeadline.toString()
    };
    if (deadline) {
        bodyObject['min_timestamp'] = deadline.toString(),
        bodyObject['max_timestamp'] = deadline.add("180").toString()
    }

    const body = JSON.stringify(bodyObject);
    let options = {
        method: 'POST',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          'x-api-key': config.SECRETS.ARCHER_API_KEY
        },
        body,
    }
    // fetch(ARCHER_URL, options)
    //     .then(response => handleArcherResponse(response))
    //     .catch(error => console.log("broadcastToArcher::error", error));
    return fetch(config.ARCHER_URL, options)
        .then(response => response.json())
        .catch(error => console.log("broadcastToArcher::error", error))
}

async function submitBatchesToArcher({ethCall, senderAddress, signature}) {
    let request  = {
        method: 'POST',
        body:    JSON.stringify(ethCall),
        headers: { 
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json', 
            'X-Flashbots-Signature': senderAddress+':'+signature
        }
    }
    return fetch(config.constants.archerBatchesEndpoint, request)
        // .then(response => response.json())
        .catch(error => console.log("broadcastToArcher::error", error))
}

async function submitSimulationRequest(request) {
    return fetch(config.constants.archerBatchesEndpoint, request)
    .catch(error => console.log("broadcastToArcher::error", error))}

function logToCsv(data, path) {
    if (!Array.isArray(data)) {
        data = [data]
    }
    let writer = csvWriter()
    let headers = {sendHeaders: false}
    if (!fs.existsSync(path))
        headers = {headers: Object.keys(data[0])}
    writer = csvWriter(headers);
    writer.pipe(fs.createWriteStream(path, {flags: 'a'}));
    data.forEach(e => writer.write(e))
    writer.end()
}

async function fetchGasPrice(speed) {
    let speedOptions = [
        'fast', 
        'rapid', 
        'normal',
        'slow' 
    ]
    if (!speedOptions.includes(speed)) {
        throw new Error(`Speed option ${speed} unknown. \nPlease select from ${speedOptions.join(',')}.`)
    }
    const url = "https://www.gasnow.org/api/v3/gas/price";
    try {
      const result = await fetch(url)
      const jsonResult = await result.json()
      const option = jsonResult.data[speed].toString()
      let gasPrice = ethers.BigNumber.from(option)
      return gasPrice
    }
    catch (error) {
      if (error.message.startsWith("invalid json response body")) {
      }
      else {
        console.log("fetchGasPrice::catch", error.message)
      }
    }
}

function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }  

  async function jsonRPCRequest(url, req) {
    return fetch(
        url, 
        {
            method: 'post',
            body:    JSON.stringify(req),
            headers: { 'Content-Type': 'application/json' },
        }
    ).then(r => r.json())
}

/**
 * Estimate gas cost for an internal Uniswap trade with nSteps.
 * @dev Gas estimate for wrapping 32k
 * @dev Actual gasPerStep varies. Estimated 62k
 * @dev Avalanche has static gas price (may change in hardfork). Set to 470gwei
 * @param {BigNumber} nSteps 
 * @returns {BigNumber} gas cost in wei
 */
 function estimateGasAmount(nSteps) {
    let gasPerStep = ethers.BigNumber.from("140000")
    let totalGas = gasPerStep.mul(nSteps)
    return totalGas
}

/**
 * Check wheter the string is in hex format starting with 0x
 * @param {String} string
 * @returns {Boolean}
 */
function isHex(string) {
    return /^0x[0-9A-Fa-f]+$/.test(string)
}

module.exports = { 
    submitBatchesToArcher, 
    estimateGasAmount,
    fetchGasPrice, 
    broadcastToArcherWithOpts, 
    convertTxDataToByteCode, 
    submitSimulationRequest,
    logToCsv, 
    jsonRPCRequest,
    sleep, 
    isHex
}