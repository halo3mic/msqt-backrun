const express = require('express')

const { provider, signer } = require('./provider').ws
const { BigNumber } = require('ethers')
const instrMng = require('./instrManager')
const arbbot = require('./arbbot')
const config = require('./config')
const logger = require('./logger')
const utils = require('./utils')

let BLOCK_HEIGHT
let PROVIDER
let POOLS  // Addresses for pools that are used by valid paths
let requestListener

async function init(_provider, whitelistedPaths, providerForInitialReserves) {
    providerForInitialReserves = providerForInitialReserves || provider
    PROVIDER = _provider || provider
    console.log('Initializing')
    let startGasPrice = await utils.fetchGasPrice(config.settings.gas.gasSpeed)
    await arbbot.init(PROVIDER, signer, startGasPrice, whitelistedPaths, providerForInitialReserves)
    BLOCK_HEIGHT = await PROVIDER.getBlockNumber()
    POOLS = instrMng.getPoolsForPaths(arbbot.getPaths()).map(p => p.address)
}

function startListeners() {
    startListeningForBlocks()
    startRequestUpdates()
}

/**
 * Listen for new blocks
 * Update reserves if Sync logs are found
 */
function startListeningForBlocks() {
    const filter = { topics: [ config.constants.uniswapSyncTopic ] }
    PROVIDER.on('block', async (blockNumber) => {
        if (blockNumber > BLOCK_HEIGHT) {
            BLOCK_HEIGHT = blockNumber
            utils.verboseLog(`{ "action": "blockReceived", "currentBlock": "${blockNumber}" }`)
            let logs = await PROVIDER.getLogs(filter)
            let changedPools = []
            logs.forEach(l => {
                if (POOLS.includes(l.address)) {
                    arbbot.updateReserves(l.address, l.data)
                    let poolId = instrMng.getPoolByAddress(l.address).id
                    if (changedPools.includes(poolId)) {
                        changedPools.push(poolId)
                    }
                }
            })
            arbbot.handleBlockUpdate(blockNumber)
            try {
                const gasPrice = await utils.fetchGasPrice(config.settings.gas.gasSpeed)
                arbbot.updateGasPrice(gasPrice)
            } catch(e) {
                console.log('Failed to fetch gas price')
                console.log(e)
            }
            
        }
    })
}

async function startRequestUpdates() {
    const port = parseInt(process.env.PORT)
    const app = express()

    // Health check endpoint
    app.get('/', async (_req, res) => {
        try {
        res.send('ok')
        } catch (e) {
        res.status(503).send(e)
        }
    })

    // Manual decoding of body
    app.use (function(req, res, next) {
        var data=''
        req.setEncoding('utf8')
        req.on('data', function(chunk) { 
           data += chunk
        })
        req.on('end', function() {
            req.body = data
            next()
        })
    })
    // TODO: Make a helper function for the post requests
    app.post("/submitRequest", async (req, res) => {
        let request = req.body
        let recvBlockHeight = BLOCK_HEIGHT  // Block height at which request was recieved
        let recvTimestamp = Date.now()  // Time when request was recieved
        let response
        try {
            if (utils.isHex(request)) {
                await arbbot.handleNewBackrunRequest(request)
                response = {
                    status: 200, 
                    msg: 'OK'
                }
            } else {
                response = {
                    status: 422, 
                    msg: 'RequestError: Not in hex format'
                }
            }
        } catch (e) {
            response = {
                status: 503, 
                msg: `InternalError: ${e}`
            }
        } finally {
            res.json(response)
            let returnTimestamp = Date.now()
            logger.logBackrunRequest(
                'submitRequest',
                request, 
                response,
                recvBlockHeight, 
                recvTimestamp, 
                returnTimestamp
            )
        }
    })
    app.post("/cancelRequest", async (req, res) => {
        let request = req.body
        let recvBlockHeight = BLOCK_HEIGHT  // Block height at which request was recieved
        let recvTimestamp = Date.now()  // Time when request was recieved
        let response
        try {
            if (utils.isHex(request)) {
                arbbot.cancelRequest(request)
                response = {
                    status: 200, 
                    msg: 'OK'
                }
            } else {
                response = {
                    status: 422, 
                    msg: 'RequestError: Not in hex format'
                }
            }
        } catch (e) {
            response = {
                status: 503, 
                msg: `InternalError: ${e}`
            }
        } finally {
            res.json(response)
            let returnTimestamp = Date.now()
            logger.logBackrunRequest(
                'cancelRequest',
                request, 
                response,
                recvBlockHeight, 
                recvTimestamp, 
                returnTimestamp
            )
        }
    })
    app.post("/backrunRequest", async (req, res) => {
        let request = req.body
        let recvBlockHeight = BLOCK_HEIGHT  // Block height at which request was recieved
        let recvTimestamp = Date.now()  // Time when request was recieved
        let response
        try {
            if (utils.isHex(request)) {
                let result = await arbbot.backrunRawRequest(request, recvBlockHeight)
                response = {
                    status: 200,
                    msg: 'OK',
                    result
                }
            } else {
                response = {
                    status: 422, 
                    msg: 'RequestError: Not in hex format'
                }
            }
        } catch (e) {
            response = {
                status: 503, 
                msg: `InternalError: ${e}`
            }
        } finally {
            res.json(response)
            let returnTimestamp = Date.now()
            logger.logBackrunRequest(
                'backrunRequest',
                request, 
                response,
                recvBlockHeight, 
                recvTimestamp, 
                returnTimestamp
            )
        }
    })
    app.post("/estimateProfit", async (req, res) => {
        let request = req.body
        let recvBlockHeight = BLOCK_HEIGHT  // Block height at which request was recieved
        let recvTimestamp = Date.now()  // Time when request was recieved
        let response
        try {
            request = JSON.parse(request)
            let result = await arbbot.estimateProfitForTrade(
                BigNumber.from(request.amountIn), 
                BigNumber.from(request.amountOutMin),
                request.path, 
                request.exchange,
                request.blockNumber
            )
            result = result.toString()
            response = {
                status: 200,
                msg: 'OK',
                result
            }
        } catch (e) {
            response = {
                status: 503, 
                msg: `InternalError: ${e}`
            }
        } finally {
            res.json(response)
            let returnTimestamp = Date.now()
            logger.logBackrunRequest(
                'estimateProfit',
                request, 
                response,
                recvBlockHeight, 
                recvTimestamp, 
                returnTimestamp
            )
        }
    })
    requestListener = app.listen(port, () => {
        console.log(`Server running on port ${port}`)
    })
}



function stopRequestUpdates() {
    if (requestListener) {
        requestListener.close()
    }
}

async function main(_provider) {
    await init(_provider)
    startListeners()
}

module.exports = { 
    startRequestUpdates,
    stopRequestUpdates,
    startListeners,
    logger,
    arbbot,
    main, 
    init,
}
