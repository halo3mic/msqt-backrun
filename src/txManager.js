const ethers = require('ethers')

const { getExchanges } = require('./exchanges')
const instrMng = require('./instrManager')
const config = require('./config')
const utils = require('./utils')

var SIGNER, PROVIDER, EXCHANGES

function init(provider, signer) {
    EXCHANGES = getExchanges()
    PROVIDER = provider
    SIGNER = signer
}

/**
 * Convert opportunities into bundles and either simulate or submit them
 * Return network response
 * @param {Array} opps 
 * @param {Number} blockNumber 
 * @returns {Object}
 */
async function executeBundles(opps, blockNumber) {
    let bundle = await oppsToBundle(opps, blockNumber)
    if (bundle.length>0) {
        try {
            if (process.argv.includes('--call')) {
                console.log('Calling bundle...')
                return callBundles(bundle, blockNumber+1)
            } else {
                console.log('Sending bundle...')
                return sendBundles(bundle, blockNumber+1)
            }
        } catch (e) {
            console.log(e)
        }
    }
}

/**
 * Turn opportunities into bundle
 * Include backrun transactions 
 * Return bundle
 * @param {Array} opps 
 * @param {Number} blockNumber 
 * @returns {Array}
 */
async function oppsToBundle(opps, blockNumber) {
    let bundle = []
    let nonce = await SIGNER.getTransactionCount()
    for (let opp of opps) {
        let dispatcherTx = await formDispatcherTx(opp, nonce)
        dispatcherTx = await SIGNER.signTransaction(dispatcherTx)
        if (dispatcherTx) {
            bundle = [ ...bundle, ...opp.backrunTxs, dispatcherTx ]
            nonce ++
        }
    }
    return bundle
}

/**
 * Submit bundle to archer network to submit it
 * Return network response indicating submission success
 * @param {Array} bundle
 * @param {Number} targetBlock 
 * @param {Boolean} debugOnly 
 * @returns {Object}
 */
async function sendBundles(bundle, targetBlock, debugOnly=false) {
    let archerApiParams = await getArcherSendBundleParams(bundle, targetBlock)
    if (debugOnly) {
        return archerApiParams
    }
    let t0 = Date.now()
    let response = await utils.submitBundleToArcher(archerApiParams)
    let t1 = Date.now()
    console.log(`Latency: ${t1-t0} ms`)
    return response
}

/**
 * Submit bundle to archer network to simulate it
 * Return network response including simulation results
 * @param {Array} bundle
 * @param {Number} targetBlock 
 * @param {Boolean} debugOnly 
 * @returns {Object}
 */
async function callBundles(bundles, targetBlock, debugOnly=false) {
    let ethCall = await getArcherCallBundleParams(bundles, targetBlock)
    let inter = ethers.utils.id(JSON.stringify(ethCall))
    let signature = await SIGNER.signMessage(inter)
    let senderAddress = SIGNER.address
    let archerApiParams = {
        ethCall, 
        signature, 
        senderAddress
    }
    if (debugOnly) {
        return archerApiParams
    }
    let t0 = Date.now()
    let response = await utils.submitBundleToArcher(archerApiParams)
    let t1 = Date.now()
    console.log(`Latency: ${t1-t0} ms`)
    return response
}

/**
 * Return arguments required for `eth_sendBundle` request to Archer network
 * @param {Array} bundle
 * @param {Number} targetBlock 
 * @returns {Object}
 */
async function getArcherSendBundleParams(bundle, targetBlock) {
    const ethCall = {
        method: 'eth_sendBundle', 
        params: [
            bundle, 
            '0x'+targetBlock.toString(16)
        ], 
        id: '1', 
        jsonrpc: '2.0'
    }
    let inter = ethers.utils.id(JSON.stringify(ethCall))
    let signature = await SIGNER.signMessage(inter)
    let senderAddress = SIGNER.address
    return {
        senderAddress,
        signature, 
        ethCall, 
    }
}

/**
 * Return arguments required for `eth_callBundle` request to Archer network
 * @param {Array} bundle
 * @param {Number} targetBlock 
 * @returns {Object}
 */
async function getArcherCallBundleParams(bundle, targetBlock) {
    const ethCall = {
        method: 'eth_callBundle', 
        params: [
            bundle, 
            '0x'+targetBlock.toString(16), 
            'latest'
        ], 
        id: '1', 
        jsonrpc: '2.0'
    }
    let inter = ethers.utils.id(JSON.stringify(ethCall))
    let signature = await SIGNER.signMessage(inter)
    let senderAddress = SIGNER.address
    return {
        senderAddress,
        signature, 
        ethCall, 
    }
}

