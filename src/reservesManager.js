const ethers = require('ethers')

const instrMng = require('./instrManager')
const config = require('./config')
const { pools, tokens } = instrMng
const { BigNumber } = ethers

let RESERVES
let PROVIDER

async function init(provider, paths) {
    PROVIDER = provider
    RESERVES = await fetchReservesForPaths(paths)
    return RESERVES
}

function updateReserves(poolAddress, reservesBytes) {
    const pool = pools.filter(p=>p.address==poolAddress)[0]
    const tkn0 = tokens.filter(t=>t.id==pool.tkns[0].id)[0]
    const tkn1 = tokens.filter(t=>t.id==pool.tkns[1].id)[0]
    let r0 = BigNumber.from(reservesBytes.substr(0, 66))  // Skip 0x at the beginning
    let r1 = BigNumber.from('0x' + reservesBytes.substr(66))
    r0 = covertUnits(r0, tkn0.decimal)
    r1 = covertUnits(r1, tkn1.decimal)
    let result = {}
    result[tkn0.id] = r0
    result[tkn1.id] = r1
    RESERVES[pool.id] = result
}

function getReserves(poolIds) {
    return Object.fromEntries(poolIds.map(pId=>[pId, RESERVES[pId]]))
}

function getAllReserves() {
    return RESERVES
}

async function fetchReservesRaw(poolAddress) {
    const poolContract = new ethers.Contract(
        poolAddress, 
        config.ABIS['uniswapPool'], 
        PROVIDER
    )
    return await poolContract.getReserves()
}

function covertUnits(num, dec) {
    // Convert everything to 18 units
    let decDiff = 18 - dec
    let multiplier = ethers.utils.parseUnits('1', decDiff)
    return num.mul(multiplier)
}

async function fetchReserves(pool) {
    /* Fetch reserves and format them according to the tokens. */
    const reservesRaw = fetchReservesRaw(pool.address)
    const tkn0 = tokens.filter(t=>t.id==pool.tkns[0].id)[0]
    const tkn1 = tokens.filter(t=>t.id==pool.tkns[1].id)[0]

    let r1 = reservesRaw.then(
            r => covertUnits(r[0], tkn0.decimal)
        )
    let r2 = reservesRaw.then(
            r => covertUnits(r[1], tkn1.decimal)
        )
    return Promise.all([ r1, r2 ]).then(result => {
        let reserves = {}
        reserves[tkn0.id] = result[0]
        reserves[tkn1.id] = result[1]
        return [pool.id, reserves]
    })
}

// async function fetchReservesAll(instructions) {
//     let reserves = pools.map(p=>fetchReserves(p))
//     return Promise.all(reserves).then(r => Object.fromEntries(r))
// }

async function fetchReservesForPaths(paths) {
    var reservesPlan = []
    // First prepare data so that no reserve will overlap or be left out
    paths.forEach(instr => {
        instr.pools.forEach(p => {
            let poolObj = pools.filter(p1=>p1.id==p)[0]
            if (!reservesPlan.includes(poolObj)) {
                reservesPlan.push(poolObj)
            }
        })
    })
    return Promise.all(
            reservesPlan.map(fetchReserves)
        ).then(Object.fromEntries)
}

module.exports = { 
    fetchReservesForPaths,
    fetchReserves,
    getAllReserves, 
    updateReserves,
    getReserves,
    init, 
}