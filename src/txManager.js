const ethers = require('ethers')

const { getExchanges } = require('./exchanges')
const instrMng = require('./instrManager')
const config = require('./config')
const utils = require('./utils')
const { paths, pools, tokens } = instrMng

var SIGNER, PROVIDER, EXCHANGES, NONCE

function init(provider, signer) {
    EXCHANGES = getExchanges()
    PROVIDER = provider
    SIGNER = signer
}

async function unwrapEth(amount) {
    let address = config.CLIENT
    let wethContract = new ethers.Contract(address, config.ABIS['weth'])
    return wethContract.populateTransaction.withdraw(amount)
}

// TODO What is decimals bigger than 18???
function covertUnitsFrom18(num, dec) {
    // Convert everything to 18 units
    let decDiff = 18 - dec
    let multiplier = ethers.utils.parseUnits('1', decDiff)
    return num.div(multiplier)
}

async function formTipperTx(opp) {
    let dispatcherTipper = new ethers.Contract(
        config.DISPATCHER_TIPPER, 
        config.ABIS['dispatcherTipper']
    )
    return dispatcherTipper.populateTransaction.tip(
        opp.inputAmount, 
        config.TIPPER_SHARE_RATE
    )
}

async function formTradeTx(opp) {
    let path = opp.path
    let pool, tkns, amountIn
    let calldata = ''
    let inputLocs = []
    for (let i=0; i<path.pools.length; i++) {
        pool = pools.filter(p=>p.id==path.pools[i])[0]
        tkns = path.tkns.slice(i, i+2).map(tId=>tokens.filter(tObj=>tObj.id==tId)[0])
        tknAddresses = tkns.map(t=>t.address)
        if (i==0) {
            amountIn = opp.swapAmounts[i]
            amountIn = covertUnitsFrom18(amountIn, tkns[0].decimal)
        } else {
            amountIn = ethers.constants.Zero  // Pass in zero to replace this amount with query result during execution
        }
        let tradeTx = await EXCHANGES[pool.exchange].formTradeTx(amountIn, tknAddresses)
        let _inputLoc = tradeTx.inputLocs.map(loc => loc+calldata.length/2)  // Relative loc + Previous bytes
        inputLocs = [...inputLocs, ..._inputLoc]
        calldata += utils.convertTxDataToByteCode(tradeTx.tx)
    }
    calldata += await formTipperTx(opp).then(utils.convertTxDataToByteCode)
    calldata = '0x' + calldata
    return { calldata, inputLocs }
}

async function formQueryTx(opp) {
    let path = opp.path
    let pool, tkns, amountIn
    let calldata = ''
    let inputLocs = []
    for (let i=0; i<path.pools.length; i++) {
        pool = pools.filter(p=>p.id==path.pools[i])[0]
        tkns = path.tkns.slice(i, i+2).map(tId=>tokens.filter(tObj=>tObj.id==tId)[0])
        tknAddresses = tkns.map(t=>t.address)
        if (i==0) {
            amountIn = opp.swapAmounts[i]
            amountIn = covertUnitsFrom18(amountIn, tkns[0].decimal)
        } else {
            amountIn = ethers.constants.Zero  // Pass in zero to replace this amount with query result during execution
        }
        let tradeTx = await EXCHANGES[pool.exchange].formQueryTx(amountIn, tknAddresses)
        let _inputLoc = tradeTx.inputLocs.map(loc => loc+calldata.length/2)  // Relative loc + Previous bytes
        inputLocs = [...inputLocs, ..._inputLoc]
        calldata += utils.convertTxDataToByteCode(tradeTx.tx)
    }
    calldata = '0x' + calldata
    return { calldata, inputLocs }
}

async function sendBatches(bundles, targetBlock, debugOnly=false) {
    const ethCall = {
        method: 'eth_sendBundle', 
        params: [
            bundles, 
            '0x'+targetBlock.toString(16)
        ], 
        id: '1', 
        jsonrpc: '2.0'
    }
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
    let response = await utils.submitBatchesToArcher(archerApiParams)
    response = await response.json()
    let t1 = Date.now()
    console.log(`Latency: ${t1-t0} ms`)
    // console.log(response.body)
    utils.logToCsv(archerApiParams, config.ARCHER_REQUESTS_LOGS_PATH)
    let savePath = response.status=='error' ? config.ARCHER_FAIL_LOGS_PATH : config.ARCHER_PASS_LOGS_PATH
    utils.logToCsv(response, savePath)
    return response
}

async function callBatches(bundles, targetBlock, debugOnly=false) {
    const ethCall = {
        method: 'eth_callBundle', 
        params: [
            bundles, 
            '0x'+targetBlock.toString(16), 
            'latest'
        ], 
        id: '1', 
        jsonrpc: '2.0'
    }
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
    let response = await utils.submitBatchesToArcher(archerApiParams)
    response = await response.json()
    let t1 = Date.now()
    console.log(`Latency: ${t1-t0} ms`)
    // console.log(response.body)
    utils.logToCsv(archerApiParams, config.ARCHER_REQUESTS_LOGS_PATH)
    let savePath = response.status=='error' ? config.ARCHER_FAIL_LOGS_PATH : config.ARCHER_PASS_LOGS_PATH
    utils.logToCsv(response, savePath)
    return response
}

async function sendDirectlyToSimulator(bundles, targetBlock, debugOnly=false) {
    const ethCall = {
        method: 'eth_sendBundle', 
        params: [
            bundles, 
            '0x'+targetBlock.toString(16)
        ], 
        id: targetBlock+SIGNER.address, 
        jsonrpc: '2.0'
    }
    const req = {
        method: 'post',
        body: JSON.stringify(ethCall),  // stringfy
        headers: {
          'Content-Type': 'application/json',
          'X-User': SIGNER.address,  // 
          'X-Target-Block': targetBlock,
          'X-Bundle-Id': targetBlock.toString()+SIGNER.address
        }
    }
    let response = await utils.submitSimulationRequest(req)
    return response
}

