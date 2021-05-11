require('./helpers/helpers').load()

describe('Logging', () => {
	
	before(async () => {
		cleanTempLogs()
		genNewAccount = await makeAccountGen()
		signer = ethers.Wallet.createRandom().connect(ethers.provider)
		botOperator = new ethers.Wallet(config.settings.network.privateKey, ethers.provider)
    })

	beforeEach(() => {
		trader = genNewAccount()
		// Restart requests pool with each test
		backrunner.cleanRequestsPool()
	})

	afterEach(async () => {
		cleanTempLogs()
	})

	describe('Log backrun requests', () => {

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
			expect(response.status).to.equal(200)
			expect(response.msg).to.equal('OK')
			// Confirm the request and its response were saved
			expect(logger.getBackrunRequests().length).to.equal(1)
			await logger.flush()  // Flush data from memory to disk
            let [ savedRequest ] = await csv().fromFile(config.constants.paths.requests)
            expect(logger.getBackrunRequests().length).to.equal(0)  // Make sure temp memory is cleared
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
			expect(responseSubmit.status).to.equal(200)
			expect(responseSubmit.msg).to.equal('OK')
			// Msg the bot to cancel a transaction
			let txRequestHash = ethers.utils.keccak256(signedTradeTxRequest)
			let responseCancel = await postToBot('cancelRequest', txRequestHash).then(r=>r.json())
			expect(responseCancel.status).to.equal(200)
			expect(responseCancel.msg).to.equal('OK')
			// Confirm the request and its response were saved
			expect(logger.getBackrunRequests().length).to.equal(2)  // Submit the request & Cancel the request
			await logger.flush()  // Flush data from memory to disk
            let [ submitRequest, cancelRequest ] = await csv().fromFile(config.constants.paths.requests)
            expect(logger.getBackrunRequests().length).to.equal(0)  // Make sure temp memory is cleared
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
			expect(response.status).to.equal(200)
			expect(response.msg).to.equal('OK')
			// Confirm the request and its response were saved
			expect(logger.getBackrunRequests().length).to.equal(1)
			await logger.flush()  // Flush data from memory to disk
            let [ savedRequest ] = await csv().fromFile(config.constants.paths.requests)
            expect(logger.getBackrunRequests().length).to.equal(0)  // Make sure temp memory is cleared
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

		after(() => {
			server.stopRequestUpdates()
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
			expect(logger.getOpps().length).to.equal(0)  // Make sure temp memory is cleared
			// Expected response 
			savedOpps.forEach(savedOpp => {
				expect(isString(savedOpp.id)).to.be.true
				expect(isNumeric(savedOpp.blockNumber)).to.be.true
				expect(isString(savedOpp.path)).to.be.true
				expect(savedOpp.backrunTxs).to.equal(signedTradeTxRequest)
				expect(isNumeric(savedOpp.inputAmount)).to.be.true
				expect(isNumeric(savedOpp.grossProfit)).to.be.true
				expect(isNumeric(savedOpp.gasAmount)).to.be.true
				expect(isNumeric(savedOpp.netProfit)).to.be.true
				expect(isNumeric(savedOpp.netProfit)).to.be.true
			})
		})

		it('All opportunities founds with `executeOpps` should be saved to csv', async () => {
			// Find opps and "handle them"
			let backrunRequest = backrunner.parseBackrunRequest(signedTradeTxRequest)
    		let opps = arbbot.getOppsForRequest(backrunRequest)
			let r = await arbbot.executeOpps(
				opps,
				await ethers.provider.getBlockNumber()
			)
			console.log(r)
			let { request, response } = await r[0]
			expect(request.body).to.include(signedTradeTxRequest)
			// Confirm the request and its response were saved
			expect(logger.getOpps().length).to.gt(0)
			await logger.flush()  // Flush data from memory to disk
            let savedOpps = await csv().fromFile(config.constants.paths.opps)
			expect(logger.getOpps().length).to.equal(0)  // Make sure temp memory is cleared
			// Expected response 
			savedOpps.forEach(savedOpp => {
				expect(isString(savedOpp.id)).to.be.true
				expect(isNumeric(savedOpp.blockNumber)).to.be.true
				expect(isString(savedOpp.path)).to.be.true
				expect(savedOpp.backrunTxs).to.equal(signedTradeTxRequest)
				expect(isNumeric(savedOpp.inputAmount)).to.be.true
				expect(isNumeric(savedOpp.grossProfit)).to.be.true
				expect(isNumeric(savedOpp.gasAmount)).to.be.true
				expect(isNumeric(savedOpp.netProfit)).to.be.true
				expect(isNumeric(savedOpp.netProfit)).to.be.true
			})
		})

	})

	describe('Log requests and responses to relay', () => {

		before(async () => {
			// Start arb bot and request listener
			await server.init()
			txMng.init(ethers.provider, botOperator)
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

		it('Response to sending bundle to Archer relay should be saved in csv', async () => {
			// Find opps and execute them
			let backrunRequest = backrunner.parseBackrunRequest(signedTradeTxRequest)
    		let opps = arbbot.getOppsForRequest(backrunRequest)
			let r = await arbbot.executeOpps(opps, await ethers.provider.getBlockNumber())
			let { request, response } = await r[0]
			expect(response).to.be.not.undefined
			console.log(response)
			// Confirm the request and its response were saved
			expect(logger.getRelayRequests().length).to.equal(1)
			await logger.flush()  // Flush data from memory to disk
			// Confirm the request and its response were saved
            let [ savedRelayRequest ]  = await csv().fromFile(config.constants.paths.relayRequests)
			expect(logger.getRelayRequests().length).to.equal(0)  // Make sure temp memory is cleared
			// Expected response 
            expect(isString(savedRelayRequest.id)).to.be.true
            expect(savedRelayRequest.request).to.include(signedTradeTxRequest)
            expect(savedRelayRequest.response).to.equal(JSON.stringify(response))
            expect(isNumeric(savedRelayRequest.blockNumber)).to.be.true
            expect(isNumeric(savedRelayRequest.timestampRecv)).to.be.true
            expect(isNumeric(savedRelayRequest.timestampResp)).to.be.true
		})

	})


})
