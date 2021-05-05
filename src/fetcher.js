const uniswapPoolAbi = require('./config/abis/uniswap.json')
const tokens = require('./config/tokens.json')
const pools = require('./config/pools.json')
const ethers = require('ethers')

let PROVIDER

function initialize(provider) {
    PROVIDER = provider
}

async function fetchReservesRaw(poolAddress) {
    const poolContract = new ethers.Contract(
        poolAddress, 
        uniswapPoolAbi, 
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

async function fetchReservesAll(instructions) {
    // TODO: Only fetch for pools that are in ENABLED instructions
    let reserves = pools.map(p=>fetchReserves(p))
    return Promise.all(reserves).then(r => Object.fromEntries(r))
}

async function fetchReservesForPaths(paths) {
    var reservesPlan = []
    // First prepare data so that no reserve will overlap or be left out
    paths.forEach(instr => {
        if (instr.enabled!='1') {
            return
        }
        instr.pools.forEach(p => {
            let poolObj = pools.filter(p1=>p1.id==p)[0]
            if (!reservesPlan.includes(poolObj)) {
                reservesPlan.push(poolObj)
            }
        })
    })
    return Promise.all(reservesPlan.map(fetchReserves)).then(Object.fromEntries)
}

module.exports = { fetchReserves, fetchReservesRaw, fetchReservesAll, initialize, fetchReservesForPaths }