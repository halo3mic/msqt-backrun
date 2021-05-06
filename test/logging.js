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
const utils = require('../src/utils')
const fetch = require('node-fetch')
const csv = require('csvtojson')
const fs = require('fs');


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

function isNumeric(value) {
    return /^-?\d+$/.test(value);
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

describe('Logging', () => {

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

	describe('Log requests', () => {

		before(async () => {
			// Start arb bot and request listener
			await server.init()
			server.startRequestUpdates()
            // Change save destination
            config.constants.paths.requests = __dirname + '/.test.requests.csv'
		})

        afterEach(async () => {
            // Clean the test logs
            fs.unlinkSync(config.constants.paths.requests)
            // Wait to resolve all 
            await utils.sleep(1)
        })

		it('Request to /submitRequest and its response should be saved locally (success)', async () => {
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
			// Confirm the request and its response were saved
            await server.logger.flush()  // Flush data from memory to disk
            expect(server.logger.getRequests().length).to.equal(0)  // Make sure temp memory is cleared
            console.log(`Trying to read file saved at ${config.constants.paths.requests}`)
            let [ savedRequest ] = await csv().fromFile(
                config.constants.paths.requests
            )
            expect(savedRequest.method).to.equal('submitRequest')
            expect(savedRequest.rawTx).to.equal(signedTradeTxRequest)
            expect(savedRequest.response).to.equal(JSON.stringify(response))
            expect(typeof savedRequest.id == 'string').to.be.true
            expect(isNumeric(savedRequest.blockNumber)).to.be.true
            expect(isNumeric(savedRequest.timestampRecv)).to.be.true
            expect(isNumeric(savedRequest.timestampResp)).to.be.true
		})
	
		it('Request to /submitRequest in invalid format shall be rejected', async () => {
            let signedTradeTxRequest = 'this is not a hex string'
			let response = await fetch(
				'http://localhost:8888/submitRequest', 
				{
					method: 'post',
					body:    signedTradeTxRequest,
					headers: { 'Content-Type': 'application/text' },
				}
			)
			response = await response.json()
            // Confirm the request and its response were saved
            await server.logger.flush()  // Flush data from memory to disk
            expect(server.logger.getRequests().length).to.equal(0)  // Make sure temp memory is cleared
            let [ savedRequest ] = await csv().fromFile(
                config.constants.paths.requests
            )
            expect(savedRequest.method).to.equal('submitRequest')
            expect(savedRequest.rawTx).to.equal(signedTradeTxRequest)
            expect(savedRequest.response).to.equal(JSON.stringify(response))
            expect(typeof savedRequest.id == 'string').to.be.true
            expect(isNumeric(savedRequest.blockNumber)).to.be.true
            expect(isNumeric(savedRequest.timestampRecv)).to.be.true
            expect(isNumeric(savedRequest.timestampResp)).to.be.true
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
			// Confirm the request and its response were saved
            await server.logger.flush()  // Flush data from memory to disk
            expect(server.logger.getRequests().length).to.equal(0)  // Make sure temp memory is cleared
            let [ savedRequest ] = await csv().fromFile(
                config.constants.paths.requests
            )
            expect(savedRequest.method).to.equal('backrunRequest')
            expect(savedRequest.rawTx).to.equal(signedTradeTxRequest)
            expect(savedRequest.response).to.equal(JSON.stringify(response))
            expect(typeof savedRequest.id == 'string').to.be.true
            expect(isNumeric(savedRequest.blockNumber)).to.be.true
            expect(isNumeric(savedRequest.timestampRecv)).to.be.true
            expect(isNumeric(savedRequest.timestampResp)).to.be.true
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
			// Confirm the request and its response were saved
            await server.logger.flush()  // Flush data from memory to disk
            expect(server.logger.getRequests().length).to.equal(0)  // Make sure temp memory is cleared
            let [ savedRequest ] = await csv().fromFile(
                config.constants.paths.requests
            )
            expect(savedRequest.method).to.equal('backrunRequest')
            expect(savedRequest.rawTx).to.equal(signedTradeTxRequest)
            expect(savedRequest.response).to.equal(JSON.stringify(response))
            expect(typeof savedRequest.id == 'string').to.be.true
            expect(isNumeric(savedRequest.blockNumber)).to.be.true
            expect(isNumeric(savedRequest.timestampRecv)).to.be.true
            expect(isNumeric(savedRequest.timestampResp)).to.be.true
		})
	
		it('Request to /backrunRequest in invalid format shall be rejected', async () => {
            let signedTradeTxRequest = 'this is not a hex string'
			let response = await fetch(
				'http://localhost:8888/backrunRequest', 
				{
					method: 'post',
					body:    signedTradeTxRequest,
					headers: { 'Content-Type': 'application/text' },
				}
			)
			response = await response.json()
			// Confirm the request and its response were saved
            await server.logger.flush()  // Flush data from memory to disk
            expect(server.logger.getRequests().length).to.equal(0)  // Make sure temp memory is cleared
            let [ savedRequest ] = await csv().fromFile(
                config.constants.paths.requests
            )
            expect(savedRequest.method).to.equal('backrunRequest')
            expect(savedRequest.rawTx).to.equal(signedTradeTxRequest)
            expect(savedRequest.response).to.equal(JSON.stringify(response))
            expect(typeof savedRequest.id == 'string').to.be.true
            expect(isNumeric(savedRequest.blockNumber)).to.be.true
            expect(isNumeric(savedRequest.timestampRecv)).to.be.true
            expect(isNumeric(savedRequest.timestampResp)).to.be.true
		})

	})


})
