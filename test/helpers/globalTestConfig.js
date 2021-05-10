const config = require('../../src/config')

exports.mochaGlobalSetup = async function() {
    // Change save destination
    config.constants.paths.requests = __dirname + '/.test.requests.csv'
    config.constants.paths.relayRequests = __dirname + '/.test.relayRequests.csv'
    config.constants.paths.opps = __dirname + '/.test.opps.csv'
}

exports.msg = 'hello kitty'