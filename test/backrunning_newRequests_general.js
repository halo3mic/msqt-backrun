const { expect } = require("chai");
const { ethers } = require("hardhat");

const { assets, unilikeRouters } = require('./addresses.json') 
const reservesMng = require('../src/reservesManager')
const instrMng = require('../src/instrManager')
const backrunner = require('../src/backrunner')
const txMng = require('../src/txManager')
const server = require('../src/server')
const arbbot = require('../src/arbbot')
const config = require('../src/config')
const fetch = require('node-fetch')

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

	async function topUpAccount(accountAddress, amount) {
		let topper = genNewAccount()
		await topper.sendTransaction({
			to: accountAddress, 
			value: amount
		})
	}
	
	before(async () => {
		genNewAccount = await makeAccountGen()
		signer = ethers.Wallet.createRandom().connect(ethers.provider)
		botOperator = new ethers.Wallet(config.settings.network.privateKey, ethers.provider)
	})

	beforeEach(() => {
		trader = genNewAccount()
		// Restart requests pool with each test
		backrunner.cleanRequestsPool()
	})

	it('`decryptUnilikeTx` should return null if tx type is not supported (no data)', async () => {
		let tx = {
			to: ethers.constants.AddressZero, 
			from: trader.address
		}
		// Decrypt signed transaction
		expect(backrunner.decryptUnilikeTx(tx)).to.be.null
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

	describe('External requests to the bot', () => {

		before(async () => {
			// Start arb bot and request listener
			await server.init()
			server.startRequestUpdates()
		})

		after(() => {
			server.stopRequestUpdates()
		})

		it('Signed transaction request to /submitRequest should be added to the local mempool', async () => {
			// Make request and sign it
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
				abis['uniswapRouter'] 
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
			// Submit signed tx request to the bot
			let response = await fetch(
				'http://localhost:8888/submitRequest', 
				{
					method: 'post',
					body:    signedTradeTxRequest,
					headers: { 'Content-Type': 'application/text' },
				}
			)
			response = await response.json()
			expect(response.status).to.equal(1)
			expect(response.msg).to.equal('OK')
			// Confirm the tx request was accepted
			let backrunRequests = arbbot.getBackrunRequests()
			expect(backrunRequests.length).to.equal(1)
			expect(backrunRequests[0].signedRequest).to.equal(signedTradeTxRequest)
		})
	
		it('Request to /submitRequest in invalid format shall be rejected', async () => {
			let response = await fetch(
				'http://localhost:8888/submitRequest', 
				{
					method: 'post',
					body:    'this is not a hex string',
					headers: { 'Content-Type': 'application/text' },
				}
			)
			response = await response.json()
			expect(response.status).to.equal(0)
			expect(response.msg).to.equal('RequestError: Not in hex format')
		})
	
		it('Signed transaction request to /backrunRequest should return bundle to the sender if opps are found for request', async () => {
			// Make request and sign it
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
				abis['uniswapRouter'] 
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
			// Submit signed tx request to the bot
			let requestSubmissionTime = Date.now()
			let response = await fetch(
				'http://localhost:8888/backrunRequest', 
				{
					method: 'post',
					body:    signedTradeTxRequest,
					headers: { 'Content-Type': 'application/text' },
				}
			)
			let requestRecievedTime = Date.now()
			console.log(`Time taken for request: ${requestRecievedTime-requestSubmissionTime} ms`)
			response = await response.json()
			expect(response.msg).to.equal('OK')
			expect(response.status).to.equal(1)
			expect(response.result).to.have.all.keys(['ethCall', 'signature', 'senderAddress'])
		})
	
		it('Signed transaction request to /backrunRequest should return empty object if opps are not found for request', async () => {
			// ! Could fail if there actually is opportunity for pools trade goes through without backrunning
			// TODO: Prevent above
			// Make request and sign it
			let txCallArgs = {
				amountIn: ethers.utils.parseEther('0.001'),
				amountOut: ZERO,
				method: 'swapExactETHForTokens',
				tknPath: [ assets.WETH, assets.DAI ],
				router: unilikeRouters.uniswap, 
				deadline: parseInt(Date.now()/1e3)+300
			}
			let UniswapRouter = new ethers.Contract(
				txCallArgs.router,
				abis['uniswapRouter'] 
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
			// Submit signed tx request to the bot
			let requestSubmissionTime = Date.now()
			let response = await fetch(
				'http://localhost:8888/backrunRequest', 
				{
					method: 'post',
					body:    signedTradeTxRequest,
					headers: { 'Content-Type': 'application/text' },
				}
			)
			let requestRecievedTime = Date.now()
			console.log(`Time taken for request: ${requestRecievedTime-requestSubmissionTime} ms`)
			response = await response.json()
			expect(response.msg).to.equal('OK')
			expect(response.status).to.equal(1)
			expect(response.result).to.be.empty
		})
	
		it('Request to /backrunRequest in invalid format shall be rejected', async () => {
			let response = await fetch(
				'http://localhost:8888/backrunRequest', 
				{
					method: 'post',
					body:    'this is not a hex string',
					headers: { 'Content-Type': 'application/text' },
				}
			)
			response = await response.json()
			expect(response.status).to.equal(0)
			expect(response.msg).to.equal('RequestError: Not in hex format')
		})

	})


})
