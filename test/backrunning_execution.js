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

// Check that these backrun opportunities would actually result in profit
describe('Execution', () => {

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