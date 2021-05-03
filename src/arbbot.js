const ethers = require('ethers')

const reservesManager = require('./reservesManager')
const instrMng = require('./instrManager')
const backrunner = require('./backrunner')
const txManager = require('./txManager')
const config = require('./config')
const utils = require('./utils')
const math = require('./math')

let BOT_BAL
let RESERVES
let PROVIDER
let GAS_PRICE
let PREV_OPP_PATHS = []  // Paths that had opportunities in the last block
let { paths } = instrMng


async function init(provider, signer, startGasPrice, whitelistedPaths) {
    paths = whitelistedPaths || instrMng.filterPaths(paths)
    await reservesManager.init(provider, paths)
    txManager.init(provider, signer)
    backrunner.init(provider)
    _setReserves(reservesManager.getAllReserves())  // Load reserves
    _setBotBal(await provider.getBalance(config.DISPATCHER))
    _setProvider(provider)
    updateGasPrice(startGasPrice)
}

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

function arbForPath(path, virtualReserves) {
    let reservePath = getReservePath(path, virtualReserves)
    let optimalIn = math.getOptimalAmountForPath(reservePath)
    if (optimalIn.gt("0")) {
        let avlAmount = BOT_BAL.sub(config.MAX_GAS_COST)
        let inputAmount = avlAmount.gt(optimalIn) ? optimalIn : avlAmount
        let swapAmounts = math.getAmountsByReserves(inputAmount, reservePath)
        let amountOut = swapAmounts[swapAmounts.length-1]
        let grossProfit = amountOut.sub(inputAmount)
        let gasAmount = utils.estimateGasAmount(path.pools.length)
        let gasPrice = process.argv.includes('--zero-gas') ? ethers.constants.Zero : GAS_PRICE
        let gasCost= gasPrice.mul(gasAmount)
        let netProfit = grossProfit.sub(gasCost)
        if (netProfit.gt(config.MIN_PROFIT)) {
            return {
                gasAmount: gasAmount,
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

// async function handleBlockUpdate(blockNumber, updatedPools) {
//     let profitableOpps = arbForPools(updatedPools)
//     if (profitableOpps.length>0) {
//         profitableOpps.sort((a, b) => b.netProfit.gt(a.netProfit) ? 1 : -1)
//         let parallelOpps = getParallelOpps(profitableOpps)
//         await handleOpp(blockNumber, parallelOpps)
//     }
//     PREV_OPP_PATHS = profitableOpps.map(opp => opp.path.id)
//     console.log(`Processing time: ${Date.now()-START_TIME} ms`)
//     BOT_BAL = await PROVIDER.getBalance(config.DISPATCHER);
//     console.log(`${blockNumber} | BALANCE: ${ethers.utils.formatUnits(BOT_BAL)}`);
// }

// /**
//  * Return an array of opportunities which pools won't overlap
//  * @param {Object} opp - Parameters describing opportunity
//  * @returns {Array}
//  */
//  function getParallelOpps(opps) {
//     let parallelOpps = []
//     let poolsUsed = []
//     opps.forEach(opp => {
//         let pathIncludesUsedPool = opp.path.pools.filter(poolId => {
//             return poolsUsed.includes(poolId)
//         }).length > 0
//         if (!pathIncludesUsedPool && parallelOpps.length<config.MAX_BUNDLE_SIZE) {
//             poolsUsed = [...poolsUsed, ...opp.path.pools]
//             parallelOpps.push(opp)
//         }
//     })
//     return parallelOpps
// }

function getPathsForUpdatedPools(orgPaths, updatedPools) {
    return orgPaths.filter(path => {
        // Only inlude the paths using a pool that was updated 
        let includesUpdatedPool = path.pools.filter(pool => {
            return updatedPools.includes(pool)
        }).length > 0
        // Include the paths from prev block again (opp might still exist)
        let pathInPrevOpps = PREV_OPP_PATHS.includes(path.id)
        return includesUpdatedPool || pathInPrevOpps
    })
}

function getOppsForRequest(pathsToCheck, virtualReserves) {
    let profitableOpps = []
    pathsToCheck.forEach(path => {
        let opp = arbForPath(path, virtualReserves)
        if (opp) {
            profitableOpps.push(opp)
        }
    })
    return profitableOpps
}

function getOpps(requestsToCheck) {
    let opps = []
    requestsToCheck.forEach(request => {
        // Filter only for paths with pools involved in backrun tx
        let pathsWithBackrun = getPathsForUpdatedPools(
            paths, 
            request.callArgs.poolIds
        )
        let { virtualReserves, amountOut} = backrunner.getVirtualReserves(
            RESERVES, 
            request.callArgs
        )
        if (amountOut.gte(request.callArgs.amountOutMin)) {
            let _opps = getOppsForRequest(pathsWithBackrun, virtualReserves)
            opps = _opps.map(opp => {
                opp.backrunTxs = [ request.signedRequest ]
                return opp
            })
            opps = [ ...opps, ..._opps ]
        }
    })
    return opps
}

async function handleBlockUpdate(blockNumber) {
    // let backrunRequests = backrunner.getBackrunRequests()
    let backrunRequests = await backrunner.getValidBackrunRequests()
    let opps = getOpps(backrunRequests)
    if (opps.length>0) {
        opps.sort((a, b) => b.netProfit.gt(a.netProfit) ? 1 : -1)
        await handleOpp(blockNumber, [opps[0]])
    }
}

async function handleOpp(blockNumber, opps) {
    try {
        let response = await txManager.executeBatches(opps, blockNumber)
        opps.forEach(printOpportunityInfo)
        console.log(response)
    }
    catch (error) {
        console.log(`${blockNumber} | ${Date.now()} | Failed to send tx ${error.message}`)
    }
}

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

function getReserves() {
    return RESERVES
}

function updateReserves(...args) {
    return reservesManager.updateReserves(...args)
}

function updateGasPrice(gasPrice) {
    GAS_PRICE = gasPrice
}

function getBackrunRequests() {
    return backrunner.getBackrunRequests()
}

function _setReserves(newReserves) {
    RESERVES = newReserves
    paths = instrMng.filterPaths(paths, newReserves)

}

function _setBotBal(newBal) {
    BOT_BAL = newBal
}

function _setProvider(provider) {
    PROVIDER = provider
}

module.exports = {
    handleBlockUpdate,
    updateReserves,
    init, 
    // Test visibility:
    getBackrunRequests,
    getOppsForRequest,
    getReservePath, 
    updateGasPrice,
    _setReserves,
    _setBotBal,
    getReserves,
    arbForPath, 
    handleOpp,
    getOpps,
}