const EthereumTx = require('ethereumjs-tx').Transaction
const csvWriter = require('csv-write-stream')
const fetch = require('node-fetch')
const ethers = require('ethers')
require('dotenv').config()
const md5 = require('md5')
const fs = require('fs')

const config = require('./config')

/**
 * Estimate gas amount for an internal Uniswap-like trade with nSteps.
 * @dev Actual gasPerStep varies.
 * @param {BigNumber} nSteps 
 * @returns {BigNumber} gas cost in wei
 */
 function estimateGasAmount(nSteps) {
    let gasPerStep = ethers.BigNumber.from("140000")
    let totalGas = gasPerStep.mul(nSteps)
    return totalGas
}

/**
 * Return price of gas
 * @param {String} speed Paramter specifying how competitive gas price should be
 * @returns {BigNumber}
 */
 async function fetchGasPrice(speed) {
    let speedOptions = [
        'normal',
        'rapid', 
        'fast', 
        'slow',
    ]
    if (!speedOptions.includes(speed)) {
        throw new Error(`Speed option ${speed} unknown. \nPlease select from ${speedOptions.join(',')}.`)
    }
    const result = await fetch(config.constants.gasPriceEndpoint)
    const jsonResult = await result.json()
    const option = jsonResult.data[speed].toString()
    let gasPrice = ethers.BigNumber.from(option)
    // Sense check that API returned the gas price in the right format
    if (gasPrice.lt(ethers.utils.parseUnits('1', 'gwei'))) {
        throw new Error('Gas price lower than 1 gwei')
    } else if (gasPrice.gt(ethers.utils.parseUnits('10000', 'gwei'))) {
        throw new Error('Gas price greater than 10000 gwei')
    } else {
        return gasPrice
    }
}

/**
 * Return normalized number
 * Convert number with any decimals to 18 units
 * @param {ethers.BigNumber} num Amount
 * @param {ethers.BigNumber} dec Token decimals
 * @returns {ethers.BigNumber}
 */
 function normalizeUnits(num, dec) {
    // Convert everything to 18 units
    return ethers.utils.parseUnits(
        ethers.utils.formatUnits(num, dec)
    )
}

/**
 * Return unnormalized number
 * Convert number from 18 units to unique decimals
 * @param {BigNumber} num Amount
 * @param {Number} dec Token decimals
 * @returns {BigNumber}
 */
 function unnormalizeUnits(num, dec) {
    return ethers.utils.parseUnits(
        ethers.utils.formatUnits(num), 
        dec
    )
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

/**
 * Send bundle to archer network and return response
 * @param {Object} ethCall `eth_callBundle` or `eth_sendBundle` method with args
 * @param {String} senderAddress Address submitting the request
 * @param {String} signature `ethCall` signed with `senderAddress`
 * @returns {Object}
 */
async function submitBundleToArcher({ ethCall, senderAddress, signature }) {
    let request  = {
        method: 'POST',
        body:    JSON.stringify(ethCall),
        headers: { 
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json', 
            'X-Flashbots-Signature': senderAddress+':'+signature
        }
    }
    return fetch(config.constants.archerBundleEndpoint, request)
        .then(response => response.json())
}

/**
 * Log request to backrun tx-request and bot's response 
 * @param {String} request Raw transaction to be backrun
 * @param {Object} response Response sent to the sender
 * @param {Integer} recvBlockHeight Block number when the request was recieved
 * @param {Integer} recvTimestamp Time when the request was recieved [ms]
 * @param {Integer} returnTimestamp Time when the response was sent [ms]
 */
function logRequest(
        rawTx, 
        response, 
        recvBlockHeight, 
        recvTimestamp, 
        respTimestamp
    ) {
        logRowsToCsv([{
            id: idFromVals(arguments), 
            blockNumber: recvBlockHeight,
            timestampRecv: recvTimestamp, 
            timestampResp: respTimestamp, 
            rawTx, 
            response: JSON.stringify(response)
        }], config.constants.paths.requests)
}

/**
 * Save rows in CSV file
 * If file doesn't exist method creates it with columns
 * @param {Array} rows Rows to save
 * @param {String} saveTo Path to CSV file
 */
 function logRowsToCsv(rows, saveTo) {
    let writer = csvWriter()
    let headers = {sendHeaders: false}
    if (!fs.existsSync(saveTo))
        headers = {headers: Object.keys(rows[0])}
    writer = csvWriter(headers);
    writer.pipe(fs.createWriteStream(saveTo, {flags: 'a'}));
    rows.forEach(e => writer.write(e))
    writer.end()
}

/**
 * Return account address that signed the signed transaction
 * @param {String} rawTx 
 * @returns {String}
 */
function getSignerFromRawTx(rawTx) {
    return ethers.utils.getAddress(
        '0x' + new EthereumTx(rawTx).getSenderAddress().toString('hex')
    )
}

/**
 * Halt execution for some amount of time
 * @param {Integer} ms Amount of time to halt the execution (miliseconds)
 * @returns 
 */
function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms)
    })
}

/**
 * Check wheter the string is in hex format starting with 0x
 * @param {String} string
 * @returns {Boolean}
 */
function isHex(string) {
    return /^0x[0-9A-Fa-f]+$/.test(string)
}

/**
 * Return inverted object (swap keys for their corresponding values)
 * Only works with injective mappings
 * @param {Object} mapping Dictionary to be inverted 
 * @returns {Object} Inverted original dictionary
 */
function invertMap(mapping) {
    return Object.fromEntries(Object.entries(mapping).map(entry => {
        return [ entry[1], entry[0] ]
    }))
}

/**
 * Create unique id from passed values
 * @param {Array} vals Args on which id should be based on
 * @returns {String}
 */
function idFromVals(vals) {
    return md5(JSON.stringify(vals))
}

module.exports = { 
    convertTxDataToByteCode, 
    submitBundleToArcher, 
    getSignerFromRawTx,
    estimateGasAmount,
    unnormalizeUnits,
    normalizeUnits,
    fetchGasPrice, 
    logRowsToCsv, 
    idFromVals,
    logRequest,
    invertMap,
    sleep, 
    isHex
}