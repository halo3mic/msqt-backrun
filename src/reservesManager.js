const ethers = require('ethers')

const instrMng = require('./instrManager')
const { pools, tokens } = instrMng
const utils = require('./utils')

let RESERVES
let PROVIDER

async function init(provider, paths) {
    PROVIDER = provider
    RESERVES = await fetchReservesForPaths(paths)
    return RESERVES
}

/**
 * Fetch reserves for a pool without any formating
 * @param {String} poolAddress
 * @returns {Array}
 */
 async function fetchReservesRaw(poolAddress) {
    const poolContract = new ethers.Contract(
        poolAddress, 
        abis['uniswapPool'], 
        PROVIDER
    )
    return poolContract.getReserves()
}

/**
 * Fetch reserves for a pool without any formating
 * Note that this does not work with fork providers!
 * @param {String} poolAddress Pool for which the reserves are fetched
 * @param {Integer} blockNumber Block at which reserves are fetched
 * @returns {Array}
 */
 async function fetchPastReservesRaw(poolAddress, blockNumber) {
    const poolContract = new ethers.Contract(
        poolAddress, 
        abis['uniswapPool'], 
    )
    let txRequest = await poolContract.populateTransaction.getReserves()
    return PROVIDER.call(txRequest, blockNumber)
}

/**
 * Return reserve object for a pool 
 * @param {String} pool - Pool object
 * @returns {Promise}
 */
 async function fetchReserves(pool) {
    /* Fetch reserves and format them according to the tokens. */
    const reservesRaw = fetchReservesRaw(pool.address)
    const tkn0 = tokens.filter(t=>t.id==pool.tkns[0].id)[0]
    const tkn1 = tokens.filter(t=>t.id==pool.tkns[1].id)[0]

    let r1 = reservesRaw.then(
            r => utils.normalizeUnits(r[0], tkn0.decimal)
        )
    let r2 = reservesRaw.then(
            r => utils.normalizeUnits(r[1], tkn1.decimal)
        )
    return Promise.all([ r1, r2 ]).then(result => {
        let reserves = {}
        reserves[tkn0.id] = result[0]
        reserves[tkn1.id] = result[1]
        return [pool.id, reserves]
    })
}

/**
 * Return reserve object for a pool 
 * @param {String} pool - Pool object
 * @returns {Promise}
 */
 async function fetchPastReserves(pool, blockNumber) {
    /* Fetch reserves and format them according to the tokens. */
    const reservesRaw = fetchPastReservesRaw(pool.address, blockNumber)
    const tkn0 = tokens.filter(t=>t.id==pool.tkns[0].id)[0]
    const tkn1 = tokens.filter(t=>t.id==pool.tkns[1].id)[0]

    let r1 = reservesRaw.then(r => {
        let r1 = ethers.BigNumber.from(r.substr(0, 66)) 
        return utils.normalizeUnits(r1, tkn0.decimal)
    })
    let r2 = reservesRaw.then(r => {
        let r2 = ethers.BigNumber.from('0x' + r.substr(66, 64))
        return utils.normalizeUnits(r2, tkn0.decimal)
    })
    return Promise.all([ r1, r2 ]).then(result => {
        let reserves = {}
        reserves[tkn0.id] = result[0]
        reserves[tkn1.id] = result[1]
        return [pool.id, reserves]
    })
}

/**
 * Fetch and return reserves for paths
 * First prepare data so that no reserve will overlap or be left out
 * @param {Array} paths
 * @returns {Object}
 */
 async function fetchReservesForPaths(paths) {
    var reservesPlan = []
    // First prepare data so that no reserve will overlap or be left out
    paths.forEach(instr => {
        instr.pools.forEach(poolId => {
            let poolObj = pools.filter(p=>p.id==poolId)[0]
            if (!reservesPlan.includes(poolObj)) {
                reservesPlan.push(poolObj)
            }
        })
    })
    return Promise.all(
        reservesPlan.map(fetchReserves)
    ).then(Object.fromEntries)
}

/**
 * Fetch and return reserves for paths for the past block 
 * First prepare data so that no reserve will overlap or be left out
 * @param {Array} paths Paths for which the reserves should be fetched
 * @param {Interger} blockNumber The block number for which reserves are fetched
 * @returns {Object}
 */
 async function fetchPastReservesForPaths(paths, blockNumber) {
    var reservesPlan = []
    // First prepare data so that no reserve will overlap or be left out
    paths.forEach(instr => {
        instr.pools.forEach(poolId => {
            let poolObj = pools.filter(p=>p.id==poolId)[0]
            if (!reservesPlan.includes(poolObj)) {
                reservesPlan.push(poolObj)
            }
        })
    })
    return Promise.all(
        reservesPlan.map(p => fetchPastReserves(p, blockNumber))
    ).then(Object.fromEntries)
}

/**
 * Update reserves from Sync logs
 * @param {String} poolAddress
 * @param {String} reservesBytes
 */
 function updateReserves(poolAddress, reservesBytes) {
    const pool = pools.filter(p=>p.address==poolAddress)[0]
    const tkn0 = tokens.filter(t=>t.id==pool.tkns[0].id)[0]
    const tkn1 = tokens.filter(t=>t.id==pool.tkns[1].id)[0]
    let r0 = ethers.BigNumber.from(reservesBytes.substr(0, 66))
    let r1 = ethers.BigNumber.from('0x' + reservesBytes.substr(66))
    r0 = utils.normalizeUnits(r0, tkn0.decimal)
    r1 = utils.normalizeUnits(r1, tkn1.decimal)
    let result = {}
    result[tkn0.id] = r0
    result[tkn1.id] = r1
    RESERVES[pool.id] = result
}

/**
 * Get reserves for specific pools
 * @param {Array[String]} poolIds
 * @returns {Object}
 */
 function getReserves(poolIds) {
    return Object.fromEntries(poolIds.map(pId=>[pId, RESERVES[pId]]))
}

/**
 * Get all reserves
 * @returns {Object}
 */
function getAllReserves() {
    return RESERVES
}

module.exports = { 
    fetchPastReservesForPaths,
    fetchReservesForPaths,
    fetchPastReserves,
    fetchReserves,
    getAllReserves, 
    updateReserves,
    getReserves,
    init, 
}