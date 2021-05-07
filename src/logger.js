const csvWriter = require('csv-write-stream')
const deffered = require('deffered')
const config = require('./config')
const md5 = require('md5')
const fs = require('fs')

class Table {

    /**
     * Write temp rows to disk and clean staging area
     */
    static async flush() {
        let rows = this.getRows()
        if (rows.length) {
            await logRowsToCsv(rows, this.getSavePath())
            rows.length = 0  // Clear memory
        }
    }
}

class Request extends Table {

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
        this.rowsTemp.push({
            id: idFromVals(arguments), 
            blockNumber: recvBlockHeight,
            timestampRecv: recvTimestamp, 
            timestampResp: respTimestamp, 
            method,
            request, 
            response: JSON.stringify(response)
        })
    }
}

class Opportunity extends Table {

    static rowsTemp = [] // Hold rows of requests in memory until they are written
    static getRows = () => this.rowsTemp
    static getSavePath = () => config.constants.paths.opps
    static addRow(opp, blockNumber) {
        this.rowsTemp.push({
            id: idFromVals(arguments),
            blockNumber, 
            path: opp.path.id,
            grossProfit: opp.grossProfit, 
            netProfit: opp.netProfit, 
            gasAmount: opp.gasAmount, 
            inputAmount: opp.inputAmount, 
            backrunTxs: opp.backrunTxs.join(',')
        })
    }
}

async function flush() {
    await Request.flush()
    await Opportunity.flush()
}

function logRequest(...data) {
    Request.addRow(...data)
}

function logOpps(opps, blockNumber) {
    for (let i=0; i<opps.length; i++) {
        Opportunity.addRow(opps[i], blockNumber)
    }
}

function getRequests() {
    return Request.getRows()
}

function getOpps() {
    return Opportunity.getRows()
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
        headers = {headers: Object.keys(rows[0])}
    writer = csvWriter(headers);
    writer.pipe(fs.createWriteStream(saveTo, {flags: 'a'}));
    rows.forEach(e => writer.write(e))
    writer.end(() => {df.resolve(true)})
    return df.promise
}

/**
 * Create unique id from passed values
 * @param {Array} vals Args on which id should be based on
 * @returns {String}
 */
 function idFromVals(vals) {
    return md5(JSON.stringify(vals))
}

module.exports = {
    getRequests,
    getOpps,
    logRequest, 
    logOpps,
    flush
}