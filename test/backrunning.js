// TODO: If the limit of the request pool is reached old request should be removed
// TODO: There shouldnt be duplicates of requests (based on txhash)
// TODO: POSTing request to arbbot with signature should process it  
// TODO: Test logging to csv
// TODO: Split these tests among multiple tests

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

describe('Handle new backrun request', () => {

	let genNewAccount, botOperator, signer, msqtTrader
	
	before(async () => {
		genNewAccount = await makeAccountGen()
		signer = ethers.Wallet.createRandom().connect(ethers.provider)
		botOperator = new ethers.Wallet(config.PRIVATE_KEY, ethers.provider)

		
	})

	beforeEach(() => {
		trader = genNewAccount()
	})

	it('Uniswaplike signed tx should be decrypted', async () => {
		// Create transaction for uniswap trade and sign it
		let txCallArgs = {
			amountIn: ethers.utils.parseEther('100'),
			amountOut: ZERO,
			method: 'swapExactETHForTokens',
			tknPath: [ assets.WETH, assets.DAI ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+300
		}
		let UniswapRouter = new ethers.Contract(
			txCallArgs.router,
			ABIS['uniswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
		nextNonce = nextNonce==0 ? 1 : nextNonce
		let tradeTxRequest = await UniswapRouter.populateTransaction[txCallArgs.method](
			txCallArgs.amountOut, 
			txCallArgs.tknPath, 
			signer.address,
			txCallArgs.deadline, 
			{ 
				gasPrice: ZERO, 
				value: txCallArgs.amountIn, 
				nonce: nextNonce, 
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Decrypt signed transaction
		let { txRequest, callArgs, sender } = backrunner.decryptRawTx(signedTradeTxRequest)
		// Compare passed call arguments to decrypted ones
		expect(callArgs.amountIn).to.equal(txCallArgs.amountIn)
		expect(callArgs.amountOut).to.equal(txCallArgs.amountOut)
		expect(callArgs.method).to.equal(txCallArgs.method)
		expect(callArgs.tknPath.join('')).to.equal(txCallArgs.tknPath.join(''))
		expect(callArgs.router).to.equal(txCallArgs.router)
		expect(callArgs.deadline).to.equal(txCallArgs.deadline)
		// Compare passed transaction parameters to unsigned ones
		expect(txRequest.to).to.equal(tradeTxRequest.to)
		expect(txRequest.nonce).to.equal(tradeTxRequest.nonce)
		expect(txRequest.value).to.equal(tradeTxRequest.value)
		expect(sender).to.equal(signer.address)
		
	})

	it('`decryptUnilikeTx` should revert if tx is not unilike (no data)', async () => {
		let tx = {
			to: ethers.constants.AddressZero, 
			from: trader.address
		}
		// Decrypt signed transaction
		expect(() => backrunner.decryptUnilikeTx(tx)).to.throw(
			'Transaction is not uniswap-like'
		)
	})

	it('Enrich call-args with supported pool for two tokens', () => {
		let callArgs = {
			amountIn: ethers.utils.parseEther('10'),
			amountOut: ethers.utils.parseUnits('30000', 6),
			method: 'swapExactETHForTokens',
			tknPath: [ assets.WETH, assets.USDC ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+300
		}
		let enrichedArgs = backrunner.enrichCallArgs(callArgs)
		expect(enrichedArgs.tknPath.join()).to.equal(['T0000', 'T0003'].join())
		expect(enrichedArgs.poolAddresses.join()).to.equal([
			'0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'
		].join())
		expect(enrichedArgs.poolIds.join()).to.equal(['P0003'].join())
		expect(enrichedArgs.amountIn).to.equal(ethers.utils.parseUnits('10'))
		expect(enrichedArgs.amountOutMin).to.equal(ethers.utils.parseUnits('30000'))
	})

	it('Enrich call-args with supported pool for three tokens', () => {
		let callArgs = {
			amountIn: ethers.utils.parseEther('10'),
			amountOut: ethers.utils.parseUnits('3000', 6),
			method: 'swapExactETHForTokens',
			tknPath: [ assets.WETH, assets.DAI, assets.USDC ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+300
		}
		let enrichedArgs = backrunner.enrichCallArgs(callArgs)
		expect(enrichedArgs.tknPath.join()).to.equal(['T0000', 'T0006', 'T0003'].join())
		expect(enrichedArgs.poolAddresses.join()).to.equal([
			'0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11',
			'0xAE461cA67B15dc8dc81CE7615e0320dA1A9aB8D5' 
		].join())
		expect(enrichedArgs.poolIds.join()).to.equal(['P0009', 'P00249'].join())
		expect(enrichedArgs.amountIn).to.equal(ethers.utils.parseUnits('10'))
		expect(enrichedArgs.amountOutMin).to.equal(ethers.utils.parseUnits('3000'))
	})

	it('Enrich call-args with unsupported pool for two tokens should return `undefined`', () => {
		let callArgs = {
			amountIn: ethers.utils.parseEther('100'),
			amountOut: ZERO,
			method: 'swapExactTokensForTokens',
			tknPath: [ assets.LINK, assets.DAI ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+300
		}
		expect(backrunner.enrichCallArgs(callArgs)).to.equal(undefined)
	})

	it('`handleNewBackrunRequest` should decrypt, enrich and save request', async () => {
		// Create transaction for uniswap trade and sign it
		let txCallArgs = {
			amountIn: ethers.utils.parseEther('10'),
			amountOut: ethers.utils.parseUnits('3000'),
			method: 'swapExactETHForTokens',
			tknPath: [ assets.WETH, assets.DAI ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+300
		}
		let UniswapRouter = new ethers.Contract(
			txCallArgs.router,
			ABIS['uniswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
		nextNonce = nextNonce==0 ? 1 : nextNonce
		let tradeTxRequest = await UniswapRouter.populateTransaction[txCallArgs.method](
			txCallArgs.amountOut, 
			txCallArgs.tknPath, 
			signer.address,
			txCallArgs.deadline, 
			{ 
				gasPrice: ZERO, 
				value: txCallArgs.amountIn, 
				nonce: nextNonce, 
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		backrunner.handleNewBackrunRequest(signedTradeTxRequest)
		let [ backrunRequest1 ] = backrunner.getBackrunRequests()
		let { callArgs, txRequest, sender } = backrunRequest1
		// Compare passed call arguments to decrypted ones
		expect(callArgs.amountIn).to.equal(txCallArgs.amountIn)
		expect(callArgs.amountOut).to.equal(txCallArgs.amountOutMin)
		expect(callArgs.tknPath.join('')).to.equal(['T0000', 'T0006'].join(''))
		expect(callArgs.deadline).to.equal(txCallArgs.deadline)
		// // Compare passed transaction parameters to unsigned ones
		expect(txRequest.to).to.equal(tradeTxRequest.to)
		expect(txRequest.nonce).to.equal(tradeTxRequest.nonce)
		expect(txRequest.value).to.equal(tradeTxRequest.value)
		expect(sender).to.equal(signer.address)
	})

})

describe('Handle new block', () => {

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

	describe('Request validity', () => {

		it('Remove request that was already mined', async () => {
			// Create transaction for uniswap trade and sign it
			let txCallArgs = {
				amountIn: ethers.utils.parseEther('10'),
				amountOut: ethers.utils.parseUnits('3000'),
				method: 'swapExactETHForTokens',
				tknPath: [ assets.WETH, assets.DAI ],
				router: unilikeRouters.uniswap, 
				deadline: parseInt(Date.now()/1e3)+300
			}
			let UniswapRouter = new ethers.Contract(
				txCallArgs.router,
				ABIS['uniswapRouter'] 
			)
			let nextNonce = await signer.getTransactionCount()
			let tradeTxRequest = await UniswapRouter.populateTransaction[txCallArgs.method](
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
				{ 
					gasPrice: ZERO, 
					value: txCallArgs.amountIn, 
					nonce: nextNonce, 
					gasLimit: 300000, 
					from: signer.address
				}
			)
			let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
			let txHash = ethers.utils.keccak256(signedTradeTxRequest)
			// Handle new request
			backrunner.handleNewBackrunRequest(signedTradeTxRequest)
			// Mine transaction
			let txReceipt = await signer.sendTransaction(tradeTxRequest).then(
				async txRequest => txRequest.wait()
			)
			// NOTE: Using fork calculated tx hash won't match the one from receipt
			// Check that tx passed
			expect(txReceipt.status).to.equal(1)  
			// Check that request was put in backrun requests pool
			let requestsBefore = backrunner.getBackrunRequests()
			expect(requestsBefore.length).to.equal(1)
			// Perform validity check
			let requestToBeChecked = requestsBefore[0]
			requestToBeChecked.txHash = txReceipt.transactionHash  // For testing purposes! (GanacheCLI executed hash doesnt match calculated one)
			let isValidRequest = await backrunner.isValidRequest(requestToBeChecked)
			// Expect the request to be invalid as it is already mined
			expect(isValidRequest).to.be.false
			// Expect the request to be removed from the pool due to already being mined
			let requestsAfter = backrunner.getBackrunRequests()
			expect(requestsAfter.length).to.equal(0)
		}).timeout(40000)

		it('Remove request that is past deadline', async () => {
			// Create transaction for uniswap trade and sign it
			let txCallArgs = {
				amountIn: ethers.utils.parseEther('10'),
				amountOut: ethers.utils.parseUnits('3000'),
				method: 'swapExactETHForTokens',
				tknPath: [ assets.WETH, assets.DAI ],
				router: unilikeRouters.uniswap, 
				deadline: parseInt(Date.now()/1e3)
			}
			let UniswapRouter = new ethers.Contract(
				txCallArgs.router,
				ABIS['uniswapRouter'] 
			)
			let nextNonce = await signer.getTransactionCount()
			let tradeTxRequest = await UniswapRouter.populateTransaction[txCallArgs.method](
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
				{ 
					gasPrice: ZERO, 
					value: txCallArgs.amountIn, 
					nonce: nextNonce, 
					gasLimit: 300000, 
					from: signer.address
				}
			)
			let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
			// Handle new request
			backrunner.handleNewBackrunRequest(signedTradeTxRequest)
			// Check that request was put in backrun requests pool
			let requestsBefore = backrunner.getBackrunRequests()
			expect(requestsBefore.length).to.equal(1)
			// Check that current time is past deadline or equal to it
			expect(txCallArgs.deadline).lte(Date.now())
			// Perform validity check
			let isValidRequest = await backrunner.isValidRequest(requestsBefore[0])
			// Expect the request to be invalid as it is past deadline
			expect(isValidRequest).to.be.false
			// Expect the request to be removed from the pool as it is past deadline
			let requestsAfter = backrunner.getBackrunRequests()
			expect(requestsAfter.length).to.equal(0)
		})

		it('Remove request that has lower nonce than the sender', async () => {
			// Create transaction for uniswap trade and sign it
			let txCallArgs = {
				amountIn: ethers.utils.parseEther('10'),
				amountOut: ethers.utils.parseUnits('3000'),
				method: 'swapExactETHForTokens',
				tknPath: [ assets.WETH, assets.DAI ],
				router: unilikeRouters.uniswap, 
				deadline: parseInt(Date.now()/1e3)+300
			}
			let UniswapRouter = new ethers.Contract(
				txCallArgs.router,
				ABIS['uniswapRouter'] 
			)
			let nextNonce = await signer.getTransactionCount()
			let tradeTxRequest = await UniswapRouter.populateTransaction[txCallArgs.method](
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
				{ 
					gasPrice: ZERO, 
					value: txCallArgs.amountIn, 
					nonce: nextNonce, 
					gasLimit: 300000, 
					from: signer.address
				}
			)
			let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
			// Handle new request
			backrunner.handleNewBackrunRequest(signedTradeTxRequest)
			// Check that request was put in backrun requests pool
			let requestsBefore = backrunner.getBackrunRequests()
			expect(requestsBefore.length).to.equal(1)
			// Send selfie to increase sender's nonce
			await signer.sendTransaction({to: signer.address}).then(
				async txRequest => txRequest.wait()
			)
			expect(await signer.getTransactionCount()).to.equal(nextNonce+1)
			// Perform validity check
			let isValidRequest = await backrunner.isValidRequest(requestsBefore[0])
			// Expect the request to be invalid as the nonce is too big
			expect(isValidRequest).to.be.false
			// Expect the request to be removed from the pool as the nonce is too big
			let requestsAfter = backrunner.getBackrunRequests()
			expect(requestsAfter.length).to.equal(0)
		})

		it('Skip request where sender doesnt have enough balance to send it', async () => {
			// Create transaction for uniswap trade and sign it
			let txCallArgs = {
				amountIn: ethers.utils.parseEther('10000'),
				amountOut: ethers.utils.parseUnits('600000'),
				method: 'swapExactETHForTokens',
				tknPath: [ assets.WETH, assets.DAI ],
				router: unilikeRouters.uniswap, 
				deadline: parseInt(Date.now()/1e3)+300
			}
			let UniswapRouter = new ethers.Contract(
				txCallArgs.router,
				ABIS['uniswapRouter'] 
			)
			let nextNonce = await signer.getTransactionCount()
			let tradeTxRequest = await UniswapRouter.populateTransaction[txCallArgs.method](
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
				{ 
					gasPrice: ZERO, 
					value: txCallArgs.amountIn, 
					nonce: nextNonce, 
					gasLimit: 300000, 
					from: signer.address
				}
			)
			let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
			// Handle new request
			backrunner.handleNewBackrunRequest(signedTradeTxRequest)
			// Check that request was put in backrun requests pool
			let requestsBefore = backrunner.getBackrunRequests()
			expect(requestsBefore.length).to.equal(1)
			// Check that sender doesnt have enough funds
			expect(await ethers.provider.getBalance(signer.address)).to.lt(
				txCallArgs.amountIn
			)
			// Perform validity check
			let isValidRequest = await backrunner.isValidRequest(requestsBefore[0])
			// Expect the request to be invalid as sender doesnt have enough funds
			expect(isValidRequest).to.be.false
			// Expect the request is  removed from the mempool
			let requestsAfter = backrunner.getBackrunRequests()
			expect(requestsAfter.length).to.equal(0)
		})

	})

	describe('VirtualReserves', () => {

		it('New request increases virtual reserves (one pool)', async () => {
			// Create transaction for uniswap trade and sign it
			let txCallArgs = {
				amountIn: ethers.utils.parseEther('10'),
				amountOut: ethers.utils.parseUnits('3000'),
				method: 'swapExactETHForTokens',
				tknPath: [ assets.WETH, assets.DAI ],
				router: unilikeRouters.uniswap, 
				deadline: parseInt(Date.now()/1e3)+300
			}
			let UniswapRouter = new ethers.Contract(
				txCallArgs.router,
				ABIS['uniswapRouter'] 
			)
			let nextNonce = await signer.getTransactionCount()
			let tradeTxRequest = await UniswapRouter.populateTransaction[txCallArgs.method](
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
				{ 
					gasPrice: ZERO, 
					value: txCallArgs.amountIn, 
					nonce: nextNonce, 
					gasLimit: 300000, 
					from: signer.address
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
				amountIn: ethers.utils.parseEther('10'),
				amountOut: ethers.utils.parseUnits('3000'),
				method: 'swapExactETHForTokens',
				tknPath: [ assets.WETH, assets.DAI, assets.USDC ],
				router: unilikeRouters.uniswap, 
				deadline: parseInt(Date.now()/1e3)+300
			}
			let UniswapRouter = new ethers.Contract(
				txCallArgs.router,
				ABIS['uniswapRouter'] 
			)
			let nextNonce = await signer.getTransactionCount()
			let tradeTxRequest = await UniswapRouter.populateTransaction[txCallArgs.method](
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
				{ 
					gasPrice: ZERO, 
					value: txCallArgs.amountIn, 
					nonce: nextNonce, 
					gasLimit: 300000, 
					from: signer.address
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
				amountIn: ethers.utils.parseEther('100'),
				amountOut: ZERO,
				method: 'swapExactETHForTokens',
				tknPath: [ assets.WETH, assets.DAI ],
				router: unilikeRouters.uniswap, 
				deadline: parseInt(Date.now()/1e3)+300
			}
			let UniswapRouter = new ethers.Contract(
				txCallArgs.router,
				ABIS['uniswapRouter'] 
			)
			let nextNonce = await signer.getTransactionCount()
			let tradeTxRequest = await UniswapRouter.populateTransaction[txCallArgs.method](
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
				{ 
					gasPrice: ZERO, 
					value: txCallArgs.amountIn, 
					nonce: nextNonce, 
					gasLimit: 300000, 
					from: signer.address
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
				amountIn: ethers.utils.parseEther('100'),
				amountOut: ZERO,
				method: 'swapExactETHForTokens',
				tknPath: [ assets.WETH, assets.DAI ],
				router: unilikeRouters.uniswap, 
				deadline: parseInt(Date.now()/1e3)+300
			}
			let UniswapRouter = new ethers.Contract(
				txCallArgs.router,
				ABIS['uniswapRouter'] 
			)
			let nextNonce = await signer.getTransactionCount()
			let tradeTxRequest = await UniswapRouter.populateTransaction[txCallArgs.method](
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
				{ 
					gasPrice: ZERO, 
					value: txCallArgs.amountIn, 
					nonce: nextNonce, 
					gasLimit: 300000, 
					from: signer.address
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
			let oppsWithVirtualReserves = arbbot.getOppsForRequest(pathsToCheck, virtualReserves)
			let oppsWithoutVirtualReserves = arbbot.getOppsForRequest(pathsToCheck, {})
			expect(oppsWithVirtualReserves.length).to.gte(oppsWithoutVirtualReserves.length)
		})

		it('Bot should find same or more opps with virtual reserves (local)', async () => {
			// Create transaction for uniswap trade and sign it
			let txCallArgs = {
				amountIn: ethers.utils.parseEther('1000'),
				amountOut: ZERO,
				method: 'swapExactETHForTokens',
				tknPath: [ assets.WETH, assets.DAI ],
				router: unilikeRouters.uniswap, 
				deadline: parseInt(Date.now()/1e3)+300
			}
			let UniswapRouter = new ethers.Contract(
				txCallArgs.router,
				ABIS['uniswapRouter'] 
			)
			let nextNonce = await signer.getTransactionCount()
			let tradeTxRequest = await UniswapRouter.populateTransaction[txCallArgs.method](
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
				{ 
					gasPrice: ZERO, 
					value: txCallArgs.amountIn, 
					nonce: nextNonce, 
					gasLimit: 300000, 
					from: signer.address
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
			let { virtualReserves } = backrunner.getVirtualReserves(
				arbbot.getReserves(), 
				backrunRequests[0].callArgs
			)
			let oppsWithVirtualReserves = arbbot.getOppsForRequest(pathsToCheck, virtualReserves)
			let oppsWithoutVirtualReserves = arbbot.getOppsForRequest(pathsToCheck, {})
			expect(oppsWithVirtualReserves.length).to.gte(oppsWithoutVirtualReserves.length)

		})

		it('Handle block update (live)', async () => {
			// Create transaction for uniswap trade and sign it
			let txCallArgs = {
				amountIn: ethers.utils.parseEther('1000'),
				amountOut: ZERO,
				method: 'swapExactETHForTokens',
				tknPath: [ assets.WETH, assets.DAI ],
				router: unilikeRouters.uniswap, 
				deadline: parseInt(Date.now()/1e3)+300
			}
			let UniswapRouter = new ethers.Contract(
				txCallArgs.router,
				ABIS['uniswapRouter'] 
			)
			let nextNonce = await signer.getTransactionCount()
			let tradeTxRequest = await UniswapRouter.populateTransaction[txCallArgs.method](
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
				{ 
					gasPrice: ZERO, 
					value: txCallArgs.amountIn, 
					nonce: nextNonce, 
					gasLimit: 300000, 
					from: signer.address
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
			// Create transaction for uniswap trade and sign it
			let UniswapRouter = new ethers.Contract(
				unilikeRouters.uniswap,
				ABIS['uniswapRouter'] 
			)
			let tradeTxRequest1 = await UniswapRouter.populateTransaction['swapExactETHForTokens'](
				ZERO, 
				[ assets.WETH, assets.DAI, assets.USDC ], 
				signer.address,
				parseInt(Date.now()/1e3)+300, 
				{ value: ethers.utils.parseEther('1000') }
			)
			let SushiswapRouter = new ethers.Contract(
				unilikeRouters.sushiswap,
				ABIS['uniswapRouter'] 
			)
			let tradeTxRequest2 = await SushiswapRouter.populateTransaction['swapExactETHForTokens'](
				ZERO, 
				[ assets.WETH, assets.USDC ], 
				signer.address,
				parseInt(Date.now()/1e3)+300, 
				{ value: ethers.utils.parseEther('1000') }
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
	
	// Check that these backrun opportunities would actually result in profit
	describe('Execution', () => {

		it('Executed opportunity should match predicted profit', async () => {
			// Create transaction for uniswap trade and sign it
			let UniswapRouter = new ethers.Contract(
				unilikeRouters.uniswap,
				ABIS['uniswapRouter'], 
				signer
			)
			let nextNonce = await signer.getTransactionCount()
			let tradeTxRequest1 = await UniswapRouter.populateTransaction['swapExactETHForTokens'](
				ZERO, 
				[ assets.WETH, assets.DAI, assets.USDC ], 
				signer.address,
				parseInt(Date.now()/1e3)+300, 
				{ 
					value: ethers.utils.parseEther('100'), 
					nonce: nextNonce, 
					gasLimit: 300000
				}
			)
			let signedTradeTxRequest1 = await signer.signTransaction(tradeTxRequest1)
			// Handle new request
			backrunner.handleNewBackrunRequest(signedTradeTxRequest1)
			// Check that request was put in backrun requests pool
			let backrunRequests = backrunner.getBackrunRequests()
			expect(backrunRequests.length).to.equal(1)
			let pathsToCheck = [ 'I000311', 'I001605', 'I000092' ].map(
				instrMng.getPathById
			)
			await arbbot.init(
				ethers.provider, 
				botOperator, 
				ethers.utils.parseUnits('20', 'gwei'), 
				pathsToCheck
			)
			let opps = arbbot.getOpps(backrunRequests)
			expect(opps.length).to.above(0)
			opps.sort((a, b) => b.netProfit.gt(a.netProfit) ? 1 : -1)
			let blockNumber = await ethers.provider.getBlockNumber()
			let dispatcherTx = await txMng.buildDispatcherTx(
				opps[0], 
				blockNumber,
				await botOperator.getTransactionCount()
			)
			// Execute trade tx
			console.log('Executing trade tx')
			await signer.sendTransaction(tradeTxRequest1).then(
				async response => response.wait()
			)
			// Execute arb tx
			
			console.log('Executing arb tx')
			let latestBlock = await ethers.provider.getBlock('latest')  // Miner stays the same!
			let dispatcherBalBefore = await ethers.provider.getBalance(config.DISPATCHER)
			let tipjarBalBefore = await ethers.provider.getBalance(config.TIPJAR)
			let minerBalBefore = await ethers.provider.getBalance(latestBlock.miner)
			await botOperator.sendTransaction(dispatcherTx).then(
				async response => response.wait()
			)
			let dispatcherBalAfter = await ethers.provider.getBalance(config.DISPATCHER)
			let tipjarBalAfter = await ethers.provider.getBalance(config.TIPJAR)
			let minerBalAfter = await ethers.provider.getBalance(latestBlock.miner)
			let dispatcherBalNet = dispatcherBalAfter.sub(dispatcherBalBefore)
			let tipjarBalNet = tipjarBalAfter.sub(tipjarBalBefore)
			let minerBalNet = minerBalAfter.sub(minerBalBefore)
			// Compare state before and after arb tx
			let minerReward = ethers.utils.parseUnits('2')
			minerBalNet = minerBalNet.sub(minerReward)  // Only interested in out contribution to miner
			console.log('Estimated profit: ', ethers.utils.formatUnits(
				opps[0].netProfit
			), 'ETH')
			console.log('Executed profit: ', ethers.utils.formatUnits(
				minerBalNet.add(dispatcherBalNet).add(tipjarBalNet)
			), 'ETH')
			// NOTE: There will be difference in profit as the gas estimate is not accurate
			expect(minerBalNet.add(dispatcherBalNet).add(tipjarBalNet)).to.be.closeTo(
				opps[0].netProfit, ethers.utils.parseEther('0.02')
			)
		}).timeout(1000000)

	})

})

