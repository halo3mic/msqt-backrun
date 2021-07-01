const csvWriter = require('csv-write-stream')
const deffered = require('deffered')
const config = require('./config')
const { signer } = require('./provider').http
const fs = require('fs')
const { id } = require('ethers/lib/utils')


class Table {

    /**
     * Write temp rows to disk and clean staging area
     */
    static async flush() {
        let rows = this.getRows()
        if (rows.length) {
            // if (process.env.verbose) {
            //     logToConsole(rows)
            // } else {
            //     await logRowsToCsv(rows, this.getSavePath())
            // }
            logToConsole(rows)
            rows.length = 0  // Clear memory
        }
    }
}

class BackrunRequest extends Table {

    static rowsTemp = [] // Hold rows of requests in memory until they are written
    static getRows = () => this.rowsTemp
    static getSavePath = () => config.constants.paths.requests
    /**
     * Add row to staging area - ready to be written to csv
     * @param {String} method Method through which request was sent
     * @param {String} request Raw transaction to be backrun
     * @param {Object} response Response sent to the sender
     * @param {Integer} recvBlockHeight Block number when the request was recieved
     * @param {Integer} recvTimestamp Time when the request was recieved [ms]
     * @param {Integer} returnTimestamp Time when the response was sent [ms]
     */
    static addRow(
        method,
        request, 
        response, 
        recvBlockHeight, 
        recvTimestamp, 
        respTimestamp
    ) {
        const logMsg = {
            action: method,
            user: signer.address,
            id: idFromVals(arguments), 
            blockNumber: recvBlockHeight,
            timestampRecv: recvTimestamp, 
            timestampResp: respTimestamp,
            request, 
            response: JSON.stringify(response),
            table: 'backrun-requests'
        })
    }
}

class Opportunity extends Table {

    static rowsTemp = [] // Hold rows of requests in memory until they are written
    static getRows = () => this.rowsTemp
    static getSavePath = () => config.constants.paths.opps
    static addRow(opp, blockNumber) {
        const logMsg = {
            action: 'newOpportunity',
            user: signer.address,
            id: idFromVals(arguments),
            blockNumber,
            path: opp.path.id,
            grossProfit: opp.grossProfit, 
            netProfit: opp.netProfit, 
            gasAmount: opp.gasAmount, 
            inputAmount: opp.inputAmount, 
            backrunTxs: opp.backrunTxs.join(','),
            table: 'opportunities'
        })
    }
}

class RelayRequest extends Table {

    static rowsTemp = [] // Hold rows of requests in memory until they are written
    static getRows = () => this.rowsTemp
    static getSavePath = () => config.constants.paths.relayRequests
    /**
     * Add row to staging area - ready to be written to csv
     * @param {String} request POST request with a bundle
     * @param {Object} response Response from the relay
     * @param {Integer} recvBlockHeight Block number when the request was made
     * @param {Integer} submitTimestamp Time when the request was sent [ms]
     * @param {Integer} responseTimestamp Time when the response was recieved [ms]
     */
    static addRow(
        recvBlockHeight, 
        submitTimestamp, 
        responseTimestamp,
        request, 
        response
    ) {
        const logMsg = {
            action: 'opportunitySubmitted',
            user: signer.address,
            id: id(request.body), 
            blockNumber: recvBlockHeight,
            timestampRecv: submitTimestamp, 
            timestampResp: responseTimestamp, 
            request: JSON.stringify(request), 
            response: JSON.stringify(response),
            table: 'relay-requests'
        })
    }
}

async function flush() {
    return Promise.all([
        RelayRequest.flush(),
        Opportunity.flush(),
        BackrunRequest.flush(),
    ])
}

function logBackrunRequest(...data) {
    BackrunRequest.addRow(...data)
}

function logOpps(opps, blockNumber) {
    for (let i=0; i<opps.length; i++) {
        Opportunity.addRow(opps[i], blockNumber)
    }
}

function logRelayRequest(...data) {
    RelayRequest.addRow(...data)
}

function getBackrunRequests() {
    return BackrunRequest.getRows()
}

function getOpps() {
    return Opportunity.getRows()
}

function getRelayRequests() {
    return RelayRequest.getRows()
}


/**
* Save rows in CSV file
* If file doesn't exist method creates it with columns
* @param {Array} rows Rows to save
* @param {String} saveTo Path to CSV file
*/
async function logRowsToCsv(rows, saveTo) {
    let df = new deffered()
    let writer = csvWriter()
    let headers = {sendHeaders: false}
    if (!fs.existsSync(saveTo))
        headers = { headers: Object.keys(rows[0]) }
    writer = csvWriter(headers);
    writer.pipe(fs.createWriteStream(saveTo, {flags: 'a'}));
    rows.forEach(e => writer.write(e))
    writer.end(() => {df.resolve(true)})
    return df.promise
}

function logToConsole(rows) {
    rows.forEach(console.log)
}

/**
 * Create unique id from passed values
 * @param {Array} vals Args on which id should be based on
 * @returns {String}
 */
 function idFromVals(vals) {
    return id(JSON.stringify(vals))
}

module.exports = {
    getRelayRequests,
    getBackrunRequests,
    getOpps,
    logRelayRequest,
    logBackrunRequest, 
    logOpps,
    flush
}