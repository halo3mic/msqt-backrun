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
        await server.init(ethers.provider)
		relaySimulator.startListening(ethers.provider)
	})

	after(() => {
		server.stopRequestUpdates()
		relaySimulator.stopListening()
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
		let amountIn = ethers.utils.parseUnits('100')
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
			// console.log(ethers.utils.formatUnits(dispatcherBalNet))
			// console.log(ethers.utils.formatUnits(minerBalNet))
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
	// 	let amountIn = ethers.utils.parseUnits('10')
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
	// 	let amountIn2 = ethers.utils.parseUnits('10')
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
	// 	await arbbot.handleNewBackrunRequest(signedTradeTxRequest1)

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
	// 	await arbbot.handleNewBackrunRequest(signedTradeTxRequest1)
	// 	// Send a selfie to increase nonce
	// 	await signer.sendTransaction({to: signer.address})
	// 	// Expect the bot to clear transaction request from the pool
	// 	await arbbot.handleBlockUpdate(0)
	// 	expect(arbbot.getBackrunRequests().length).to.equal(0)
	// }).timeout(1000000)

	it('Latency shouldnt exponentially increase with higher number of tx requests', async () => {
		
		function timeExecution(fun, args) {
			args = args || []
			let t0 = Date.now()
			fun(...args)
			return Date.now() - t0
		}

		async function getSignedArcherSwapFromETH(amountIn, toToken, dex) {
			// Dont simulate submitted bundles, send it to the real relay
			config.constants.archerBundleEndpoint = archerEndpointBefore
			// Create transaction for uniswap trade and sign it
			let tipAmount = ethers.utils.parseUnits('0.0001')
			let archerswapRouter = new ethers.Contract(
				config.constants.routers.archerswap,
				abis['archerswapRouter'] 
			)
			let nextNonce = await signer.getTransactionCount()
			let tradeTxRequest = await archerswapRouter.populateTransaction['swapExactETHForTokensWithTipAmount'](
				unilikeRouters[dex],
				[
					amountIn,
					ZERO, 
					[ assets.WETH, toToken ],
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
			return signer.signTransaction(tradeTxRequest)
		}

		function findOpps() {
			let backrunRequests = backrunner.getBackrunRequests()
			// Get all opportunities for all requests
			return backrunRequests.map(request => arbbot.getOppForRequest(request)).filter(e=>e)
		}
		
		// Check how much does the arb-search latency increase with the number of requests
		let executionTimes = []
		let maxRequests = 40
		for (let i=0; i<maxRequests; i++) {
			let amountIn = ethers.utils.parseEther((100+i).toString())
			let setting = [ amountIn, assets.LINK, "sushiswap" ]  // Use the same asset to decrease the variability in latency
			await arbbot.handleNewBackrunRequest(
				await getSignedArcherSwapFromETH(...setting)
			)  // Add request to the local pool
			// Check that the number of requests in the pool increases
			let currentRequests = arbbot.getBackrunRequests()
			expect(currentRequests.length).to.equal(i+1)
			// Time how long it takes to find the opp
			let times = 1 // Check N times and take the avg
			let cummTime = 0
			for (let i=0; i<times; i++) {
				cummTime += timeExecution(findOpps)
			}
			executionTimes.push(cummTime/times)
			console.log(`Time taken for ${i+1} requests: ${cummTime/times}ms`)
		}
		let diffs = []
		for (let i=0; i<executionTimes.length-1; i++) {
			let diff = executionTimes[i+1] - executionTimes[i]
			diffs.push(diff)
		}
		let [ isExponential ] = diffs.reduce((a, b) => [b>a[1] && a[0], b], [0, true])
		console.log(`Is exponential: ${isExponential}`)
		console.log('Diffs between neighbours:', diffs.join(', '))
		let totNumOfExecutions = executionTimes.length*(1+executionTimes.length) / 2
		let avgExecutionTime = executionTimes.reduce((a,b) => a+b) / totNumOfExecutions
		console.log(`Avg time for one execution: ${avgExecutionTime}ms`)

		// Change it back to local relay simulator to avoid confusion
		archerEndpointBefore = config.constants.archerBundleEndpoint
	}).timeout(1000000)

	it('Executed opportunity should match predicted profit - 1 hop', async () => {
		// Execute trade and arb txs that would be submitte to relay
		// Create transaction for uniswap trade and sign it
		let amountIn = ethers.utils.parseUnits('700')
		let tipAmount = ethers.utils.parseUnits('0.000001')
		let archerswapRouter = new ethers.Contract(
			config.constants.routers.archerswap,
			abis['archerswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
		let tradeTxRequest1 = await archerswapRouter.populateTransaction['swapExactETHForTokensWithTipAmount'](
			unilikeRouters.uniswap,
			[
				amountIn,
				ZERO, 
				[ assets.WETH, assets.DAI ], 
				signer.address,
				parseInt(Date.now()/1e3)+3000, 
			],
			tipAmount, 
			{ value: amountIn.add(tipAmount), gasPrice: ZERO, nonce: nextNonce }
		)
		let signedTradeTxRequest1 = await signer.signTransaction(tradeTxRequest1)
		// Handle new request
		await backrunner.handleNewBackrunRequest(signedTradeTxRequest1)
		// Check that request was put in backrun requests pool
		let backrunRequests = backrunner.getBackrunRequests()
		expect(backrunRequests.length).to.equal(1)
		// Some fork reserves dont match as they are fetched from mainnet after the fork started
		// To decrase the impact of this pull reserves for only specific paths
		let pathsToCheck = [ 'I000311', 'I001605', 'I000092' ].map(instrMng.getPathById)
		await server.init(
			ethers.provider, 
			pathsToCheck, 
			botOperator
		)
		let opps = backrunRequests.map(arbbot.getOppForRequest)
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
			opps[0].grossProfit
		), 'ETH')
		console.log('Executed profit: ', ethers.utils.formatUnits(
			minerBalNet.add(dispatcherBalNet).add(tipjarBalNet)
		), 'ETH')
		console.log(ethers.utils.formatUnits(minerBalNet.add(dispatcherBalNet).add(tipjarBalNet)))
		expect(minerBalNet.add(dispatcherBalNet).add(tipjarBalNet)).to.be.closeTo(
			opps[0].grossProfit, ethers.utils.parseEther('0.00001')
		)
	}).timeout(1000000)

	it('Executed opportunity should match predicted profit - 2 hops', async () => {
		// Execute trade and arb txs that would be submitte to relay
		// Create transaction for uniswap trade and sign it
		let amountIn = ethers.utils.parseUnits('900')
		let tipAmount = ethers.utils.parseUnits('0.000001')
		let archerswapRouter = new ethers.Contract(
			config.constants.routers.archerswap,
			abis['archerswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
		let tradeTxRequest1 = await archerswapRouter.populateTransaction['swapExactETHForTokensWithTipAmount'](
			unilikeRouters.uniswap,
			[
				amountIn,
				ZERO, 
				[ assets.WETH, assets.USDC, assets.DAI ], 
				signer.address,
				parseInt(Date.now()/1e3)+3000, 
			],
			tipAmount, 
			{ value: amountIn.add(tipAmount), gasPrice: ZERO, nonce: nextNonce }
		)
		let signedTradeTxRequest1 = await signer.signTransaction(tradeTxRequest1)
		// Handle new request
		await backrunner.handleNewBackrunRequest(signedTradeTxRequest1)
		// Check that request was put in backrun requests pool
		let backrunRequests = backrunner.getBackrunRequests()
		expect(backrunRequests.length).to.equal(1)
		// Some fork reserves dont match as they are fetched from mainnet after the fork started
		// To decrase the impact of this pull reserves for only specific paths
		let pathsToCheck = [ 'I000311', 'I001605', 'I000092' ].map(instrMng.getPathById)
		await server.init(
			ethers.provider, 
			pathsToCheck, 
			botOperator
		)
		let opp = arbbot.getOppForRequest(backrunRequests[0])
		expect(opp).to.be.not.null
		let dispatcherTx = await txMng.formDispatcherTx(
			opp,
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
			opp.grossProfit
		), 'ETH')
		console.log('Executed profit: ', ethers.utils.formatUnits(
			minerBalNet.add(dispatcherBalNet).add(tipjarBalNet)
		), 'ETH')
		console.log(ethers.utils.formatUnits(minerBalNet.add(dispatcherBalNet).add(tipjarBalNet)))
		expect(minerBalNet.add(dispatcherBalNet).add(tipjarBalNet)).to.be.closeTo(
			opp.grossProfit, ethers.utils.parseEther('0.00001')
		)
	}).timeout(1000000)


})
