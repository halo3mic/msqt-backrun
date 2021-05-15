require('./helpers/helpers').load()

// Check that these backrun opportunities would actually result in profit
describe('Execution', () => {
	
	before(async () => {
		genNewAccount = await makeAccountGen()
		signer = ethers.Wallet.createRandom().connect(ethers.provider)  // Create an account to sign txs
		botOperator = new ethers.Wallet(config.settings.network.privateKey, ethers.provider)  // Interact with dispatcher
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
			abis['uniswapRouter'], 
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
		await backrunner.handleNewBackrunRequest(signedTradeTxRequest1)
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
		// NOTE: There will be difference in profit as the gas estimate is not accurate
		expect(minerBalNet.add(dispatcherBalNet).add(tipjarBalNet)).to.be.closeTo(
			opps[0].netProfit, ethers.utils.parseEther('0.02')
		)
	}).timeout(1000000)

})
