const unsign = require('@warren-bank/ethereumjs-tx-unsign')
const EthereumTx = require('ethereumjs-tx').Transaction
const { ABIS } = require('./config')
const ethers = require('ethers')
const { BigNumber } = ethers

const pools = require('../config/pools.json')
const tokens = require('../config/tokens.json')
const { getExchanges } = require('./exchanges')
const math = require('./math')

let routerDexMap = Object.fromEntries(Object.entries(getExchanges()).map(entry => {
    return [ entry[1].routerAddress, entry[0] ]
}))

let BACKRUN_REQUESTS = []
let PROVIDER

function init(provider) {
    PROVIDER = provider
}

function getSignerFromRawTx(rawTx) {
    return ethers.utils.getAddress(
        '0x' + new EthereumTx(rawTx).getSenderAddress().toString('hex')
    )
}

function decryptUnilikeTx(txRequest) {
    let abi = new ethers.utils.Interface(ABIS['uniswapRouter'])
    try {
        var txDescription = abi.parseTransaction(txRequest)  // !This determines if transaction fits a type
    } catch {
        console.log('Transaction type is not supported')
        return null
    }
    let callArgs = {
        amountIn: BigNumber.from(txDescription.args.amountIn || txRequest.value),
        amountOut: txDescription.args.amountOutMin,
        method: txDescription.functionFragment.name,
        tknPath: txDescription.args.path,
        router: txRequest.to,
        deadline: txDescription.args.deadline.toNumber()
    }
    return callArgs
}

function decryptArcherswapTx(txRequest) {
    let abi = new ethers.utils.Interface(ABIS['archerswapRouter'])
    try {
        var txDescription = abi.parseTransaction(txRequest)  // !This determines if transaction fits a type
    } catch {
        return null
    }
    // let tipFromAmountIn = ethers.constants.Zero  // Amount that gets subtracted from amountIn
    // if (txDescription.args.tipPct) {
    //     tipFromAmountIn = txDescription.args.trade.amountIn.mul(txDescription.args.tipPct)
    // } else if (txDescription.args.tipAmount) {
    //     tipFromAmountIn = txDescription.args.tipAmount
    // }
    // let amountIn = BigNumber.from(txDescription.args.trade.amountIn || txRequest.value).sub(tipFromAmountIn)
    let callArgs = {
        amountIn: BigNumber.from(txDescription.args.trade.amountIn || txRequest.value),
        amountOut: txDescription.args.trade.amountOut,
        method: txDescription.functionFragment.name,
        tknPath: txDescription.args.trade.path,
        router: txDescription.args.router,
        deadline: txDescription.args.trade.deadline.toNumber()
    }
    return callArgs
}

function decryptRawTx(rawTx) {
    let txHash = ethers.utils.keccak256(rawTx)
    let sender = getSignerFromRawTx(rawTx)
    let txRequest = unsign(rawTx).txData
    txRequest.to = ethers.utils.getAddress(txRequest.to)
    txRequest.nonce = parseInt(txRequest.nonce, 16)

    let decryptMethods = [ decryptUnilikeTx, decryptArcherswapTx ]
    for (let decryptMethod of decryptMethods) {
        let callArgs = decryptMethod(txRequest)
        if (callArgs) {
            return { txRequest, callArgs, txHash, sender }
        }
    }
    return { txRequest, txHash, sender }
}

