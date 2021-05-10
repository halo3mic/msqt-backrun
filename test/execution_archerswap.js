require('./helpers/helpers').load()

// Check that these backrun opportunities would actually result in profit
describe('Execution', () => {
	
	before(async () => {
		genNewAccount = await makeAccountGen()
		signer = ethers.Wallet.createRandom().connect(ethers.provider)  // Create an account to sign txs
		botOperator = new ethers.Wallet(config.settings.network.privateKey, ethers.provider)  // Interact with dispatcher
		bank = genNewAccount()  // Source of test eth
		await impersonateAccount(signer.address)
		
		txMng.init(ethers.provider, botOperator)
		backrunner.init(ethers.provider)  // Set a provider
		// Init the bot and start the listeners
        // ! NOTE: uses live mainnet provider and real signer
        await server.main()
	})

	after(() => {
		server.stopRequestUpdates()
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

	it('Executed opportunity should match predicted profit (execute arguments passed)', async () => {
		// Create transaction for uniswap trade and sign it
		let amountIn = ethers.utils.parseUnits('100')
		let tipAmount = ethers.utils.parseUnits('0.1')
		let archerswapRouter = new ethers.Contract(
			config.constants.routers.archerswap,
			abis['archerswapRouter'] 
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
			{ value: amountIn.add(tipAmount), gasPrice: ZERO }
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
		let opps = backrunRequests.map(arbbot.getOppsForRequest).flat()
		expect(opps.length).to.above(0)
		opps.sort((a, b) => b.netProfit.gt(a.netProfit) ? 1 : -1)
		let dispatcherTx = await txMng.formDispatcherTx(
			opps[0],
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
		let dispatcherBalBefore = await ethers.provider.getBalance(config.constants.dispatcher)
		let tipjarBalBefore = await ethers.provider.getBalance(config.constants.tipJar)
		let minerBalBefore = await ethers.provider.getBalance(latestBlock.miner)
		await botOperator.sendTransaction(dispatcherTx).then(
			async response => response.wait()
		)
		let dispatcherBalAfter = await ethers.provider.getBalance(config.constants.dispatcher)
		let tipjarBalAfter = await ethers.provider.getBalance(config.constants.tipJar)
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
		expect(minerBalNet.add(dispatcherBalNet).add(tipjarBalNet)).to.be.closeTo(
			opps[0].netProfit, ethers.utils.parseEther('0.02')
		)
	}).timeout(1000000)

	// it('`swapExactETHForTokensWithTipAmount` DAI->USDC on Uniswap (execute from bundles sent)', async () => {
    //     let amountIn = ethers.utils.parseUnits('1000000')
    //     let tipAmount = ethers.utils.parseUnits('0.1')
    //     let archerswapRouter = new ethers.Contract(
    //         config.constants.routers.archerswap,
    //         config.abis['archerswapRouter'] 
    //     )
    //     let tradeTxRequest = await archerswapRouter.populateTransaction['swapExactETHForTokensWithTipAmount'](
    //         unilikeRouters.uniswap,
    //         [
    //             amountIn,
    //             ZERO, 
    //             [ assets.DAI, assets.USDC ], 
    //             signer.address,
    //             parseInt(Date.now()/1e3)+3000, 
    //         ],
    //         tipAmount, 
    //         { value: tipAmount, gasPrice: ZERO, gasLimit: config.settings.gas.gasLimit }
    //     )
    //     let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
    //     // Send signed transaction request to the bot
    //     let timestamp0 = Date.now()
    //     let response = await sendRequestToBot(signedTradeTxRequest).then(r => r.json())
    //     let timestamp1 = Date.now()
    //     console.log(`Time for the bot to process the tx request: ${timestamp1-timestamp0} ms`)
    //     expect(response.status).to.equal(1)
    //     // Simulate bundle with eth_callBundle
    //     let callBundleArgs = await txMng.getArcherCallBundleParams(
    //         response.result.ethCall.params[0], 
    //         parseInt(response.result.ethCall.params[1], 16)
    //     )
    //     let responseArcherCall = await utils.submitBundleToArcher(callBundleArgs)
    //     console.log(responseArcherCall)
    // }).timeout(1000000)

})
