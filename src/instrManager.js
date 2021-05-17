const config = require('./config')

var tokens = require('../config/tokens.json')
var pools = require('../config/pools.json')
var paths = require('../config/paths.json')

let _pathById = Object.fromEntries(
    paths.map(p => [ p.id, p ])
)
let _poolById = Object.fromEntries(
    pools.map(p => [ p.id, p ])
)
let _poolByAddress = Object.fromEntries(
    pools.map(p => [ p.address, p ])
)
let _tokenById = Object.fromEntries(
    tokens.map(t => [ t.id, t ])
)
let _tokenByAddress = Object.fromEntries(
    tokens.map(t => [ t.address, t ])
)

function getPoolsForPaths(_paths) {
    let _pools = []
    _paths.forEach(path => path.pools.map(poolId => {
        let poolAddress = _poolById[poolId]
        if (!_pools.includes(poolAddress)) {
            _pools.push(poolAddress)
        }
    }))
    return _pools
}

/**
 * Set paths that fit configuration
 */
 function filterPathsByConfig(_paths) {
     _paths = _paths.filter(path => {
         let exchangePath = path.pools.map(poolId=>_poolById[poolId].exchange)
         return (
            path.tkns.filter(t => config.settings.arb.blacklistedTokens.includes(t)).length == 0 &&  // Exclude blacklisted tokens
            path.tkns[0] == config.settings.arb.baseAsset &&  // Paths needs to start in BASE-ASSET
            path.tkns[path.tkns.length - 1] == config.settings.arb.baseAsset &&  // Path needs to end in BASE-ASSET
            path.enabled &&  // Path needs to be enabled
            config.settings.arb.maxHops >= path.pools.length &&  // Filter path length
            exchangePath.filter(dex=>!config.settings.arb.whitelistedDexes.includes(dex)).length == 0  // Filter dexes
        )
    })
    console.log('Found ', _paths.length, ' valid paths')
    return _paths
}

/**
 * Filter out all paths that have an empty pool
 */
 function filterPathsWithEmptyPool(_paths, _reserves) {
    _reserves = _reserves || {}
    let threshold = config.settings.arb.emptyPoolThreshold
    let validPools = Object.entries(_reserves).map(e => {
        let [ poolId, reserves ] = e
        let rVals = Object.values(reserves) 
        if (rVals[0].gt(threshold) || rVals[1].gt(threshold)) {
            return poolId
        }
    }).filter(e=>e)
    _paths = _paths.filter(path=>path.pools.filter(
            p=>validPools.includes(p)
        ).length==path.pools.length
    )
    console.log('Found ', _paths.length, ' valid paths with non-empty pools')
    return _paths
}

/**
 * Return only paths that include at least one of the pools
 * @param {Array} paths The paths that should be checked
 * @param {Array} updatedPools The pool addresses that have reserves changed
 * @returns 
 */
 function filterPathsByPools(paths, pools) {
    return paths.filter(path => {
        // Only inlude the paths using a pool that was updated 
        return path.pools.filter(pool => {
            return pools.includes(pool)
        }).length > 0
    })
}

module.exports = {
    getPathById: id => _pathById[id], 
    getPoolById: id => _poolById[id], 
    getPoolByAddress: id => _poolByAddress[id], 
    getTokenById: id => _tokenById[id],
    getTokenByAddress: id => _tokenByAddress[id],
    filterPathsWithEmptyPool,
    filterPathsByConfig,
    filterPathsByPools,
    getPoolsForPaths,
    tokens,
    pools, 
    paths, 
}