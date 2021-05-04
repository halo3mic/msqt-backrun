const { expect } = require("chai");
const { ethers } = require("hardhat");

const { assets, unilikeRouters } = require('./addresses.json') 
const reservesMng = require('../src/reservesManager')
const instrMng = require('../src/instrManager')
const backrunner = require('../src/backrunner')
const txMng = require('../src/txManager')
const config = require('../src/config')
const arbbot = require('../src/arbbot')

const ZERO = ethers.constants.Zero

async function makeAccountGen() {
	function* getNewAccount() {
		for (let account of accounts) {
			yield account
		}
	}
	accounts = await ethers.getSigners();
	let newAccountGen = getNewAccount()
	let genNewAccount = () => newAccountGen.next().value
	return genNewAccount
}

async function impersonateAccount(address) {
	return network.provider.request({
		method: "hardhat_impersonateAccount",
		params: [ address ],
	  })
}

// Modify colors to distinguish between execution output and tests easier
const _clrYellow = '\x1b[33m'
const _clrCyan = '\x1b[36m'
const _clrReset = '\x1b[0m'
var originalIt = it
it = (description, fun) => {
	return originalIt(_clrCyan+description+_clrReset, fun)
}
var originalDescribe = describe
describe = (description, fun) => {
	return originalDescribe(_clrYellow+description+_clrReset, fun)
}