/**
 * Returns transaction request to the dispatcher contract
 * @param {Object} opp 
 * @param {Integer} nonce 
 * @returns {TransactionRequest}
 */
async function formDispatcherTx(opp, nonce) {
    let tradeTx = await formTrade(opp)
    let queryTx = await formQuery(opp)
    let dispatcher = new ethers.Contract(
        config.constants.dispatcher, 
        config.abis['dispatcher'], 
        SIGNER
    )
    let makeTradeArgs = [
        queryTx.calldata,
        queryTx.inputLocs, 
        tradeTx.calldata, 
        tradeTx.inputLocs,
        opp.inputAmount,  // Target price
        opp.inputAmount,  // ETH input value
    ]
    let txArgs = {
        gasPrice: ethers.constants.Zero,  // Miner is tipped 
        gasLimit: config.settings.gas.gasLimit, 
        nonce: nonce
    }
    return dispatcher.populateTransaction['makeTrade(bytes,uint256[],bytes,uint256[],uint256,uint256)'](
            ...makeTradeArgs, 
            txArgs
        ).catch(e=>console.log('Failed to populate dispatcher tx:', e))
}

/**
 * Returns calldata for opportunity execution and insert locations for it
 * @param {Object} opp 
 * @returns {Object}
 */
async function formTrade(opp) {
    let path = opp.path
    let pool, tkns, amountIn
    let calldata = ''
    let inputLocs = []
    for (let i=0; i<path.pools.length; i++) {
        pool = instrMng.getPoolById(path.pools[i])
        tkns = path.tkns.slice(i, i+2).map(t => instrMng.getTokenById(t))
        tknAddresses = tkns.map(t => t.address)
        if (i==0) {
            amountIn = opp.swapAmounts[i]
            amountIn = utils.unnormalizeUnits(amountIn, tkns[0].decimal)
        } else {
            amountIn = ethers.constants.Zero  // Pass in zero to replace this amount with query result during execution
        }
        let tradeTx = await EXCHANGES[pool.exchange].formTrade(amountIn, tknAddresses)
        let _inputLoc = tradeTx.inputLocs.map(loc => loc+calldata.length/2)  // Relative loc + Previous bytes
        inputLocs = [...inputLocs, ..._inputLoc]
        calldata += utils.convertTxDataToByteCode(tradeTx.tx)
    }
    calldata += await formTipperTx(opp).then(utils.convertTxDataToByteCode)
    calldata = '0x' + calldata
    return { calldata, inputLocs }
}

/**
 * Returns calldata for opportunity query and insert locations for it
 * @param {Object} opp 
 * @returns {Object}
 */
async function formQuery(opp) {
    let path = opp.path
    let pool, tkns, amountIn
    let calldata = ''
    let inputLocs = []
    for (let i=0; i<path.pools.length; i++) {
        pool = instrMng.getPoolById(path.pools[i])
        tkns = path.tkns.slice(i, i+2).map(t => instrMng.getTokenById(t))
        tknAddresses = tkns.map(t => t.address)
        if (i==0) {
            amountIn = opp.swapAmounts[i]
            amountIn = utils.unnormalizeUnits(amountIn, tkns[0].decimal)
        } else {
            amountIn = ethers.constants.Zero  // Pass in zero to replace this amount with query result during execution
        }
        let tradeTx = await EXCHANGES[pool.exchange].formQuery(amountIn, tknAddresses)
        let _inputLoc = tradeTx.inputLocs.map(loc => loc+calldata.length/2)  // Relative loc + Previous bytes
        inputLocs = [...inputLocs, ..._inputLoc]
        calldata += utils.convertTxDataToByteCode(tradeTx.tx)
    }
    calldata = '0x' + calldata
    return { calldata, inputLocs }
}

/**
 * Returns transaction request to the TipJar contract
 * @param {Object} opp 
 * @returns {TransactionRequest}
 */
async function formTipperTx(opp) {
    let dispatcherTipper = new ethers.Contract(
        config.constants.dispatcherTipper, 
        config.abis['dispatcherTipper']
    )
    return dispatcherTipper.populateTransaction.tip(
        opp.inputAmount, 
        config.settings.arb.tipperShareRate
    )
}

module.exports = { 
    getArcherSendBundleParams,
    formDispatcherTx,
    executeBundles,
    oppsToBundle,
    sendBundles,
    init, 
}