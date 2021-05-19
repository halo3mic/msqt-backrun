const unsign = require('@warren-bank/ethereumjs-tx-unsign')
const config = require('./config')
const ethers = require('ethers')

const instrMng = require('./instrManager')
const math = require('./unimath')
const utils = require('./utils')

let routerDexMap = utils.invertMap(config.constants.routers)
let BACKRUN_REQUESTS = []  // Local mempool
let PROVIDER
let validPools  // Addresses for pools that are used by valid paths

function init(provider, whitelistedPaths) {
    whitelistedPaths = whitelistedPaths || instrMng.paths  // Optional argument
    validPools = instrMng.getPoolsForPaths(whitelistedPaths)
    PROVIDER = provider
}

/**
 * Return decrypted calldata if it is supported by Uniswap ABI
 * Only whitelisted methods are supported
 * @param {Object} txRequest 
 * @returns Object
 */
function decryptUnilikeTx(txRequest) {
    let supportedMethods = config.settings.arb.supportedMethods.unilike
    let abi = new ethers.utils.Interface(config.abis['uniswapRouter'])
    // Try/catch determines if transaction fits a type
    try {
        var txDescription = abi.parseTransaction(txRequest)
        /// Exit if method is not supported
        if (!supportedMethods.includes(txDescription.functionFragment.name)) {
            return null
        }
    } catch {
        return null
    }
    let callArgs = {
        amountIn: ethers.BigNumber.from(txDescription.args.amountIn || txRequest.value),
        amountOut: txDescription.args.amountOutMin,
        method: txDescription.functionFragment.name,
        tknPath: txDescription.args.path,
        router: txRequest.to,
        deadline: txDescription.args.deadline.toNumber()
    }
    return callArgs
}

/**
 * Return decrypted calldata if it is supported by ArcherSwap ABI
 * Only whitelisted methods are supported
 * @param {Object} txRequest 
 * @returns Object
 */
function decryptArcherswapTx(txRequest) {
    let abi = new ethers.utils.Interface(config.abis['archerswapRouter'])
    let supportedMethods = config.settings.arb.supportedMethods.archerswap
    // Try/catch determines if transaction fits a type
    try {
        var txDescription = abi.parseTransaction(txRequest)
        /// Exit if method is not supported
        if (!supportedMethods.includes(txDescription.functionFragment.name)) {
            return null
        }
    } catch {
        return null
    }
    let callArgs = {
        amountIn: ethers.BigNumber.from(txDescription.args.trade.amountIn || txRequest.value),
        amountOut: txDescription.args.trade.amountOut,
        method: txDescription.functionFragment.name,
        tknPath: txDescription.args.trade.path,
        router: txDescription.args.router,
        deadline: txDescription.args.trade.deadline.toNumber()
    }
    return callArgs
}

/**
 * Unsign transaction and decrypt its calldata if contract type supported
 * Return unsigned tx, singer address and the hash of signature
 * @param {String} rawTx 
 * @returns Object
 */
function decryptRawTx(rawTx) {
    let txHash = ethers.utils.keccak256(rawTx)
    let sender = utils.getSignerFromRawTx(rawTx)
    let txRequest = unsign(rawTx).txData
    txRequest.to = ethers.utils.getAddress(txRequest.to)
    txRequest.nonce = parseInt(txRequest.nonce, 16) || 0  // If nonce is zero no nonce is passed

    let decryptMethods = [ decryptUnilikeTx, decryptArcherswapTx ]
    for (let decryptMethod of decryptMethods) {
        let callArgs = decryptMethod(txRequest)
        if (callArgs) {
            return { txRequest, callArgs, txHash, sender }
        }
    }
    return { txRequest, txHash, sender, rawTx }
}

/**
 * Return sequence of pools between tokens in token path for a dex 
 * @param {String} dexName Dex key
 * @param {Array} tknPath Token ids
 * @returns {Array} Pool ids
 */
function findPoolsForTknPath(dexName, tknPath) {
    let usedPools = []
    let dexPools = validPools.filter(p => p.exchange==dexName)
    for (let i=0; i<tknPath.length-1; i++) {
        let [ tkn0, tkn1 ] = tknPath.slice(i, i+2)
        let pool = dexPools.find(
            p=>p.tkns.map(t=>t.id).includes(tkn0) 
            && p.tkns.map(t=>t.id).includes(tkn1) 
        )
        if (!pool) {
            return
        }
        usedPools.push(pool)
    }
    return usedPools
}

/**
 * Return callArgs with formatted and additional data to call-args
 * @param {Object} callArgs 
 * @returns {Object}
 */
