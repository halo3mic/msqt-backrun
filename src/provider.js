const ganache = require('ganache-cli')
const config = require('./config.js') 
const ethers = require('ethers')

/**
 * Return WebSocket provider object
 * @returns {ethers.providers.WebSocketProvider}
 */
function setWsProvider() {
	if (!config.settings.network.wsEndpoint) {
		console.log('No Websockets endpoint detected!')
	}
    let _wsProvider = new ethers.providers.WebSocketProvider(
      config.settings.network.wsEndpoint,
      config.settings.network.networkId
    )
    _wsProvider.on("error", async (error) => {
      console.log("provider::error", error);
    })
    return _wsProvider
}

/**
 * Return RPC provider object
 * @returns {ethers.providers.JsonRpcProvider}
 */
function setHttpProvider() {
	if (!config.settings.network.rpcEndpoint) {
		console.log('No RPC endpoint detected!')
	}
    return new ethers.providers.JsonRpcProvider(
      config.settings.network.rpcEndpoint,
      config.settings.network.networkId
    )
}

function setWallet() {
    if (!config.settings.network.privateKey) {
		console.log('No private key detected!')
	}
	let wallet = new ethers.Wallet(config.settings.network.privateKey)
	console.log(`Using acount ${wallet.address} as signer.`)
	return wallet
}

/**
 * Return ganache provider 
 * See https://github.com/trufflesuite/ganache-cli
 * @param {Object} params - Session configuration
 * @returns {ethers.providers.Web3Provider}
 */
function setGancheProvider(params) {
    params = params || {}
    params.fork = params.fork ? params.fork : config.settings.network.wsEndpoint
    params.network_id = config.settings.network.networkId
    return new ethers.providers.Web3Provider(ganache.provider(params))
}

function init() {
	let wallet = setWallet()
	let httpProvider = setHttpProvider()
	let wsProvider = setWsProvider()
	let http = {
		signer: wallet ? wallet.connect(httpProvider): null, 
		endpoint: config.settings.network.rpcEndpoint,
		provider: httpProvider,
	}
	let ws = {
		signer: wallet ? wallet.connect(wsProvider): null, 
		endpoint: config.settings.network.wsEndpoint,
		provider: wsProvider,
	}
	return { 
		network: config.settings.network.networkId, 
		setGancheProvider,
		http, 
		ws, 
	}
}

module.exports = init()
