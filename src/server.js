const express = require('express')

const { provider, signer } = require('./provider').ws
const instrMng = require('./instrManager')
const arbbot = require('./arbbot')
const config = require('./config')
const utils = require('./utils')

let BLOCK_HEIGHT
let POOLS  // Addresses for pools that are used by valid paths

async function init() {
    let startGasPrice = await utils.fetchGasPrice(config.GAS_SPEED)
    await arbbot.init(provider, signer, startGasPrice)
    BLOCK_HEIGHT = await provider.getBlockNumber()
    POOLS = instrMng.getPoolAddressesForPaths(arbbot.getPaths())
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
    const filter = { topics: [ config.UNISWAP_SYNC_TOPIC ] }
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
                await utils.fetchGasPrice(config.GAS_SPEED)
            )
        } catch (e) {
            console.log('Failed to fetch gas price')
            console.log(e)
        } finally {
            // Wait to avoid reaching request limit for API
            utils.sleep(config.GAS_UPDATE_PERIOD)
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
    app.listen(port, () => {
        console.log(`Server running on port ${port}`)
    })
}

async function main() {
    await init()
    startListeners()
}

module.exports = { 
    startRequestUpdates,
    startListeners,
    arbbot,
    main, 
    init, 
}