async function submitTradeTx(blockNumber, txBody, queryTxResponse, opp) {
    let { calldata: calldataQuery, inputLocations } = queryTxResponse
    let archerApiParams = {
        botId: config.BOT_ID, 
        queryTx: calldataQuery,
        tradeTx: txBody, 
        targetBlock: blockNumber+1, 
        gasEstimate: opp.gasAmount, 
        estimatedProfitBeforeGas: opp.grossProfit, 
        queryBreakEven: 0,
        inputAmount: opp.inputAmount,
        inputAsset: "ETH",
        queryInputLocations: inputLocations, 
        tradeInputLocations: null, 
        blockDeadline: blockNumber+1
    }
    let response = await utils.broadcastToArcherWithOpts(...Object.values(archerApiParams))
    utils.logToCsv(archerApiParams, config.ARCHER_REQUESTS_LOGS_PATH)
    let savePath = response.status=='error' ? config.ARCHER_FAIL_LOGS_PATH : config.ARCHER_PASS_LOGS_PATH
    utils.logToCsv(response, savePath)
    return response
}

async function executeOpportunity(opportunity, blockNumber) {
    // console.log(opportunity)
    // console.log(opportunity.pathId, ethers.utils.formatEther(opportunity.grossProfit))
    let calldataTrade = await formTradeTx(opportunity)
    let queryTxResponse
    if (config.INCLUDE_QUERY) {
        queryTxResponse = await formQueryTx(opportunity)
    } else {
        queryTxResponse = {}
    }
    try {
        return submitTradeTx(blockNumber, calldataTrade, queryTxResponse, opportunity)
    } catch (e) {
        console.log(e)
    }
}

async function makeDispatcherTx({ tradeTx, queryTx, inputAmount}, gasPrice, nonce) {
    let dispatcher = new ethers.Contract(
        config.DISPATCHER, 
        config.ABIS['dispatcher'], 
        SIGNER
    )
    let makeTradeArgs = [
        queryTx.calldata,
        queryTx.inputLocs, 
        tradeTx.calldata, 
        tradeTx.inputLocs,
        inputAmount,  // Target price
        inputAmount,  // ETH input value
    ]
    let txArgs = {
        gasPrice: gasPrice, 
        gasLimit: config.GAS_LIMIT, 
        nonce: nonce
    }
    let tx = await dispatcher.populateTransaction['makeTrade(bytes,uint256[],bytes,uint256[],uint256,uint256)'](
            ...makeTradeArgs, 
            txArgs
        ).catch(e=>console.log('Failed to populate dispatcher tx:', e))
    if (process.argv.includes('--simulate')) {
        try {
            await SIGNER.estimateGas(tx)
            console.log('Tx would pass!')
        } catch (e) {
            console.log('ABORTING: Transaction would fail')
            console.log(Object.values(e)[2].response)
            return
        }
    }
    return tx
}

function decodeCalldata(calldata, abiKey) {
    let interface = new ethers.utils.Interface(config.ABIS[abiKey])
    let result = []
    let pointer = 2
    while (1) {
        let address = calldata.slice(pointer, pointer+40)  // 40
        if (address.length==0) {
            break
        }
        let len = parseInt(calldata.slice(pointer+40, pointer+40+64), 16)*2  // 64
        let _calldata = calldata.slice(pointer+40+64, pointer+40+64+len)  // len + 8
        let r = interface.decodeFunctionData('0x'+_calldata.slice(0,8), '0x'+_calldata)
        pointer = pointer+40+64+len
        result.push(r)
    }
    return result
}

async function buildDispatcherTx(opp, blockNumber, nonce) {
    let tradeTx = await formTradeTx(opp)
    let queryTx = await formQueryTx(opp)
    let makeTradeArgs = {
        blockDeadline: blockNumber+1, 
        inputAmount: opp.inputAmount,
        tradeTx, 
        queryTx
    }
    return makeDispatcherTx(makeTradeArgs, opp.gasPrice, nonce)
}

async function oppsToBundle(opps, blockNumber) {
    let bundle = []
    let nonce = await SIGNER.getTransactionCount()
    for (let opp of opps) {
        let dispatcherTx = await buildDispatcherTx(opp, blockNumber, nonce)
        dispatcherTx = await SIGNER.signTransaction(dispatcherTx)
        if (dispatcherTx) {
            bundle = [ ...bundle, ...opp.backrunTxs, dispatcherTx ]
            nonce ++
        }
    }
    return bundle
}

async function executeBatches(opps, blockNumber) {
    let bundle = await oppsToBundle(opps, blockNumber)
    if (bundle.length>0) {
        try {
            if (process.argv.includes('--call')) {
                console.log('Calling batching...')
                return callBatches(bundle, blockNumber+1)
            } else if (process.argv.includes('--simreq')) {
                console.log('Sending simulation request...')
                return sendDirectlyToSimulator(bundle, blockNumber+1)
            } else {
                console.log('Sending batches...')
                return sendBatches(bundle, blockNumber+1)
            }
        } catch (e) {
            console.log(e)
        }
    }
}

module.exports = { 
    executeOpportunity,
    executeOpportunity,
    buildDispatcherTx, 
    makeDispatcherTx,
    executeBatches,
    oppsToBundle,
    sendBatches,
    formTradeTx, 
    init, 
}