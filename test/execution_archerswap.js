require('./helpers/helpers').load()
const relaySimulator = require('./helpers/relaySimulator')
const config = require('../src/config')
const utils = require('../src/utils')

// Check that these backrun opportunities would actually result in profit
describe('Execution', () => {

	let archerEndpointBefore
	
	before(async () => {
		// Change to local relay simulator
		archerEndpointBefore = config.constants.archerBundleEndpoint
		config.constants.archerBundleEndpoint = 'http://localhost:8777/sendBundle'
		genNewAccount = await makeAccountGen()
		signer = ethers.Wallet.createRandom().connect(ethers.provider)  // Create an account to sign txs
		botOperator = new ethers.Wallet(config.settings.network.privateKey, ethers.provider)  // Interact with dispatcher
		bank = genNewAccount()  // Source of test eth
		await impersonateAccount(signer.address)
		
		txMng.init(ethers.provider, botOperator)
		backrunner.init(ethers.provider)  // Set a provider
		// Init the bot and start the listeners
        // ! NOTE: uses live mainnet provider and real signer
        await server.main(ethers.provider)
		relaySimulator.startListening(ethers.provider)
	})

	after(() => {
		server.stopRequestUpdates()
		// Reset to live relay
		config.constants.archerBundleEndpoint = archerEndpointBefore
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

	it('Relay interaction simulation with instant opportunity', async () => {
		// Opportunity is found and mined as soon as the trade is submitted
		// Create transaction for uniswap trade and sign it
		let amountIn = ethers.utils.parseUnits('11')
		let tipAmount = ethers.utils.parseUnits('0.0001')
		let archerswapRouter = new ethers.Contract(
			config.constants.routers.archerswap,
			abis['archerswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
		let tradeTxRequest1 = await archerswapRouter.populateTransaction['swapExactETHForTokensWithTipAmount'](
			unilikeRouters.sushiswap,
			[
				amountIn,
				ZERO, 
				[ assets.WETH, assets.ARCH ], 
				signer.address,
				parseInt(Date.now()/1e3)+3000, 
			],
			tipAmount, 
			{ 
				value: amountIn.add(tipAmount), 
				gasPrice: ZERO, 
				gasLimit: 300000,
				nonce: nextNonce, 
			}
		)
		let signedTradeTxRequest1 = await signer.signTransaction(tradeTxRequest1)
		let archerAPIArgs = await arbbot.backrunRawRequest(signedTradeTxRequest1)
		if (archerAPIArgs) {
			let latestBlock = await ethers.provider.getBlock('latest')  // Miner stays the same with the fork!
			let dispatcherBalBefore = await ethers.provider.getBalance(config.constants.dispatcher)
			let minerBalBefore = await ethers.provider.getBalance(latestBlock.miner)
	
			await utils.submitBundleToArcher(archerAPIArgs)
			
			let dispatcherBalAfter = await ethers.provider.getBalance(config.constants.dispatcher)
			let minerBalAfter = await ethers.provider.getBalance(latestBlock.miner)
			let dispatcherBalNet = dispatcherBalAfter.sub(dispatcherBalBefore)
			let minerBalNet = minerBalAfter.sub(minerBalBefore)
	
			// Compare state before and after arb tx
			let minerReward = ethers.utils.parseUnits('2').mul('2')  // 2 ETH for two txs in two blocks
			minerBalNet = minerBalNet.sub(minerReward)  // Only interested in trade contribution to the miner
			console.log(ethers.utils.formatUnits(dispatcherBalNet))
			console.log(ethers.utils.formatUnits(minerBalNet))
			let extractedValue = minerBalNet.add(dispatcherBalNet)
			expect(extractedValue).to.gt(ZERO)
			console.log('Executed profit: ', ethers.utils.formatUnits(extractedValue), 'ETH')
		} else {
			console.log('No opportunities')
		}
	}).timeout(1000000)

	// it('Relay interaction simulation with delayed opportunity', async () => {
	// 	// Opportunity is found blocks after the trade was submitted
	// 	// Create transaction for uniswap trade and sign it
	// 	let amountIn = ethers.utils.parseUnits('5')
	// 	let tipAmount = ethers.utils.parseUnits('0.0001')
	// 	let archerswapRouter = new ethers.Contract(
	// 		config.constants.routers.archerswap,
	// 		abis['archerswapRouter'] 
	// 	)
	// 	let nextNonce = await signer.getTransactionCount()
	// 	let tradeTxRequest1 = await archerswapRouter.populateTransaction['swapExactETHForTokensWithTipAmount'](
	// 		unilikeRouters.sushiswap,
	// 		[
	// 			amountIn,
	// 			ZERO, 
	// 			[ assets.WETH, assets.ARCH ],
	// 			signer.address,
	// 			parseInt(Date.now()/1e3)+3000, 
	// 		],
	// 		tipAmount, 
	// 		{ 
	// 			value: amountIn.add(tipAmount), 
	// 			gasPrice: ZERO, 
	// 			gasLimit: 300000,
	// 			nonce: nextNonce, 
	// 		}
	// 	)
	// 	// Transaction that will trigger the backrun
	// 	let amountIn2 = ethers.utils.parseUnits('7')
	// 	let triggerSigner = genNewAccount()
	// 	let nextNonce2 = await triggerSigner.getTransactionCount()
	// 	let triggerTx = await archerswapRouter.populateTransaction['swapExactETHForTokensWithTipAmount'](
	// 		unilikeRouters.sushiswap,
	// 		[
	// 			amountIn2,
	// 			ZERO, 
	// 			[ assets.WETH, assets.ARCH ], 
	// 			triggerSigner.address,
	// 			parseInt(Date.now()/1e3)+3000, 
	// 		],
	// 		tipAmount, 
	// 		{ 
	// 			value: amountIn2.add(tipAmount), 
	// 			gasPrice: ZERO, 
	// 			gasLimit: 300000,
	// 			nonce: nextNonce2
	// 		}
	// 	)
		
	// 	let signedTradeTxRequest1 = await signer.signTransaction(tradeTxRequest1)
	// 	arbbot.handleNewBackrunRequest(signedTradeTxRequest1)

	// 	// Balance before
	// 	let latestBlock = await ethers.provider.getBlock('latest')  // Miner stays the same with the fork!
	// 	let dispatcherBalBefore = await ethers.provider.getBalance(config.constants.dispatcher)
	// 	let minerBalBefore = await ethers.provider.getBalance(latestBlock.miner)
	// 	// Wait for the transaction to be mined
	// 	let txReceiptPromise = ethers.provider.waitForTransaction(ethers.utils.keccak256(signedTradeTxRequest1), 2)
	// 	let timeoutPromise = new Promise(function(resolve, reject) {
	// 		setTimeout(() => reject('Timout reached'), 50000);
	// 	})
	// 	// Wait for a block before submitting trigger transaction
	// 	setTimeout(() => {
	// 		triggerSigner.sendTransaction(triggerTx).catch(e=> {
	// 			console.log('Trigger failed')
	// 			console.log(e)
	// 		})
	// 		console.log('Trigger transaction submitted')
	// 	}, 10000)
	// 	let r = await Promise.race([txReceiptPromise, timeoutPromise])
	// 	expect(r.status).to.equal(1)
	// 	// Balance after
	// 	let dispatcherBalAfter = await ethers.provider.getBalance(config.constants.dispatcher)
	// 	let minerBalAfter = await ethers.provider.getBalance(latestBlock.miner)
	// 	let dispatcherBalNet = dispatcherBalAfter.sub(dispatcherBalBefore)
	// 	let minerBalNet = minerBalAfter.sub(minerBalBefore)
	// 	// Compare state before and after arb tx
	// 	let minerReward = ethers.utils.parseUnits('2').mul('2')  // 2 ETH for two txs in two blocks
	// 	minerBalNet = minerBalNet.sub(minerReward)  // Only interested in trade contribution to the miner
	// 	let extractedValue = minerBalNet.add(dispatcherBalNet)
	// 	expect(extractedValue).to.gt(ZERO)
	// 	console.log('Executed profit: ', ethers.utils.formatUnits(extractedValue), 'ETH')

	// }).timeout(1000000)

	// it('Remove trade request from the pool if account passes a selfie (nonce increase)', async () => {
	// 	// Opportunity is found blocks after the trade was submitted
	// 	// Create transaction for uniswap trade and sign it
	// 	let amountIn = ethers.utils.parseUnits('1')
	// 	let tipAmount = ethers.utils.parseUnits('0.0001')
	// 	let archerswapRouter = new ethers.Contract(
	// 		config.constants.routers.archerswap,
	// 		abis['archerswapRouter'] 
	// 	)
	// 	let nextNonce = await signer.getTransactionCount()
	// 	let tradeTxRequest1 = await archerswapRouter.populateTransaction['swapExactETHForTokensWithTipAmount'](
	// 		unilikeRouters.sushiswap,
	// 		[
	// 			amountIn,
	// 			ZERO, 
	// 			[ assets.WETH, assets.ARCH ],
	// 			signer.address,
	// 			parseInt(Date.now()/1e3)+3000, 
	// 		],
	// 		tipAmount, 
	// 		{ 
	// 			value: amountIn.add(tipAmount), 
	// 			gasPrice: ZERO, 
	// 			gasLimit: 300000,
	// 			nonce: nextNonce, 
	// 		}
	// 	)
		
	// 	let signedTradeTxRequest1 = await signer.signTransaction(tradeTxRequest1)
	// 	arbbot.handleNewBackrunRequest(signedTradeTxRequest1)
	// 	// Send a selfie to increase nonce
	// 	await signer.sendTransaction({to: signer.address})
	// 	// Expect the bot to clear transaction request from the pool
	// 	await arbbot.handleBlockUpdate(0)
	// 	expect(arbbot.getBackrunRequests().length).to.equal(0)
	// }).timeout(1000000)

	// it('Executed opportunity should match predicted profit (execute arguments passed)', async () => {
	// 	// Execute trade and arb txs that would be submitte to relay
	// 	// Create transaction for uniswap trade and sign it
	// 	let amountIn = ethers.utils.parseUnits('100')
	// 	let tipAmount = ethers.utils.parseUnits('0.1')
	// 	let archerswapRouter = new ethers.Contract(
	// 		config.constants.routers.archerswap,
	// 		abis['archerswapRouter'] 
	// 	)
	// 	let tradeTxRequest1 = await archerswapRouter.populateTransaction['swapExactETHForTokensWithTipAmount'](
	// 		unilikeRouters.uniswap,
	// 		[
	// 			amountIn,
	// 			ZERO, 
	// 			[ assets.WETH, assets.DAI, assets.USDC ], 
	// 			signer.address,
	// 			parseInt(Date.now()/1e3)+3000, 
	// 		],
	// 		tipAmount, 
	// 		{ value: amountIn.add(tipAmount), gasPrice: ZERO }
	// 	)
	// 	let signedTradeTxRequest1 = await signer.signTransaction(tradeTxRequest1)
	// 	// Handle new request
	// 	backrunner.handleNewBackrunRequest(signedTradeTxRequest1)
	// 	// Check that request was put in backrun requests pool
	// 	let backrunRequests = backrunner.getBackrunRequests()
	// 	expect(backrunRequests.length).to.equal(1)
	// 	let pathsToCheck = [ 'I000311', 'I001605', 'I000092' ].map(
	// 		instrMng.getPathById
	// 	)
	// 	await arbbot.init(
	// 		ethers.provider, 
	// 		botOperator, 
	// 		ethers.utils.parseUnits('20', 'gwei'), 
	// 		pathsToCheck
	// 	)
	// 	let opps = backrunRequests.map(arbbot.getOppsForRequest).flat()
	// 	expect(opps.length).to.above(0)
	// 	opps.sort((a, b) => b.netProfit.gt(a.netProfit) ? 1 : -1)
	// 	let dispatcherTx = await txMng.formDispatcherTx(
	// 		opps[0],
	// 		await botOperator.getTransactionCount()
	// 	)
	// 	// Execute trade tx
	// 	console.log('Executing trade tx')
	// 	await signer.sendTransaction(tradeTxRequest1).then(
	// 		async response => response.wait()
	// 	)
	// 	// Execute arb tx
	// 	console.log('Executing arb tx')
	// 	let latestBlock = await ethers.provider.getBlock('latest')  // Miner stays the same!
	// 	let dispatcherBalBefore = await ethers.provider.getBalance(config.constants.dispatcher)
	// 	let tipjarBalBefore = await ethers.provider.getBalance(config.constants.tipJar)
	// 	let minerBalBefore = await ethers.provider.getBalance(latestBlock.miner)
	// 	await botOperator.sendTransaction(dispatcherTx).then(
	// 		async response => response.wait()
	// 	)
	// 	let dispatcherBalAfter = await ethers.provider.getBalance(config.constants.dispatcher)
	// 	let tipjarBalAfter = await ethers.provider.getBalance(config.constants.tipJar)
	// 	let minerBalAfter = await ethers.provider.getBalance(latestBlock.miner)
	// 	let dispatcherBalNet = dispatcherBalAfter.sub(dispatcherBalBefore)
	// 	let tipjarBalNet = tipjarBalAfter.sub(tipjarBalBefore)
	// 	let minerBalNet = minerBalAfter.sub(minerBalBefore)
	// 	// Compare state before and after arb tx
	// 	let minerReward = ethers.utils.parseUnits('2')
	// 	minerBalNet = minerBalNet.sub(minerReward)  // Only interested in out contribution to miner
	// 	console.log('Estimated profit: ', ethers.utils.formatUnits(
	// 		opps[0].netProfit
	// 	), 'ETH')
	// 	console.log('Executed profit: ', ethers.utils.formatUnits(
	// 		minerBalNet.add(dispatcherBalNet).add(tipjarBalNet)
	// 	), 'ETH')
	// 	expect(minerBalNet.add(dispatcherBalNet).add(tipjarBalNet)).to.be.closeTo(
	// 		opps[0].netProfit, ethers.utils.parseEther('0.02')
	// 	)
	// }).timeout(1000000)


})