describe('Virtual reserves', () => {

	let genNewAccount, botOperator, signer
	
	before(async () => {
		genNewAccount = await makeAccountGen()
		signer = ethers.Wallet.createRandom().connect(ethers.provider)  // Create an account to sign txs
		botOperator = new ethers.Wallet(config.PRIVATE_KEY, ethers.provider)  // Interact with dispatcher
		bank = genNewAccount()  // Source of test eth
		await impersonateAccount(signer.address)
		
		await reservesMng.init(ethers.provider, [])
		txMng.init(ethers.provider, botOperator)
		backrunner.init(ethers.provider)  // Set a provider
	})

	beforeEach(async () => {
		// Fill signer account
		await bank.sendTransaction({
			value: ethers.utils.parseEther('1000'),
			to: signer.address, 
		}).then(async txRequest => txRequest.wait())
		// Restart requests pool with each test
		backrunner.cleanRequestsPool()
	})

	it('New request increases virtual reserves (one pool)', async () => {
		// Create transaction for uniswap trade and sign it
		let txCallArgs = {
			amountIn: ethers.utils.parseEther('100'),
			amountOut: ZERO,
			method: 'swapExactETHForTokensWithTipAmount',
			tknPath: [ assets.WETH, assets.DAI ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+300, 
			tipAmount: ethers.utils.parseUnits('0.1')
		}
		let archerswapRouter = new ethers.Contract(
			config.ROUTERS.ARCHERSWAP,
			ABIS['archerswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
		nextNonce = nextNonce==0 ? 1 : nextNonce
		let tradeTxRequest = await archerswapRouter.populateTransaction[txCallArgs.method](
			txCallArgs.router,
			[
				txCallArgs.amountIn,
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
			],
			txCallArgs.tipAmount,
			{ 
				gasPrice: ZERO, 
				value: txCallArgs.amountIn, 
				nonce: nextNonce, 
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Handle new request
		backrunner.handleNewBackrunRequest(signedTradeTxRequest)
		// Check that request was put in backrun requests pool
		let [ backrunRequest ] = backrunner.getBackrunRequests()
		let { callArgs } = backrunRequest
		let dummyReserves = {
			'P0009': {
				'T0006': ethers.utils.parseUnits('3000000'), 
				'T0000': ethers.utils.parseUnits('1000')
			}
		}
		let { virtualReserves, amountOut } = backrunner.getVirtualReserves(
			dummyReserves, 
			callArgs
		)
		// Check that original reserves werent affected
		expect(dummyReserves['P0009']['T0006']).to.equal(ethers.utils.parseUnits('3000000'))
		expect(dummyReserves['P0009']['T0000']).to.equal(ethers.utils.parseUnits('1000'))
		// Check that virtual reserves match the simualted trade
		expect(virtualReserves['P0009']['T0006']).to.equal(
			dummyReserves['P0009']['T0006'].sub(amountOut)
		)
		expect(virtualReserves['P0009']['T0000']).to.equal(
			dummyReserves['P0009']['T0000'].add(txCallArgs.amountIn)
		)
	})

	it('New request increases virtual reserves (two pools)', async () => {
		// Create transaction for uniswap trade and sign it
		let txCallArgs = {
			amountIn: ethers.utils.parseEther('100'),
			amountOut: ZERO,
			method: 'swapExactETHForTokensWithTipAmount',
			tknPath: [ assets.WETH, assets.DAI, assets.USDC ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+300, 
			tipAmount: ethers.utils.parseUnits('0.1')
		}
		let archerswapRouter = new ethers.Contract(
			config.ROUTERS.ARCHERSWAP,
			ABIS['archerswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
		nextNonce = nextNonce==0 ? 1 : nextNonce
		let tradeTxRequest = await archerswapRouter.populateTransaction[txCallArgs.method](
			txCallArgs.router,
			[
				txCallArgs.amountIn,
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
			],
			txCallArgs.tipAmount,
			{ 
				gasPrice: ZERO, 
				value: txCallArgs.amountIn, 
				nonce: nextNonce, 
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Handle new request
		backrunner.handleNewBackrunRequest(signedTradeTxRequest)
		// Check that request was put in backrun requests pool
		let [ backrunRequest ] = backrunner.getBackrunRequests()
		let { callArgs } = backrunRequest
		let dummyReserves = {
			'P0009': {
				'T0006': ethers.utils.parseUnits('3000000'), 
				'T0000': ethers.utils.parseUnits('2000')
			},
			'P00249': {
				'T0006': ethers.utils.parseUnits('1000000'), 
				'T0003': ethers.utils.parseUnits('1000100')
			}
		}
		let { virtualReserves, amountOut } = backrunner.getVirtualReserves(
			dummyReserves, 
			callArgs
		)
		// Check that original reserves werent affected
		expect(dummyReserves['P0009']['T0006']).to.equal(ethers.utils.parseUnits('3000000'))
		expect(dummyReserves['P0009']['T0000']).to.equal(ethers.utils.parseUnits('2000'))
		expect(dummyReserves['P00249']['T0006']).to.equal(ethers.utils.parseUnits('1000000'))
		expect(dummyReserves['P00249']['T0003']).to.equal(ethers.utils.parseUnits('1000100'))
		// Check that virtual reserves match the simulated trade
		expect(virtualReserves['P0009']['T0000']).to.equal(
			dummyReserves['P0009']['T0000'].add(txCallArgs.amountIn)
		)
		expect(virtualReserves['P00249']['T0003']).to.equal(
			dummyReserves['P00249']['T0003'].sub(amountOut)
		)
		// Check that inner pools match
		let pool1DiffTkn2 = dummyReserves['P0009']['T0006'].sub(virtualReserves['P0009']['T0006'])
		let pool2DiffTkn2 = virtualReserves['P00249']['T0006'].sub(dummyReserves['P00249']['T0006'])
		expect(pool1DiffTkn2).to.equal(pool2DiffTkn2)
	})

	it('Virutal reserves match the state of the pool after the execution', async () => {
		// Create transaction for uniswap trade and sign it
		let txCallArgs = {
			amountIn: ethers.utils.parseEther('10'),
			amountOut: ZERO,
			method: 'swapExactETHForTokensWithTipAmount',
			tknPath: [ assets.WETH, assets.DAI ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+3000, 
			tipAmount: ethers.utils.parseUnits('0.1')
		}
		let archerswapRouter = new ethers.Contract(
			config.ROUTERS.ARCHERSWAP,
			ABIS['archerswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
		let tradeTxRequest = await archerswapRouter.populateTransaction[txCallArgs.method](
			txCallArgs.router,
			[
				txCallArgs.amountIn,
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
			],
			txCallArgs.tipAmount,
			{ 
				gasPrice: ZERO, 
				value: txCallArgs.amountIn.add(txCallArgs.tipAmount), 
				nonce: nextNonce, 
				gasLimit: 1000000
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Handle new request
		backrunner.handleNewBackrunRequest(signedTradeTxRequest)
		// Check that request was put in backrun requests pool
		let backrunRequests = backrunner.getBackrunRequests()
		expect(backrunRequests.length).to.equal(1)
		let pathsToCheck = [ 'I000311', 'I001605' ].map(
			instrMng.getPathById
		)
		await arbbot.init(
			ethers.provider, 
			signer, 
			ethers.utils.parseUnits('20', 'gwei'), 
			pathsToCheck
		)
		// Get virtual reserves
		let { virtualReserves } = backrunner.getVirtualReserves(
			arbbot.getReserves(), 
			backrunRequests[0].callArgs
		)
		// Execute transaction
		await signer.sendTransaction(tradeTxRequest).then(
			async response => response.wait()
		)
		let poolAffected = instrMng.getPoolById('P0009')
		// Compare reserves after execution to the prediction
		let newReserves = await reservesMng.fetchReserves(poolAffected).then(
			r => Object.fromEntries([r])
		)
		expect(newReserves['P0009']['T0000']).to.equal(
			virtualReserves['P0009']['T0000']
		)
		expect(newReserves['P0009']['T0006']).to.equal(
			virtualReserves['P0009']['T0006']
		)
	})

	it('Bot should find same or more opps with virtual reserves (local)', async () => {
		// Create transaction for uniswap trade and sign it
		let txCallArgs = {
			amountIn: ethers.utils.parseEther('10'),
			amountOut: ZERO,
			method: 'swapExactETHForTokensWithTipAmount',
			tknPath: [ assets.WETH, assets.DAI ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+3000, 
			tipAmount: ethers.utils.parseUnits('0.1')
		}
		let archerswapRouter = new ethers.Contract(
			config.ROUTERS.ARCHERSWAP,
			ABIS['archerswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
		let tradeTxRequest = await archerswapRouter.populateTransaction[txCallArgs.method](
			txCallArgs.router,
			[
				txCallArgs.amountIn,
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
			],
			txCallArgs.tipAmount,
			{ 
				gasPrice: ZERO, 
				value: txCallArgs.amountIn.add(txCallArgs.tipAmount), 
				nonce: nextNonce, 
				gasLimit: 1000000
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Handle new request
		backrunner.handleNewBackrunRequest(signedTradeTxRequest)
		// Check that request was put in backrun requests pool
		let backrunRequests = backrunner.getBackrunRequests()
		expect(backrunRequests.length).to.equal(1)
		// Set dummy reserves
		let dummyReserves = {
			'P0009': {
				'T0006': ethers.utils.parseUnits('3000000'), 
				'T0000': ethers.utils.parseUnits('2000')
			},
			'P00249': {
				'T0006': ethers.utils.parseUnits('1000000'), 
				'T0003': ethers.utils.parseUnits('1000100')
			},
			'P0003': {
				'T0000': ethers.utils.parseUnits('4000'), 
				'T0003': ethers.utils.parseUnits('6000000')
			},
		}
		arbbot._setReserves(dummyReserves)
		arbbot._setBotBal(ethers.utils.parseUnits('100'))
		arbbot.updateGasPrice(ethers.utils.parseUnits('20', 'gwei'))
		let pathsToCheck = [ 'I000311', 'I001605' ].map(
			instrMng.getPathById
		)
		let { virtualReserves } = backrunner.getVirtualReserves(
			dummyReserves, 
			backrunRequests[0].callArgs
		)
		let oppsWithVirtualReserves = arbbot.getOppsForVirtualReserves(pathsToCheck, virtualReserves)
		let oppsWithoutVirtualReserves = arbbot.getOppsForVirtualReserves(pathsToCheck, {})
		expect(oppsWithVirtualReserves.length).to.gte(oppsWithoutVirtualReserves.length)
	})

	it('Handle block update (live)', async () => {
		// Create transaction for uniswap trade and sign it
		let txCallArgs = {
			amountIn: ethers.utils.parseEther('10'),
			amountOut: ZERO,
			method: 'swapExactETHForTokensWithTipAmount',
			tknPath: [ assets.WETH, assets.DAI ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+3000, 
			tipAmount: ethers.utils.parseUnits('0.1')
		}
		let archerswapRouter = new ethers.Contract(
			config.ROUTERS.ARCHERSWAP,
			ABIS['archerswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
		let tradeTxRequest = await archerswapRouter.populateTransaction[txCallArgs.method](
			txCallArgs.router,
			[
				txCallArgs.amountIn,
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
			],
			txCallArgs.tipAmount,
			{ 
				gasPrice: ZERO, 
				value: txCallArgs.amountIn.add(txCallArgs.tipAmount), 
				nonce: nextNonce, 
				gasLimit: 1000000
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Handle new request
		backrunner.handleNewBackrunRequest(signedTradeTxRequest)
		// Check that request was put in backrun requests pool
		let backrunRequests = backrunner.getBackrunRequests()
		expect(backrunRequests.length).to.equal(1)
		let pathsToCheck = [ 'I000311', 'I001605' ].map(
			instrMng.getPathById
		)
		await arbbot.init(
			ethers.provider, 
			signer, 
			ethers.utils.parseUnits('20', 'gwei'), 
			pathsToCheck
		)
		let blockNumber = await ethers.provider.getBlockNumber()
		expect(()=>arbbot.handleBlockUpdate(blockNumber)).to.not.throw()
	})

	it('Handle block update for multiple requests (live)', async () => {
		let amountIn
		let tipAmount = ethers.utils.parseUnits('0.1')
		// Uniswap trade
		amountIn = ethers.utils.parseUnits('1000')
		let archerswapRouter = new ethers.Contract(
			config.ROUTERS.ARCHERSWAP,
			ABIS['archerswapRouter'] 
		)
		let tradeTxRequest1 = await archerswapRouter.populateTransaction['swapExactETHForTokensWithTipAmount'](
			unilikeRouters.uniswap,
			[
				amountIn,
				ZERO, 
				[ assets.WETH, assets.DAI, assets.USDC ], 
				signer.address,
				parseInt(Date.now()/1e3)+3000, 
			],
			tipAmount, 
			{ value: amountIn.add(tipAmount) }
		)
		// Sushiswap trade
		amountIn = ethers.utils.parseUnits('20')
		let tradeTxRequest2 = await archerswapRouter.populateTransaction['swapExactETHForTokensWithTipAmount'](
			unilikeRouters.sushiswap,
			[
				amountIn,
				ZERO, 
				[ assets.WETH, assets.USDC ], 
				signer.address,
				parseInt(Date.now()/1e3)+3000, 
			],
			tipAmount, 
			{ value: amountIn.add(tipAmount) }
		)
		let signedTradeTxRequest1 = await signer.signTransaction(tradeTxRequest1)
		let signedTradeTxRequest2 = await signer.signTransaction(tradeTxRequest2)
		// Handle new request
		backrunner.handleNewBackrunRequest(signedTradeTxRequest1)
		backrunner.handleNewBackrunRequest(signedTradeTxRequest2)
		// Check that request was put in backrun requests pool
		let backrunRequests = backrunner.getBackrunRequests()
		expect(backrunRequests.length).to.equal(2)
		let pathsToCheck = [ 'I000311', 'I001605', 'I000092' ].map(
			instrMng.getPathById
		)
		await arbbot.init(
			ethers.provider, 
			signer, 
			ethers.utils.parseUnits('20', 'gwei'), 
			pathsToCheck
		)
		let blockNumber = await ethers.provider.getBlockNumber()
		expect(()=>arbbot.handleBlockUpdate(blockNumber)).to.not.throw()
	})
})