const { expect } = require("chai");
const { ethers } = require("hardhat");

const { assets, unilikeRouters } = require('./addresses.json') 
const reservesMng = require('../src/reservesManager')
const instrMng = require('../src/instrManager')
const backrunner = require('../src/backrunner')
const logger = require('../src/logger')
const txMng = require('../src/txManager')
const server = require('../src/server')
const arbbot = require('../src/arbbot')
const config = require('../src/config')
const fetch = require('node-fetch')
const csv = require('csvtojson')
const utils = require('../src/utils')
const fs = require('fs');
const { response } = require("express");

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

async function postToBot(method, data) {
    return fetch(
        'http://localhost:8888/'+method, 
        {
            method: 'post',
            body:    data,
            headers: { 'Content-Type': 'application/text' },
        }
    )
}

function isNumeric(value) {
    return /^-?\d+$/.test(value);
}

function modifyColors(it, describe) {
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
	return [ it, describe ]
}

[ it, describe ]  = modifyColors(it, describe)

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
        // Change save destination
        config.constants.paths.requests = __dirname + '/.test.requests.csv'
        config.constants.paths.opps = __dirname + '/.test.opps.csv'
    })

	beforeEach(() => {
		trader = genNewAccount()
		// Restart requests pool with each test
		backrunner.cleanRequestsPool()
	})

	afterEach(async () => {
		// Clean the test logs
		try { fs.unlinkSync(config.constants.paths.requests) } catch {} 
		try { fs.unlinkSync(config.constants.paths.opps) } catch {} 
	})

	describe('Log requests', () => {

		let signedTradeTxRequest

		before(async () => {
			// Start arb bot and request listener
			await server.init()
			server.startRequestUpdates()
			// Make request and sign it
			let txCallArgs = {
				amountIn: ethers.utils.parseEther('900'),
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
			signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		})

		after(() => {
			server.stopRequestUpdates()
		})

		it('Request to /submitRequest and its response should be saved locally', async () => {
			// Submit signed tx request to the bot
			let response = await postToBot('submitRequest', signedTradeTxRequest).then(r=>r.json())
			expect(response.status).to.equal(1)
			expect(response.msg).to.equal('OK')
			// Confirm the request and its response were saved
			expect(logger.getRequests().length).to.equal(1)
			await logger.flush()  // Flush data from memory to disk
            let [ savedRequest ] = await csv().fromFile(config.constants.paths.requests)
            expect(logger.getRequests().length).to.equal(0)  // Make sure temp memory is cleared
			// Expected response 
            expect(savedRequest.method).to.equal('submitRequest')
            expect(savedRequest.request).to.equal(signedTradeTxRequest)
            expect(savedRequest.response).to.equal(JSON.stringify(response))
            expect(typeof savedRequest.id == 'string').to.be.true
            expect(isNumeric(savedRequest.blockNumber)).to.be.true
            expect(isNumeric(savedRequest.timestampRecv)).to.be.true
            expect(isNumeric(savedRequest.timestampResp)).to.be.true
		})

		it('Request to /cancelRequest and its response should be saved locally', async () => {
			// Submit signed tx request to the bot
			let responseSubmit = await postToBot('submitRequest', signedTradeTxRequest).then(r=>r.json())
			expect(responseSubmit.status).to.equal(1)
			expect(responseSubmit.msg).to.equal('OK')
			// Msg the bot to cancel a transaction
			let txRequestHash = ethers.utils.keccak256(signedTradeTxRequest)
			let responseCancel = await postToBot('cancelRequest', txRequestHash).then(r=>r.json())
			expect(responseCancel.status).to.equal(1)
			expect(responseCancel.msg).to.equal('OK')
			// Confirm the request and its response were saved
			expect(logger.getRequests().length).to.equal(2)  // Submit the request & Cancel the request
			await logger.flush()  // Flush data from memory to disk
            let [ submitRequest, cancelRequest ] = await csv().fromFile(config.constants.paths.requests)
            expect(logger.getRequests().length).to.equal(0)  // Make sure temp memory is cleared
			// Expected response
            expect(cancelRequest.method).to.equal('cancelRequest')
            expect(cancelRequest.request).to.equal(txRequestHash)
            expect(cancelRequest.response).to.equal(JSON.stringify(responseCancel))
            expect(typeof cancelRequest.id == 'string').to.be.true
            expect(isNumeric(cancelRequest.blockNumber)).to.be.true
            expect(isNumeric(cancelRequest.timestampRecv)).to.be.true
            expect(isNumeric(cancelRequest.timestampResp)).to.be.true
		})

		it('Request to /backrunRequets and its response should be saved locally', async () => {
			// Submit signed tx request to the bot
			let response = await postToBot('backrunRequest', signedTradeTxRequest).then(r=>r.json())
			expect(response.status).to.equal(1)
			expect(response.msg).to.equal('OK')
			// Confirm the request and its response were saved
			expect(logger.getRequests().length).to.equal(1)
			await logger.flush()  // Flush data from memory to disk
            let [ savedRequest ] = await csv().fromFile(config.constants.paths.requests)
            expect(logger.getRequests().length).to.equal(0)  // Make sure temp memory is cleared
			// Expected response 
            expect(savedRequest.method).to.equal('backrunRequest')
            expect(savedRequest.request).to.equal(signedTradeTxRequest)
            expect(savedRequest.response).to.equal(JSON.stringify(response))
            expect(typeof savedRequest.id == 'string').to.be.true
            expect(isNumeric(savedRequest.blockNumber)).to.be.true
            expect(isNumeric(savedRequest.timestampRecv)).to.be.true
            expect(isNumeric(savedRequest.timestampResp)).to.be.true
		})

	})

    describe('Log opportunities', () => {

		before(async () => {
			// Start arb bot and request listener
			await server.init()
			server.startRequestUpdates()
			// Make request and sign it
			let txCallArgs = {
				amountIn: ethers.utils.parseEther('900'),
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
			signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		})

		it('All opportunities founds with `backrunRawRequest` should be saved to csv', async () => {
			// Backrun raw request
			let response = await arbbot.backrunRawRequest(
				signedTradeTxRequest, 
				await ethers.provider.getBlockNumber()
			)
			expect(response.ethCall.params[0].length).to.equal(2)
			expect(response.ethCall.params[0][0]).to.equal(signedTradeTxRequest)
			// Confirm the request and its response were saved
			expect(logger.getOpps().length).to.gt(0)
			await logger.flush()  // Flush data from memory to disk
            let savedOpps = await csv().fromFile(config.constants.paths.opps)
			expect(logger.getRequests().length).to.equal(0)  // Make sure temp memory is cleared
			// Expected response 
			savedOpps.forEach(savedOpp => {
				expect(typeof savedOpp.id == 'string' && savedOpp.id!=undefined).to.be.true
				expect(isNumeric(savedOpp.blockNumber)).to.be.true
				expect(typeof savedOpp.path == 'string' && savedOpp.path!=undefined).to.be.true
				expect(savedOpp.backrunTxs).to.equal(signedTradeTxRequest)
				expect(isNumeric(savedOpp.inputAmount)).to.be.true
				expect(isNumeric(savedOpp.grossProfit)).to.be.true
				expect(isNumeric(savedOpp.gasAmount)).to.be.true
				expect(isNumeric(savedOpp.netProfit)).to.be.true
				expect(isNumeric(savedOpp.netProfit)).to.be.true
			})
		})

		it('All opportunities founds with `handleOpps` should be saved to csv', async () => {
			// Find opps and "handle them"
			let request = backrunner.parseBackrunRequest(signedTradeTxRequest)
    		let opps = arbbot.getOppsForRequest(request)
			let response = await arbbot.handleOpps(
				await ethers.provider.getBlockNumber(),
				opps
			)
			expect(response).to.be.true
			// Confirm the request and its response were saved
			expect(logger.getOpps().length).to.gt(0)
			await logger.flush()  // Flush data from memory to disk
            let savedOpps = await csv().fromFile(config.constants.paths.opps)
			expect(logger.getRequests().length).to.equal(0)  // Make sure temp memory is cleared
			// Expected response 
			savedOpps.forEach(savedOpp => {
				expect(typeof savedOpp.id == 'string' && savedOpp.id!=undefined).to.be.true
				expect(isNumeric(savedOpp.blockNumber)).to.be.true
				expect(typeof savedOpp.path == 'string' && savedOpp.path!=undefined).to.be.true
				expect(savedOpp.backrunTxs).to.equal(signedTradeTxRequest)
				expect(isNumeric(savedOpp.inputAmount)).to.be.true
				expect(isNumeric(savedOpp.grossProfit)).to.be.true
				expect(isNumeric(savedOpp.gasAmount)).to.be.true
				expect(isNumeric(savedOpp.netProfit)).to.be.true
				expect(isNumeric(savedOpp.netProfit)).to.be.true
			})
		})

	})


})
