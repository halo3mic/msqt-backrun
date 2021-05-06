const express = require('express')

const { provider, signer } = require('./provider').ws
const instrMng = require('./instrManager')
const arbbot = require('./arbbot')
const config = require('./config')
const utils = require('./utils')

let BLOCK_HEIGHT
let POOLS  // Addresses for pools that are used by valid paths
let requestListener

async function init() {
    let startGasPrice = await utils.fetchGasPrice(config.settings.gas.gasSpeed)
    await arbbot.init(provider, signer, startGasPrice)
    BLOCK_HEIGHT = await provider.getBlockNumber()
    POOLS = instrMng.getPoolsForPaths(arbbot.getPaths()).map(p => p.address)
}

function startListeners() {
    startListeningForBlocks()
    startRequestUpdates()
    startGasUpdates()
}

/**
 * Listen for new blocks
 * Update reserves if Sync logs are found
 */
function startListeningForBlocks() {
    const filter = { topics: [ config.constants.uniswapSyncTopic ] }
    provider.on('block', async (blockNumber) => {
        if (blockNumber > BLOCK_HEIGHT) {
            BLOCK_HEIGHT = blockNumber
            console.log(`\n${'^'.repeat(20)} ${blockNumber} ${'^'.repeat(20)}\n`)
            let logs = await provider.getLogs(filter)
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
        }
    })
}


async function startGasUpdates() {
    while (1) {
        try {
            arbbot.updateGasPrice(
                await utils.fetchGasPrice(config.settings.gas.gasSpeed)
            )
        } catch (e) {
            console.log('Failed to fetch gas price')
            console.log(e)
        } finally {
            // Wait to avoid reaching request limit for API
            utils.sleep(config.settings.gas.updatePeriod)
        }
    }
}

async function startRequestUpdates() {
    const port = parseInt(process.env.PORT)
    const app = express()
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
    app.post("/submitRequest", async (req, res) => {
        let request = req.body
        try {
            if (utils.isHex(request)) {
                arbbot.handleNewBackrunRequest(request)
                res.json({
                    status: 1, 
                    msg: 'OK'
                })
            } else {
                res.json({
                    status: 0, 
                    msg: 'RequestError: Not in hex format'
                })
            }
        } catch (e) {
            res.json({
                status: 0, 
                msg: `InternalError:${e.msg}`
            })
        }
    })
    app.post("/backrunRequest", async (req, res) => {
        let request = req.body
        try {
            if (utils.isHex(request)) {
                let result = await arbbot.backrunRequest(request, BLOCK_HEIGHT)
                res.json({
                    status: 1,
                    msg: 'OK',
                    result
                })
            } else {
                res.json({
                    status: 0, 
                    msg: 'RequestError: Not in hex format'
                })
            }
        } catch (e) {
            res.json({
                status: 0, 
                msg: `InternalError:${e.msg}`
            })
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

async function main() {
    await init()
    startListeners()
}

module.exports = { 
    startRequestUpdates,
    stopRequestUpdates,
    startListeners,
    arbbot,
    main, 
    init,
}
