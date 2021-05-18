// TODO: Update dispatcher balance multiple times

const ethers = require('ethers')

const reservesManager = require('./reservesManager')
const instrMng = require('./instrManager')
const backrunner = require('./backrunner')
const txManager = require('./txManager')
const logger = require('./logger')
const math = require('./unimath')
const config = require('./config')
const utils = require('./utils')

// Global vars
let GAS_PRICE
let PROVIDER
let RESERVES
let BOT_BAL
let PATHS

/**
 * Initializes arbbbot 
 * There is seperate provider for initial reserves so that initial reserves can be fetched with a live one which is 
 * a lot faster
 * @param {Provider} provider 
 * @param {Signer} signer 
 * @param {BigNumber} startGasPrice Gas price bot uses before getting updates
 * @param {Array} whitelistedPaths If passed only whitelisted paths will be arbbed
 * @param {Array} providerForInitialReserves Provider that is used to fetch all the reserves
 */
async function init(provider, signer, startGasPrice, whitelistedPaths, providerForInitialReserves) {
    providerForInitialReserves = providerForInitialReserves || provider
    let _paths = instrMng.paths  // Unfiltered paths
    _paths = whitelistedPaths || instrMng.filterPathsByConfig(_paths)
    let _reserves = await reservesManager.init(providerForInitialReserves, _paths)
    txManager.init(provider, signer)
    _setReserves(_reserves)  // Load reserves
    _setProvider(provider)
    await updateBotBal()  // Query dispatcher balance
    updateGasPrice(startGasPrice)  // Init gas price before the first update
    _paths = instrMng.filterPathsWithEmptyPool(_paths, _reserves)
    _paths = getPathsWithGasEstimate(_paths)
    _setPaths(_paths)
    backrunner.init(provider, _paths)
}

/**
 * Find opportunities for backrunning the tx requests and execute the best
 * @param {Integer} blockNumber 
 */
 async function handleBlockUpdate(blockNumber) {
    await backrunPendingRequests(blockNumber)  // Find and execute backrunning opportunities
    await updateBotBal()  // Update dispatcher balance
    await logger.flush()  // Write from memory to storage
}

async function backrunPendingRequests(blockNumber) {
    // Get only valid requests
    let backrunRequests = await backrunner.getValidBackrunRequests()
    // Evaluate and execute requests one at the time
    let opps = []
    let bundleRequests = await Promise.all(backrunRequests.map(request => {
        let opp = getOppForRequest(request)
        if (opp) {
            opps.push(opp)
            return executeOpp(opp, blockNumber)
        }
    }))
    logger.logOpps(opps, blockNumber)
    return bundleRequests
}

/**
 * Return most profitable opportunity that arise if request is executed
 * @param {Object} txRequest 
 * @returns {Object}
 */
 function getOppForRequest(txRequest) {
    // Filter only for paths with pools involved in backrun tx
    let pathsWithBackrun = instrMng.filterPathsByPools(
        getPaths(), 
        txRequest.callArgs.poolIds
    )
    let { virtualReserves, amountOut } = backrunner.getVirtualReserves(
        RESERVES, 
        txRequest.callArgs
    )
    if (amountOut.gte(txRequest.callArgs.amountOutMin)) {
        let opps = getOppsForVirtualReserves(pathsWithBackrun, virtualReserves)
        if (opps.length>0) {
            // Sort opps and pick the one with best net profit
            opps.sort((a, b) => b.netProfit.gt(a.netProfit) ? 1 : -1)
            // Add backruned-tx to the opportunity object
            let [ opp ] = opps  // Pick the best one
            utils.debug(`{"action": "opportunityFound", "opp": ${JSON.stringify(opp)}, "tx": ${JSON.stringify(txRequest)}}`)
            opp.backrunTxs = [ txRequest.signedRequest ]
            return opp
        }
    }
    return null
}

/**
 * Return opportunities from paths for virtual reserves
 * @param {Array} pathsToCheck The paths to be checked
 * @param {Object} virtualReserves Hypotetical reserves from a backrun trade  
 * @returns {Array}
 */
 function getOppsForVirtualReserves(pathsToCheck, virtualReserves) {
    let profitableOpps = []
    pathsToCheck.forEach(path => {
        let opp = arbForPath(path, virtualReserves)
        if (opp) { profitableOpps.push(opp) }
    })
    return profitableOpps
}

/**
 * Execute opportunities and log it to console and to storage
 * @param {Array} opps 
 * @param {Integer} blockNumber 
 */
 async function executeOpps(opps, blockNumber) {
    // Sort opps by net profitability
    opps.sort((a, b) => b.netProfit.gt(a.netProfit) ? 1 : -1)
    // To increase chances of success submit each opp in its own bundle
    let bundleRequests = await Promise.all(opps.map(async opp => {
        let submitTimestamp = Date.now()
        let r = await txManager.executeBundleForOpps([ opp ], blockNumber)
        let responseTimestamp = Date.now()
        // Log to csv
        logger.logRelayRequest(
            blockNumber,
            submitTimestamp, 
            responseTimestamp, 
            r.request, 
            r.response
        )
        return r
    }))
    logger.logOpps(opps, blockNumber)
    return bundleRequests
}

/**
 * Execute opportunity and log it to console and to storage
 * @param {Object} opp 
 * @returns {Object} 
 */