function enrichCallArgs(callArgs) {
    // Only save request if it involves supported dex pool
    let tknPath = callArgs.tknPath.map(tknAddress => {
        return instrMng.getTokenByAddress(tknAddress)
    })
    let dexName = routerDexMap[callArgs.router]
    let usedPools = findPoolsForTknPath(dexName, tknPath.map(t=>t.id))
    if (!usedPools) {
        return
    }
    // Normalize amounts
    let amountIn = utils.normalizeUnits(callArgs.amountIn, tknPath[0].decimal)
    let amountOutMin = utils.normalizeUnits(callArgs.amountOut, tknPath[tknPath.length-1].decimal)
    return {
        tknIds: tknPath.map(t=>t.id),
        recvTimestamp: Date.now(),
        poolAddresses: usedPools.map(p=>p.address), 
        poolIds: usedPools.map(p=>p.id), 
        deadline: callArgs.deadline,
        amountOutMin, 
        amountIn, 
    }
}

function parseBackrunRequest(rawTx) {
    let decrypted = decryptRawTx(rawTx)
    if (!decrypted) {
        // Exit if transaction is not unilike
        return
    }
    let { txRequest, callArgs, txHash, sender } = decrypted
    if (BACKRUN_REQUESTS.find(r=>r.txHash==txHash)) {
        console.log('Request with such tx hash is already in the pool')
        return
    }
    let enrichedArgs = enrichCallArgs(callArgs)
    if (!enrichedArgs) {
        console.log('Unsupported pool')
        // Exit if unsupported pool
        return
    }
    return {
        callArgs: enrichedArgs, 
        signedRequest: rawTx,
        txRequest,
        sender,
        txHash, 
    }
}

/**
 * Add decrypted and enriched signed transction to the local mempool
 * @param {String} rawTx 
 */
async function handleNewBackrunRequest(rawTx) {
    // If pool limit is reached remove some requests based on number of tries
    let spaceLeft = config.settings.arb.maxRequestPoolSize - BACKRUN_REQUESTS.length
    if (spaceLeft<1) {
        removeRequestsFromPool(1)
    }
    let parsedRequest = parseBackrunRequest(rawTx)
    if (parsedRequest) {
        BACKRUN_REQUESTS.push(parsedRequest)
        console.log('New request added!')
    }
}

// /**
//  * Check if a request fits conditions
//  * @param {Object} request 
//  * @returns {Boolean}
//  */
// async function isValidRequest(request) {
//     // Skip and remove request if tx is past deadline
//     if (request.callArgs.deadline<=Date.now()/1e3) {
//         console.log('Tx is past deadline')
//         removeRequestFromPool(request.txHash)
//         return false
//     }
//     // Skip and remove request if tx is has lower nonce than the sender
//     let txCount = await PROVIDER.getTransactionCount(request.sender)
//     if (request.txRequest.nonce < txCount) {
//         console.log('Tx has lower nonce than the sender')
//         removeRequestFromPool(request.txHash)
//         return false
//     }
//     // Skip and remove request if tx was already mined
//     let txReceipt = await PROVIDER.getTransactionReceipt(request.txHash)
//     if (txReceipt && txReceipt.status=='1') {
//         console.log('Tx was already mined')
//         removeRequestFromPool(request.txHash)
//         return false
//     }

//     return true
// }

/**
 * Calulate the reserves after trade is executed 
 * Return calculated reserves
 * @param {Object} reserves Reserves for all supported pools
 * @param {Object} callArgs Arguments with which the method was called 
 * @returns {Object}
 */
function getVirtualReserves(reserves, callArgs) {
    let { amountIn, tknIds: tknPath, poolIds: poolPath } = callArgs
    let amountOut
    let virtualReserves = {}
    for (let i=0; i<poolPath.length; i++) {
        let r0 = reserves[poolPath[i]][tknPath[i]]
        let r1 = reserves[poolPath[i]][tknPath[i+1]]
        amountOut = math.getAmountOut(amountIn, r0, r1)
        virtualReserves[poolPath[i]] = virtualReserves[poolPath[i]] || {}
        virtualReserves[poolPath[i]][tknPath[i]] = reserves[poolPath[i]][tknPath[i]].add(amountIn)
        virtualReserves[poolPath[i]][tknPath[i+1]] = reserves[poolPath[i]][tknPath[i+1]].sub(amountOut)
        amountIn = amountOut
    }
    return { virtualReserves, amountOut }
}

function removeRequestsFromPool(num) {
    // Remove the ones added first 
    BACKRUN_REQUESTS = BACKRUN_REQUESTS.slice(num, BACKRUN_REQUESTS.length)
}

function getBackrunRequests() {
    return BACKRUN_REQUESTS
}

// async function getValidBackrunRequests() {
//     return Promise.all(BACKRUN_REQUESTS.filter(isValidRequest))
// }

function cleanRequestsPool() {
    BACKRUN_REQUESTS = []
}

function removeRequestFromPool(hash) {
    BACKRUN_REQUESTS = BACKRUN_REQUESTS.filter(r => r.txHash!=hash)
}

module.exports = { 
    handleNewBackrunRequest, 
    // getValidBackrunRequests,
    removeRequestFromPool,
    findPoolsForTknPath,
    decryptArcherswapTx,
    parseBackrunRequest,
    getBackrunRequests,
    getVirtualReserves,
    cleanRequestsPool,
    decryptUnilikeTx, 
    enrichCallArgs,
    // isValidRequest,
    decryptRawTx,
    init 
}