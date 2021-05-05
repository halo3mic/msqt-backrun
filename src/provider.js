const ganache = require('ganache-cli')
const config = require('./config.js') 
const ethers = require('ethers')

/**
 * Return WebSocket provider object
 * @returns {ethers.providers.WebSocketProvider}
 */
function setWsProvider() {
	if (!config.WS_ENDPOINT) {
		console.log('No Websockets endpoint detected!')
	}
    let _wsProvider = new ethers.providers.WebSocketProvider(
      config.WS_ENDPOINT,
      config.NETWORK
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
	if (!config.RPC_ENDPOINT) {
		console.log('No RPC endpoint detected!')
	}
    return new ethers.providers.JsonRpcProvider(
      config.RPC_ENDPOINT,
      config.NETWORK
    )
}

function setWallet() {
    if (!config.PRIVATE_KEY) {
		console.log('No private key detected!')
	}
	let wallet = new ethers.Wallet(config.PRIVATE_KEY)
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
    params.fork = params.fork ? params.fork : config.WS_ENDPOINT
    params.network_id = config.NETWORK
    return new ethers.providers.Web3Provider(ganache.provider(params))
}

function init() {
	let wallet = setWallet()
	let httpProvider = setHttpProvider()
	let wsProvider = setWsProvider()
	let http = {
		signer: wallet ? wallet.connect(httpProvider): null, 
		endpoint: config.RPC_ENDPOINT,
		provider: httpProvider,
	}
	let ws = {
		signer: wallet ? wallet.connect(wsProvider): null, 
		endpoint: config.WS_ENDPOINT,
		provider: wsProvider,
	}
	return { 
		network: config.NETWORK, 
		setGancheProvider,
		http, 
		ws, 
	}
}

module.exports = init()
