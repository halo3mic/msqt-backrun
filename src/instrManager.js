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

function filterPaths(_paths, _reserves) {
    _paths = filterPathsByConfig(_paths)
    if (_reserves) {
        _paths = filterPathsWithEmptyPool(_paths, _reserves)
    }
    return _paths
}

/**
 * Set paths that fit configuration
 */
 function filterPathsByConfig(_paths) {
    _paths = _paths.filter(path => {
        return (
            path.tkns.filter(t => config.BLACKLISTED_TKNS.includes(t)).length == 0 &&  // Exclude blacklisted tokens
            path.tkns[0] == config.BASE_ASSET &&  // Paths needs to start in BASE-ASSET
            path.tkns[path.tkns.length - 1] == config.BASE_ASSET &&  // Path needs to end in BASE-ASSET
            path.enabled &&  
            config.MAX_HOPS >= path.pools.length - 1  // Filter path length
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
    let threshold = config.EMPTY_POOL_THRESHOLD
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

filterPaths(paths)  // Init


module.exports = {
    getPathById: id => _pathById[id], 
    getPoolById: id => _poolById[id], 
    getPoolByAddress: id => _poolByAddress[id], 
    getTokenById: id => _tokenById[id],
    getTokenByAddress: id => _tokenByAddress[id],
    filterPaths,
    tokens,
    pools, 
    paths, 
}