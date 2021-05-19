const { BigNumber } = require('ethers')
const resolve = require('path').resolve
const path = require('path')
require('dotenv').config()
const fs = require('fs')

const constants = require('../config/constants.json')
const settings = require('../config/settings.json')

/**
 * Return all ABIs in abi folder packed in an object
 * @returns {Object}
 */
function loadAllABIs() {
    // Loads all available ABIs in the memory
    const abisLocalPath = "../config/abis"
    const absPath = resolve(`${__dirname}/${abisLocalPath}`)
    const files = fs.readdirSync(absPath)
    const abis = Object.fromEntries(files.map(fileName => [
            fileName.split('.')[0], 
            require(path.join(absPath, fileName))
        ])
    )
    return abis
}

/**
 * Return private key based on passed arguments
 * @returns {Object}
 */
function getPrivateKey() {
    let prefix = '--pk='
    let pkNum = process.argv.filter(a => a.includes(prefix))
    let pkWithAddress = pkNum.length>0 ? process.env[`PK${pkNum[0].replace(prefix, '')}`] : process.env.PK1
    let pk = pkWithAddress.slice(43)
    return pk
}

/**
 * With vebose set to true, process state will be logged in the console
 * @returns {boolean}
 */
function isVerbose() {
    return process.env.DEBUG!='1'
}

settings.arb.emptyPoolThreshold = BigNumber.from(settings.arb.emptyPoolThreshold)
settings.arb.tipperShareRate = BigNumber.from(settings.arb.tipperShareRate)
settings.gas.maxGasCost = BigNumber.from(settings.gas.maxGasCost)
settings.arb.minProfit = BigNumber.from(settings.arb.minProfit)
settings.network.rpcEndpoint = process.env.HTTP_ENDPOINT
settings.network.wsEndpoint = process.env.WS_ENDPOINT
settings.network.privateKey = getPrivateKey()
settings.verbose = isVerbose()
abis = loadAllABIs()

module.exports = {
    constants,
    settings,
    abis,
}