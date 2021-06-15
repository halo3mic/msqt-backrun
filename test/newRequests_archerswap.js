require('./helpers/helpers').load()
const { provider: mainnetProvider } = require('../src/provider').ws

describe('Handle new backrun request', () => {
	
	before(async () => {
		genNewAccount = await makeAccountGen()
		signer = ethers.Wallet.createRandom().connect(ethers.provider)
		botOperator = new ethers.Wallet(config.settings.network.privateKey, ethers.provider)
		backrunner.init(ethers.provider)
	})

	beforeEach(() => {
		trader = genNewAccount()
		// Restart requests pool with each test
		backrunner.cleanRequestsPool()
	})

	it('ArcherSwap `swapExactETHForTokensWithTipAmount` signed tx should be decrypted', async () => {
		// Create transaction for uniswap trade and sign it
		let txCallArgs = {
			amountIn: ethers.utils.parseEther('100'),
			amountOut: ZERO,
			method: 'swapExactETHForTokensWithTipAmount',
			tknPath: [ assets.WETH, assets.DAI ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+300, 
			tipAmount: ethers.utils.parseUnits('0.1')
		}
		let archerswapRouter = new ethers.Contract(
			config.constants.routers.archerswap,
			abis['archerswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
		nextNonce = nextNonce==0 ? 1 : nextNonce
		let tradeTxRequest = await archerswapRouter.populateTransaction[txCallArgs.method](
			txCallArgs.router,
			[
				txCallArgs.amountIn,
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
			],
			txCallArgs.tipAmount,
			{ 
				gasPrice: ZERO, 
				value: txCallArgs.amountIn, 
				nonce: nextNonce, 
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Decrypt signed transaction
		let response = backrunner.decryptRawTx(signedTradeTxRequest)
		expect(response.callArgs).to.not.be.undefined  // Expect reponse
		let { txRequest, callArgs, sender } = response
		// Compare passed call arguments to decrypted ones
		expect(callArgs.amountIn).to.equal(txCallArgs.amountIn)
		expect(callArgs.amountOut).to.equal(txCallArgs.amountOut)
		expect(callArgs.method).to.equal(txCallArgs.method)
		expect(callArgs.tknPath.join('')).to.equal(txCallArgs.tknPath.join(''))
		expect(callArgs.router).to.equal(txCallArgs.router)
		expect(callArgs.deadline).to.equal(txCallArgs.deadline)
		// Compare passed transaction parameters to unsigned ones
		expect(txRequest.to).to.equal(tradeTxRequest.to)
		expect(txRequest.nonce).to.equal(tradeTxRequest.nonce)
		expect(txRequest.value).to.equal(tradeTxRequest.value)
		expect(sender).to.equal(signer.address)
	})

	it('ArcherSwap `swapExactETHForTokensWithTipPct` signed tx should be decrypted', async () => {
		// Create transaction for uniswap trade and sign it
		let txCallArgs = {
			amountIn: ethers.utils.parseEther('100'),
			amountOut: ZERO,
			method: 'swapExactETHForTokensWithTipPct',
			tknPath: [ assets.WETH, assets.DAI ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+300, 
			tipPct: (0.5*1000000).toString()
		}
		let archerswapRouter = new ethers.Contract(
			config.constants.routers.archerswap,
			abis['archerswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
		nextNonce = nextNonce==0 ? 1 : nextNonce
		let tradeTxRequest = await archerswapRouter.populateTransaction[txCallArgs.method](
			txCallArgs.router,
			[
				txCallArgs.amountIn,
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
			],
			txCallArgs.tipPct,
			{ 
				gasPrice: ZERO, 
				value: txCallArgs.amountIn, 
				nonce: nextNonce, 
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Decrypt signed transaction
		let response = backrunner.decryptRawTx(signedTradeTxRequest)
		expect(response.callArgs).to.not.be.undefined  // Expect reponse
		let { txRequest, callArgs, sender } = response
		// Compare passed call arguments to decrypted ones
		expect(callArgs.amountIn).to.equal(txCallArgs.amountIn)
		expect(callArgs.amountOut).to.equal(txCallArgs.amountOut)
		expect(callArgs.method).to.equal(txCallArgs.method)
		expect(callArgs.tknPath.join('')).to.equal(txCallArgs.tknPath.join(''))
		expect(callArgs.router).to.equal(txCallArgs.router)
		expect(callArgs.deadline).to.equal(txCallArgs.deadline)
		// Compare passed transaction parameters to unsigned ones
		expect(txRequest.to).to.equal(tradeTxRequest.to)
		expect(txRequest.nonce).to.equal(tradeTxRequest.nonce)
		expect(txRequest.value).to.equal(tradeTxRequest.value)
		expect(sender).to.equal(signer.address)
	})

	it('ArcherSwap `swapExactTokensForTokensWithTipAmount` signed tx should be decrypted', async () => {
		// Create transaction for uniswap trade and sign it
		let txCallArgs = {
			amountIn: ethers.utils.parseEther('100'),
			amountOut: ZERO,
			method: 'swapExactTokensForETHAndTipAmount',
			tknPath: [ assets.WETH, assets.DAI ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+300
		}
		let archerswapRouter = new ethers.Contract(
			config.constants.routers.archerswap,
			abis['archerswapRouter']
		)
		let nextNonce = await signer.getTransactionCount()
		nextNonce = nextNonce==0 ? 1 : nextNonce
		console.log('Forming tx request')
		let tradeTxRequest = await archerswapRouter.populateTransaction[txCallArgs.method](
			txCallArgs.router,
			[
				txCallArgs.amountIn,
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
			],
			{ 
				gasPrice: ZERO, 
				nonce: nextNonce,
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Decrypt signed transaction
		let response = backrunner.decryptRawTx(signedTradeTxRequest)
		expect(response.callArgs).to.not.be.undefined  // Expect reponse
		let { txRequest, callArgs, sender } = response
		// Compare passed call arguments to decrypted ones
		expect(callArgs.amountIn).to.equal(txCallArgs.amountIn)
		expect(callArgs.amountOut).to.equal(txCallArgs.amountOut)
		expect(callArgs.method).to.equal(txCallArgs.method)
		expect(callArgs.tknPath.join('')).to.equal(txCallArgs.tknPath.join(''))
		expect(callArgs.router).to.equal(txCallArgs.router)
		expect(callArgs.deadline).to.equal(txCallArgs.deadline)
		// Compare passed transaction parameters to unsigned ones
		expect(txRequest.to).to.equal(tradeTxRequest.to)
		expect(txRequest.nonce).to.equal(tradeTxRequest.nonce)
		expect(sender).to.equal(signer.address)
	})

	it('`decryptUnilikeTx` should return null if tx type is not supported (no data)', async () => {
		let tx = {
			to: ethers.constants.AddressZero, 
			from: trader.address
		}
		// Decrypt signed transaction
		expect(backrunner.decryptArcherswapTx(tx)).to.be.null
	})

	it('ArcherSwap signed tx with unsupported method should not be decrypted', async () => {
		// Create transaction for uniswap trade and sign it
		let archerswapRouter = new ethers.Contract(
			config.constants.routers.archerswap,
			abis['archerswapRouter']
		)
		let nextNonce = await signer.getTransactionCount()
		nextNonce = nextNonce==0 ? 1 : nextNonce
		let tradeTxRequest = await archerswapRouter.populateTransaction['addLiquidityAndTipAmount'](
			unilikeRouters.uniswap,
			[
				assets.DAI, 
				assets.WETH, 
				ethers.utils.parseUnits('1'), 
				ethers.utils.parseUnits('3500'), 
				ZERO, 
				ZERO, 
				signer.address, 
				parseInt(Date.now()/1e3)+300
			],
			{ value: ethers.utils.parseEther('0.2') }
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Decrypt signed transaction
		let response = backrunner.decryptRawTx(signedTradeTxRequest)
		let { callArgs } = response
		// Compare passed call arguments to decrypted ones
		expect(callArgs).to.be.undefined
	})

	it('`handleNewBackrunRequest` should decrypt, enrich and save request', async () => {
		// Create transaction for uniswap trade and sign it
		let txCallArgs = {
			amountIn: ethers.utils.parseEther('1000'),
			amountOut: ZERO,
			method: 'swapExactETHForTokensWithTipAmount',
			tknPath: [ assets.WETH, assets.DAI ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+300, 
			tipAmount: ethers.utils.parseUnits('0.1')
		}
		let archerswapRouter = new ethers.Contract(
			config.constants.routers.archerswap,
			abis['archerswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
		nextNonce = nextNonce==0 ? 1 : nextNonce
		let tradeTxRequest = await archerswapRouter.populateTransaction[txCallArgs.method](
			txCallArgs.router,
			[
				txCallArgs.amountIn,
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
			],
			txCallArgs.tipAmount,
			{ 
				gasPrice: ZERO, 
				value: txCallArgs.amountIn, 
				nonce: nextNonce, 
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		await backrunner.handleNewBackrunRequest(signedTradeTxRequest)
		let backrunRequests = backrunner.getBackrunRequests()
		expect(backrunRequests.length).to.equal(1)
		let { callArgs, txRequest, sender } = backrunRequests[0]
		// Compare passed call arguments to decrypted ones
		expect(callArgs.amountIn).to.equal(txCallArgs.amountIn)
		expect(callArgs.amountOut).to.equal(txCallArgs.amountOutMin)
		expect(callArgs.tknIds.join('')).to.equal(['T0000', 'T0006'].join(''))
		expect(callArgs.deadline).to.equal(txCallArgs.deadline)
		// Compare passed transaction parameters to unsigned ones
		expect(txRequest.to).to.equal(tradeTxRequest.to)
		expect(txRequest.nonce).to.equal(tradeTxRequest.nonce)
		expect(txRequest.value).to.equal(tradeTxRequest.value)
		expect(sender).to.equal(signer.address)
	})

	// it('New requests that reach over the pool capacity replace the oldest requests', async () => {
	// 	// Initialize arbbot
	// 	await arbbot.init(
	// 		ethers.provider, 
	// 		botOperator, 
	// 		ethers.utils.parseUnits('20', 'gwei'), 
	// 		null, 
	// 		mainnetProvider
	// 	)
	// 	// Create transaction for uniswap trade and sign it
	// 	let amountIn = ethers.utils.parseUnits('11')
	// 	let tipAmount = ethers.utils.parseUnits('0.0001')
	// 	let archerswapRouter = new ethers.Contract(
	// 		config.constants.routers.archerswap,
	// 		abis['archerswapRouter'] 
	// 	)
	// 	let nextNonce = await signer.getTransactionCount()
	// 	let tradeTxRequest = await archerswapRouter.populateTransaction['swapExactETHForTokensWithTipAmount'](
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
	// 	let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
	// 	await backrunner.handleNewBackrunRequest(signedTradeTxRequest)
	// 	// Give one try for this tx request - should find opportunity
	// 	await arbbot.backrunPendingRequests(0)

	// 	// Submit another tx request that will be above pool threshold
	// 	tradeTxRequest.nonce = nextNonce + 1  // Change it so the signed request will be different
	// 	let signedRequest2 = await signer.signTransaction(tradeTxRequest)
	// 	await backrunner.handleNewBackrunRequest(signedRequest2)
	// 	// Give one try for this tx request - should find opportunity
	// 	await arbbot.backrunPendingRequests(0)
	// 	expect(backrunner.getBackrunRequests().length).to.equal(2)

	// 	// Submit another tx request that above the threshold forcing the bot to toss one request
	// 	// First limit the pool to only two requests
	// 	config.settings.arb.maxRequestPoolSize = 2  
	// 	// Submit the request that will overflow the mempool
	// 	tradeTxRequest.nonce = nextNonce + 2  // Change it so the signed request will be different
	// 	let signedRequest3 = await signer.signTransaction(tradeTxRequest)
	// 	await backrunner.handleNewBackrunRequest(signedRequest3)
	// 	// The bot should toss out the transaction request with most tries and leave the second one in
	// 	let backrunRequests  = backrunner.getBackrunRequests()
	// 	expect(backrunRequests.length).to.equal(2)
	// 	expect(backrunRequests[0].signedRequest).to.equal(signedRequest2)
	// 	expect(backrunRequests[1].signedRequest).to.equal(signedRequest3)

	// })

})
