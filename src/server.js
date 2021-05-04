const express = require('express')

const { provider, signer } = require('./provider').ws
const instrMng = require('./instrManager')
const arbbot = require('./arbbot')
const config = require('./config')
const utils = require('./utils')

let gasLoopTimeout = 2000  // ms
const poolAddresses = instrMng.pools.map(p=>p.address)

async function init() {
    let startGasPrice = await utils.fetchGasPrice(config.GAS_SPEED)
    await arbbot.init(provider, signer, startGasPrice)
}

function startListeners() {
    startGasUpdates()
    startRequestUpdates()
    startListeningForBlocks()
}

function startListeningForBlocks() {
    const filter = { topics: [ config.UNISWAP_SYNC_TOPIC ] }
    provider.on('block', async (blockNumber) => {
        console.log(`\n${'^'.repeat(20)} ${blockNumber} ${'^'.repeat(20)}\n`)
        let logs = await provider.getLogs(filter)
        let changedPools = []
        logs.forEach(l => {
            if (poolAddresses.includes(l.address)) {
                arbbot.updateReserves(l.address, l.data)
                let poolId = instrMng.getPoolByAddress(l.address).id
                if (changedPools.includes(poolId)) {
                    changedPools.push(poolId)
                }
            }
        })
        backrunRequests.forEach(request => {
            console.log('Checking a request')
            arbbot.handleMempoolUpdate(request, changedPools)
        })
    })
}

async function startGasUpdates() {
    while (1) {
        try {
            let gasPrice = await utils.fetchGasPrice(config.GAS_SPEED)
            arbbot.updateGasPrice(gasPrice)
        } catch (e) {
            console.log('Failed to fetch gas price')
            console.log(e)
        }
        utils.sleep(gasLoopTimeout)
    }
}

async function startRequestUpdates() {
    const port = 8888  // TODO: Put in config
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
                res.send('OK')
            } else {
                res.send('Not in hex format')
            }
        } catch (e) {
            console.log('Error occured while processing a request:', e.msg)
            res.send(e.msg)
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
