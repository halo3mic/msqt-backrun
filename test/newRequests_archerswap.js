require('./helpers/helpers').load()
const relaySimulator = require('./helpers/relaySimulator')
const { provider: mainnetProvider } = require('../src/provider').ws

describe('Handle new backrun request', () => {
	
	before(async () => {
		genNewAccount = await makeAccountGen()
		signer = ethers.Wallet.createRandom().connect(ethers.provider)
		botOperator = new ethers.Wallet(config.settings.network.privateKey, ethers.provider)
		backrunner.init(ethers.provider)
		const startGasPrice = ethers.utils.parseUnits('20', 'gwei')
		const whitelistedPaths = null
		const providerForInitialReserves = mainnetProvider

		// Send bundles to local relay simulator
		config.constants.archerBundleEndpoint = 'http://localhost:8777/sendBundle'
		relaySimulator.startListening(ethers.provider)
		relaySimulator.pauseRelay()
		await arbbot.init(
			ethers.provider, 
			botOperator, 
			startGasPrice, 
			whitelistedPaths, 
			providerForInitialReserves
		)
	})

	beforeEach(() => {
		trader = genNewAccount()
		// Restart requests pool with each test
		backrunner.cleanRequestsPool()
		relaySimulator.clear()
	})

	after(() => {
		relaySimulator.unpauseRelay()
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

	it('New request should be submitted to relay if in block submission window', async () => {
		// Fill signer account
		bank = genNewAccount() 
		await bank.sendTransaction({
			value: ethers.utils.parseEther('1000'),
			to: signer.address, 
		}).then(async txRequest => txRequest.wait())
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
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest1)
		await arbbot.handleNewBackrunRequest({
			rawTxRequest: signedTradeTxRequest, 
			lastBlockUpdate: Date.now(),
			blockHeight: 0
		})
		await utils.sleep(1000)
		// Expect that there is a profitable tx submitted to the relay
		const recivedBundles = relaySimulator.getRecivedBundles()
		expect(recivedBundles.length).to.equal(1)
		expect(recivedBundles[0][0]).to.equal(signedTradeTxRequest)
		const dispatcherBalBefore = await ethers.provider.getBalance(
			config.constants.dispatcher
		)
		await relaySimulator.simulateBundle(recivedBundles[0])
		const dispatcherBalAfter = await ethers.provider.getBalance(
			config.constants.dispatcher
		)
		expect(dispatcherBalAfter).to.gt(dispatcherBalBefore)
		// Expect the trade to be added to the local mempool
		let backrunRequests = backrunner.getBackrunRequests()
		expect(backrunRequests.length).to.equal(1)
	})

	it('New request should not be submitted to relay if outside block submission window', async () => {
		// Fill signer account
		bank = genNewAccount() 
		await bank.sendTransaction({
			value: ethers.utils.parseEther('1000'),
			to: signer.address, 
		}).then(async txRequest => txRequest.wait())
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
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest1)
		const updateTimestamp = Date.now()+config.settings.submissionWindow+1
		await arbbot.handleNewBackrunRequest({
			rawTxRequest: signedTradeTxRequest, 
			lastBlockUpdate: updateTimestamp,
			blockHeight: 0
		})
		await utils.sleep(1000)
		// Expect that the tx request was not submitted 
		const recivedBundles = relaySimulator.getRecivedBundles()
		expect(recivedBundles.length).to.equal(0)
		// Expect that the tx request was added to the mempool
		let backrunRequests = backrunner.getBackrunRequests()
		expect(backrunRequests.length).to.equal(1)
	})

	
})