function findPoolsForTknPath(dexName, tknPath) {
    // Tkn path is array of tkn ids
    let usedPools = []
    let dexPools = pools.filter(p => p.exchange==dexName)
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

// TODO: Move to utils
/**
 * Return normalized number
 * @param {ethers.BigNumber} num - Amount
 * @param {ethers.BigNumber} dec - Token decimals
 * @returns {ethers.BigNumber}
 */
 function normalizeUnits(num, dec) {
    // Convert everything to 18 dec
    return ethers.utils.parseUnits(
        ethers.utils.formatUnits(num, dec)
    )
}

/**
 * Emrich call-args for backrun tx
 * @param {Object} callArgs 
 * @returns {Object}
 */
function enrichCallArgs(callArgs) {
    // Only save request if it involves supported dex pool
    let tknPath = callArgs.tknPath.map(tknAddress => {
        return tokens.find(t=>tknAddress==t.address)
    })
    let dexName = routerDexMap[callArgs.router]
    let usedPools = findPoolsForTknPath(dexName, tknPath.map(t=>t.id))
    if (!usedPools) {
        return
    }
    // Normalize amounts
    let amountIn = normalizeUnits(callArgs.amountIn, tknPath[0].decimal)
    let amountOutMin = normalizeUnits(callArgs.amountOut, tknPath[tknPath.length-1].decimal)
    return {
        tknPath: tknPath.map(t=>t.id),
        recvTimestamp: Date.now(),
        poolAddresses: usedPools.map(p=>p.address), 
        poolIds: usedPools.map(p=>p.id), 
        deadline: callArgs.deadline,
        amountOutMin, 
        amountIn, 
    }
}

function handleNewBackrunRequest(rawTx) {
    // TODO: Set max size for requests pool
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
    if (BACKRUN_REQUESTS.length>config.MAX_REQUESTS_POOL_SIZE) {
        // TODO: First check if requests are still valid and only then remove them
        removeRequestsFromPool(1)  // Remove one request
    }
    BACKRUN_REQUESTS.push({
        callArgs: enrichedArgs, 
        signedRequest: rawTx,
        txRequest,
        sender,
        txHash, 
    })
}

async function isValidRequest(request) {
    // Skip and remove request if tx is past deadline
    if (request.callArgs.deadline<=Date.now()/1e3) {
        console.log('Tx is past deadline')
        removeRequestFromPool(request.txHash)
        return false
    }
    // Skip and remove request if tx is has lower nonce than the sender
    let txCount = await PROVIDER.getTransactionCount(request.sender)
    if (request.txRequest.nonce < txCount) {
        console.log('Tx has lower nonce than the sender')
        removeRequestFromPool(request.txHash)
        return false
    }
    // Skip and remove request if tx was already mined
    let txReceipt = await PROVIDER.getTransactionReceipt(request.txHash)
    if (txReceipt && txReceipt.status=='1') {
        console.log('Tx was already mined')
        removeRequestFromPool(request.txHash)
        return false
    }
    // Skip and remove tx if sender doesnt have enough funds
    // TODO: Account for tx gas cost more accurately
    let senderEth = await PROVIDER.getBalance(request.sender)
    if (senderEth.lt(request.callArgs.amountIn)) {
        console.log('Insufficient funds')
        removeRequestFromPool(request.txHash)
        return false
    }
    // TODO: Check if sender has enough permission and tokens for trading

    return true
}

function getVirtualReserves(reserves, callArgs) {
    let { amountIn, tknPath, poolIds: poolPath } = callArgs
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
    BACKRUN_REQUESTS = BACKRUN_REQUESTS.sort(
        (a,b) => a.recvTimestamp-b.recvTimestamp
    ).slice(0, num)
}

function getBackrunRequests() {
    return BACKRUN_REQUESTS
}

async function getValidBackrunRequests() {
    return Promise.all(BACKRUN_REQUESTS.filter(isValidRequest))
}

function cleanRequestsPool() {
    BACKRUN_REQUESTS = []
}

function removeRequestFromPool(hash) {
    BACKRUN_REQUESTS = BACKRUN_REQUESTS.filter(r => r.txHash!=hash)
}

module.exports = { 
    handleNewBackrunRequest, 
    getValidBackrunRequests,
    decryptArcherswapTx,
    getBackrunRequests,
    getVirtualReserves,
    cleanRequestsPool,
    decryptUnilikeTx, 
    enrichCallArgs,
    isValidRequest,
    decryptRawTx,
    init 
}