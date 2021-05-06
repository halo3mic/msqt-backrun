// TODO: Update dispatcher balance multiple times

const ethers = require('ethers')

const reservesManager = require('./reservesManager')
const instrMng = require('./instrManager')
const backrunner = require('./backrunner')
const txManager = require('./txManager')
const config = require('./config')
const utils = require('./utils')
const math = require('./unimath')

// Global vars
let GAS_PRICE
let PROVIDER
let RESERVES
let BOT_BAL
let PATHS

/**
 * Initializes arbbbot 
 * @param {Provider} provider 
 * @param {Signer} signer 
 * @param {BigNumber} startGasPrice Gas price bot uses before getting updates
 * @param {Array} whitelistedPaths If passed only whitelisted paths will be arbbed
 */
async function init(provider, signer, startGasPrice, whitelistedPaths) {
    let _paths = instrMng.paths  // Unfiltered paths
    _paths = whitelistedPaths || instrMng.filterPathsByConfig(_paths)
    let _reserves = await reservesManager.init(provider, _paths)
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
 * Return opportunities that arise if request is executed
 * @param {Object} txRequest 
 * @returns {Array}
 */
function getOppsForRequest(txRequest) {
    // Filter only for paths with pools involved in backrun tx
    let pathsWithBackrun = instrMng.filterPathsByPools(
        getPaths(), 
        txRequest.callArgs.poolIds
    )
    let { virtualReserves, amountOut} = backrunner.getVirtualReserves(
        RESERVES, 
        txRequest.callArgs
    )
    if (amountOut.gte(txRequest.callArgs.amountOutMin)) {
        let opps = getOppsForVirtualReserves(pathsWithBackrun, virtualReserves)
        // Add backruned-tx to the opportunity object
        opps = opps.map(opp => {
            opp.backrunTxs = [ txRequest.signedRequest ]
            return opp
        })
        return opps
    }
    return []
}

/**
 * Find opportunities for backrunning the tx requests and execute the best
 * @param {Integer} blockNumber 
 */
async function handleBlockUpdate(blockNumber) {
    // Get only valid requests
    // TODO: Should this be done in the bot? Call `getBackrunRequests` instead?
    let backrunRequests = await backrunner.getValidBackrunRequests()
    // Get all opportunities for all requets and put them in a single array
    let opps = backrunRequests.map(request => getOppsForRequest(request)).flat()
    if (opps.length>0) {
        opps.sort((a, b) => b.netProfit.gt(a.netProfit) ? 1 : -1)
        // Execute only the best opportunity found 
        // TODO: In the future handle more opportunities at once
        await handleOpp(blockNumber, [opps[0]])
    }
    await updateBotBal()
}

/**
 * Execute opportunity and log it to console and to storage
 * @param {Integer} blockNumber 
 * @param {Array} opps 
 */
async function handleOpp(blockNumber, opps) {
    try {
        let response = await txManager.executeBundles(opps, blockNumber)
        opps.forEach(printOpportunityInfo)
        console.log(response)  // Response from Archer
    }
    catch (error) {
        console.log(`${blockNumber} | ${Date.now()} | Failed execute opportunity ${error.message}`)
    }
}

/**
 * Return bundle, signature and address for backrunning a tx request
 * @param {String} rawTxRequest 
 * @param {Integer} blockNumber 
 * @returns {Object}
 */
async function backrunRequest(rawTxRequest, blockNumber) {
    let request = backrunner.parseBackrunRequest(rawTxRequest)
    let opps = getOppsForRequest(request)
    if (opps.length>0) {
        opps.sort((a, b) => b.netProfit.gt(a.netProfit) ? 1 : -1)
        // Get bundles only for the best opportunity found 
        // TODO: In the future handle more opportunities at once
        let bundle = await txManager.oppsToBundle([ opps[0] ], blockNumber)
        let archerApiParams = await txManager.getArcherSendBundleParams(
            bundle, 
            blockNumber+1
        )
        return archerApiParams
    } else {
        console.log('No opportunities found')
        return {}
    }
}

// TODO: Add to utils?
/**
 * Log opportunity details and tx status to console
 * @param {Object} opp - Parameters describing opportunity
 * @param {Object} txReceipt - Transaction receipt
 */
 function printOpportunityInfo(opp) {
    let gasCostFormatted = ethers.utils.formatUnits(opp.grossProfit.sub(opp.netProfit))
    let inputAmountFormatted = ethers.utils.formatUnits(opp.swapAmounts[0])
    let grossProfitFormatted = ethers.utils.formatUnits(opp.grossProfit)
    let netProfitFormatted = ethers.utils.formatUnits(opp.netProfit)
    console.log('_'.repeat(50))
    console.log(`${opp.blockNumber} | ${Date.now()} | 🕵️‍♂️ ARB AVAILABLE`)
    console.log('Path: ', opp.path.symbol)
    console.log(`Input amount: ${inputAmountFormatted}`)
    console.log(`Gross profit: ${grossProfitFormatted}`)
    console.log(`Net profit: ${netProfitFormatted}`)
    console.log(`Gas cost: ${gasCostFormatted}`)
    console.log('^'.repeat(50))
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

// TODO: Move in utils?
// /**
//  * Return an array of opportunities which pools won't overlap
//  * @param {Array} opps Collection of opportunities 
//  * @returns {Array}
//  */
//  function getParallelOpps(opps) {
//     let parallelOpps = []
//     let poolsUsed = []
//     opps.forEach(opp => {
//         let pathIncludesUsedPool = opp.path.pools.filter(poolId => {
//             return poolsUsed.includes(poolId)
//         }).length > 0
//         if (!pathIncludesUsedPool) {
//             poolsUsed = [...poolsUsed, ...opp.path.pools]
//             parallelOpps.push(opp)
//         }
//     })
//     return parallelOpps
// }

module.exports = {
    handleNewBackrunRequest,
    handleBlockUpdate,
    backrunRequest,
    updateReserves,
    getPaths,
    init, 
    // Test visibility:
    getOppsForVirtualReserves,
    getBackrunRequests,
    getOppsForRequest,
    getReservePath, 
    updateGasPrice,
    _setReserves,
    getReserves,
    updateBotBal,
    arbForPath, 
}