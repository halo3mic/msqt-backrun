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

describe('Request validity', () => {

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