async function executeOpp(opp, blockNumber) {
    let submitTimestamp = Date.now()
    let r = await txManager.executeBundleForOpps([ opp ], blockNumber)
    let responseTimestamp = Date.now()
    // Log to csv
    logger.logRelayRequest(
        blockNumber,
        submitTimestamp, 
        responseTimestamp, 
        r.request, 
        r.response
    )
    return r
}

/**
 * Check if there exists arbitrage opportunity for the path and returns it
 * @param {Object} path Path checked for an arbitrage opportunity
 * @param {Object} virtualReserves Hypotetical reserves from a backrun trade 
 * @returns {Object}
 */
 function arbForPath(path, virtualReserves) {
    let reservePath = getReservePath(path, virtualReserves)
    let optimalIn = math.getOptimalAmountForPath(reservePath)
    if (optimalIn.gt("0")) {
        let avlAmount = BOT_BAL.sub(config.settings.gas.maxGasCost)  // TODO: Not relevant anymore with tipjar
        let inputAmount = avlAmount.gt(optimalIn) ? optimalIn : BOT_BAL
        let swapAmounts = math.getAmountsByReserves(inputAmount, reservePath)
        let amountOut = swapAmounts[swapAmounts.length-1]
        let grossProfit = amountOut.sub(inputAmount)
        let gasPrice = process.argv.includes('--zero-gas') ? ethers.constants.Zero : GAS_PRICE
        let gasCost= gasPrice.mul(path.gasAmount)
        let netProfit = grossProfit.sub(gasCost)
        if (netProfit.gt(config.settings.arb.minProfit)) {
            return {
                gasAmount: path.gasAmount,
                netProfit: netProfit,
                gasPrice: gasPrice,
                grossProfit,
                inputAmount, 
                swapAmounts,
                path: path,
            } 
        }
    }   
}

/**
 * Returns pool reserves in order of the arbitrage path
 * @param {Array} path Token sequence of an arbitrage opportunity
 * @param {Object} virtualReserves Hypotetical reserves from a backrun trade 
 * @returns {Array}
 */
 function getReservePath(path, virtualReserves) {
    let reservePath = []
    for (let i=0; i<path.pools.length; i++) {
        // If exists choose virtual reserve (hypothetical change)
        let poolReserves = virtualReserves[path.pools[i]] || RESERVES[path.pools[i]]
        let r0 = poolReserves[path.tkns[i]]
        let r1 = poolReserves[path.tkns[i+1]]
        reservePath.push(r0)
        reservePath.push(r1)
    }
    return reservePath
}

/**
 * Return bundle, signature and address for backrunning a tx request
 * @param {String} rawTxRequest 
 * @param {Integer} blockNumber 
 * @returns {Object}
 */
async function backrunRawRequest(rawTxRequest, blockNumber) {
    let request = backrunner.parseBackrunRequest(rawTxRequest)
    let opp = getOppForRequest(request)
    if (opp) {
        let bundle = await txManager.oppsToBundle([ opp ], blockNumber)
        let archerApiParams = await txManager.getArcherSendBundleParams(
            bundle, 
            blockNumber+1
        )
        logger.logOpps([opp], blockNumber)  // Doesnt wait for it
        return archerApiParams
    } else {
        utils.debug('No opportunities found')
        return {}
    }
}

/**
 * Returns ETH balance of dispatcher contract
 * @returns {BigNumber}
 */
 async function getDispatcherBalance() {
    return PROVIDER.getBalance(config.constants.dispatcher)
}

/**
 * Return paths with gas estimate
 * @param {Array} paths The paths for which gas should be estimated
 */
function getPathsWithGasEstimate(paths) {
    return paths.map(path => {
        path.gasAmount = utils.estimateGasAmount(path.pools.length)
        return path
    })
}

function handleNewBackrunRequest(...args) {
    return backrunner.handleNewBackrunRequest(...args)
}

function cancelRequest(hash) {
    return backrunner.removeRequestFromPool(hash)
}

function getBackrunRequests() {
    return backrunner.getBackrunRequests()
}

function updateReserves(...args) {
    return reservesManager.updateReserves(...args)
}

function updateGasPrice(gasPrice) {
    GAS_PRICE = gasPrice
}

function _setReserves(newReserves) {
    RESERVES = newReserves
}

function _setProvider(provider) {
    PROVIDER = provider
}

async function updateBotBal() {
    BOT_BAL = await getDispatcherBalance()
}

function _setPaths(paths) {
    PATHS = paths
}

function getReserves() {
    return RESERVES
}

function getPaths() {
    return PATHS
}

/**
 * Return an array of opportunities which pools won't overlap
 * The priority of the opportunities is in the order they are passed in
 * @param {Array} opps Collection of opportunities 
 * @returns {Array}
 */
 function getParallelOpps(opps) {
    let parallelOpps = []
    let poolsUsed = []
    opps.forEach(opp => {
        let pathIncludesUsedPool = opp.path.pools.filter(poolId => {
            return poolsUsed.includes(poolId)
        }).length > 0
        if (!pathIncludesUsedPool) {
            poolsUsed = [...poolsUsed, ...opp.path.pools]
            parallelOpps.push(opp)
        }
    })
    return parallelOpps
}

module.exports = {
    handleNewBackrunRequest,
    handleBlockUpdate,
    backrunRawRequest,
    updateReserves,
    cancelRequest,
    executeOpps,
    getPaths,
    init, 
    // Test visibility:
    getOppsForVirtualReserves,
    backrunPendingRequests,
    getBackrunRequests,
    getOppForRequest,
    getReservePath, 
    updateGasPrice,
    updateBotBal,
    _setReserves,
    getReserves,
    arbForPath, 
}