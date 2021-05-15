const express = require('express')
const config = require('../../src/config')

const PORT = 8777
let PROVIDER
let inSimulation = []


function startListening(provider) {
    PROVIDER = provider
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
    app.post("/sendBundle", async (req, res) => {
        let request = req.body
        let response = []
        if (request) {
            let bundle = await getBundleFromRequest(request)
            let r = await simulateBundle(bundle)
            response = r
        }
        res.json(response)
    })
    let requestListener = app.listen(PORT, () => {
        console.log(`Relay simulator running on port: ${PORT}`)
    })

}

async function getBundleFromRequest(rawRequest) {
    let request = JSON.parse(rawRequest)
    let bundle = request.params[0]
    return bundle
}

async function simulateBundle(bundle) {
    if (!inSimulation.includes(bundle)) {
        console.log('\nSimulating a bundle ...\n')
        inSimulation.push(bundle)  // Add to current simulations
        try {
            let txResponses = []
            for (let rawTx of bundle) {
                let r = await executeRawTransaction(rawTx)
                txResponses.push(r)
            }
            inSimulation = inSimulation.filter(e => e!=bundle)  // Remove from the current simulations
            return txResponses
        } catch (e) {
            return e
        }
    } else {
        return 'Bundle already submitted in simulation'
    }
}

function executeRawTransaction(rawTx) {
    return PROVIDER.send('eth_sendRawTransaction', [rawTx])
}

module.exports = {
    startListening
}