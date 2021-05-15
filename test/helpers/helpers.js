

function load() {
    // Load local modules
    reservesMng = require('../../src/reservesManager')
    instrMng = require('../../src/instrManager')
    backrunner = require('../../src/backrunner')
    txMng = require('../../src/txManager')
    logger = require('../../src/logger')
    server = require('../../src/server')
    arbbot = require('../../src/arbbot')
    config = require('../../src/config')
    utils = require('../../src/utils')
    let addresses = require('./addresses.json') 
    assets = addresses.assets
    unilikeRouters = addresses.unilikeRouters
    // Load external modules
    fetch = require('node-fetch')
    expect = require("chai").expect
    ethers = require("hardhat").ethers
    csv = require('csvtojson')
    fs = require('fs');

    // Load constants
    ZERO = ethers.constants.Zero

    // Load methods
    makeAccountGen = async function () {
        function* getNewAccount() {
            for (let account of accounts) {
                yield account
            }
        }
        accounts = await ethers.getSigners();
        let newAccountGen = getNewAccount()
        let genNewAccount = () => newAccountGen.next().value
        return genNewAccount
    }
    
    impersonateAccount = async function (address) {
        return network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [ address ],
          })
    }
    postToBot = function (method, data, port) {
        let url = 'http://localhost'
        port = port || 8888
        return fetch(
            `${url}:${port}/${method}`, 
            {
                method: 'post',
                body:    data,
                headers: { 'Content-Type': 'application/text' },
            }
        )
    }
    cleanTempLogs = function () {
        // Clean the test logs
		try { fs.unlinkSync(config.constants.paths.requests) } catch {} 
		try { fs.unlinkSync(config.constants.paths.opps) } catch {} 
		try { fs.unlinkSync(config.constants.paths.relayRequests) } catch {} 
    }
    isNumeric = function (value) {
        return /^-?\d+$/.test(value);
    }
    isString = function (value) {
        return (typeof value == 'string') && (value!='')
    }
    function modifyColors(it, describe) {
        // Modify colors to distinguish between execution output and tests easier
        const _clrYellow = '\x1b[33m'
        const _clrCyan = '\x1b[36m'
        const _clrReset = '\x1b[0m'
        var originalIt = it
        it = (description, fun) => {
            return originalIt(_clrCyan+description+_clrReset, fun)
        }
        var originalDescribe = describe
        describe = (description, fun) => {
            return originalDescribe(_clrYellow+description+_clrReset, fun)
        }
        return [ it, describe ]
    }
    async function topUpAccountWithETH(topper, recieverAddress, amount) {
        await topper.sendTransaction({
            to: recieverAddress, 
            value: amount
        })
    }

	topUpAccountWithToken = async function (topper, recieverAddress, tokenAddress, amount, unilikeRouterAddress) {
        let router = unilikeRouterAddress || unilikeRouters.uniswap
        let routerContract = new ethers.Contract(router, config.ABIS['uniswapRouter'])
        await routerContract.connect(topper).swapETHForExactTokens(
            amount, 
            [ assets.WETH, tokenAddress ], 
            recieverAddress, 
            parseInt(Date.now()/1e3)+3000
        ).then(response => response.wait())
    }
    // Actions
    [ it, describe ]  = modifyColors(it, describe)
    // Dont overwrite the default logs
    config.constants.paths.requests = __dirname + '/../logs/.test.requests.csv'
    config.constants.paths.relayRequests = __dirname + '/../logs/.test.relayRequests.csv'
    config.constants.paths.opps = __dirname + '/../logs/.test.opps.csv'
}



module.exports = { load } 


