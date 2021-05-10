require('./helpers/helpers').load()

describe('Virtual reserves', () => {

	let genNewAccount, botOperator, signer
	
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
		// Restart backrunner for each request
		backrunner.init(ethers.provider)  // Set a provider
		backrunner.cleanRequestsPool()
	})

	it('New request increases virtual reserves (one pool)', async () => {
		// Create transaction for uniswap trade and sign it
		let txCallArgs = {
			amountIn: ethers.utils.parseEther('10'),
			amountOut: ethers.utils.parseUnits('3000'),
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
		let tradeTxRequest = await UniswapRouter.populateTransaction[txCallArgs.method](
			txCallArgs.amountOut, 
			txCallArgs.tknPath, 
			signer.address,
			txCallArgs.deadline, 
			{ 
				gasPrice: ZERO, 
				value: txCallArgs.amountIn, 
				nonce: nextNonce, 
				gasLimit: 300000, 
				from: signer.address
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Handle new request
		backrunner.handleNewBackrunRequest(signedTradeTxRequest)
		// Check that request was put in backrun requests pool
		let [ backrunRequest ] = backrunner.getBackrunRequests()
		let { callArgs } = backrunRequest
		let dummyReserves = {
			'P0009': {
				'T0006': ethers.utils.parseUnits('3000000'), 
				'T0000': ethers.utils.parseUnits('1000')
			}
		}
		let { virtualReserves, amountOut } = backrunner.getVirtualReserves(
			dummyReserves, 
			callArgs
		)
		// Check that original reserves werent affected
		expect(dummyReserves['P0009']['T0006']).to.equal(ethers.utils.parseUnits('3000000'))
		expect(dummyReserves['P0009']['T0000']).to.equal(ethers.utils.parseUnits('1000'))
		// Check that virtual reserves match the simualted trade
		expect(virtualReserves['P0009']['T0006']).to.equal(
			dummyReserves['P0009']['T0006'].sub(amountOut)
		)
		expect(virtualReserves['P0009']['T0000']).to.equal(
			dummyReserves['P0009']['T0000'].add(txCallArgs.amountIn)
		)
	})

	it('New request increases virtual reserves (two pools)', async () => {
		// Create transaction for uniswap trade and sign it
		let txCallArgs = {
			amountIn: ethers.utils.parseEther('10'),
			amountOut: ethers.utils.parseUnits('3000'),
			method: 'swapExactETHForTokens',
			tknPath: [ assets.WETH, assets.DAI, assets.USDC ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+300
		}
		let UniswapRouter = new ethers.Contract(
			txCallArgs.router,
			abis['uniswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
		let tradeTxRequest = await UniswapRouter.populateTransaction[txCallArgs.method](
			txCallArgs.amountOut, 
			txCallArgs.tknPath, 
			signer.address,
			txCallArgs.deadline, 
			{ 
				gasPrice: ZERO, 
				value: txCallArgs.amountIn, 
				nonce: nextNonce, 
				gasLimit: 300000, 
				from: signer.address
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Handle new request
		backrunner.handleNewBackrunRequest(signedTradeTxRequest)
		// Check that request was put in backrun requests pool
		let [ backrunRequest ] = backrunner.getBackrunRequests()
		let { callArgs } = backrunRequest
		let dummyReserves = {
			'P0009': {
				'T0006': ethers.utils.parseUnits('3000000'), 
				'T0000': ethers.utils.parseUnits('2000')
			},
			'P00249': {
				'T0006': ethers.utils.parseUnits('1000000'), 
				'T0003': ethers.utils.parseUnits('1000100')
			}
		}
		let { virtualReserves, amountOut } = backrunner.getVirtualReserves(
			dummyReserves, 
			callArgs
		)
		// Check that original reserves werent affected
		expect(dummyReserves['P0009']['T0006']).to.equal(ethers.utils.parseUnits('3000000'))
		expect(dummyReserves['P0009']['T0000']).to.equal(ethers.utils.parseUnits('2000'))
		expect(dummyReserves['P00249']['T0006']).to.equal(ethers.utils.parseUnits('1000000'))
		expect(dummyReserves['P00249']['T0003']).to.equal(ethers.utils.parseUnits('1000100'))
		// Check that virtual reserves match the simulated trade
		expect(virtualReserves['P0009']['T0000']).to.equal(
			dummyReserves['P0009']['T0000'].add(txCallArgs.amountIn)
		)
		expect(virtualReserves['P00249']['T0003']).to.equal(
			dummyReserves['P00249']['T0003'].sub(amountOut)
		)
		// Check that inner pools match
		let pool1DiffTkn2 = dummyReserves['P0009']['T0006'].sub(virtualReserves['P0009']['T0006'])
		let pool2DiffTkn2 = virtualReserves['P00249']['T0006'].sub(dummyReserves['P00249']['T0006'])
		expect(pool1DiffTkn2).to.equal(pool2DiffTkn2)
	})

	it('Virutal reserves match the state of the pool after the execution', async () => {
		// Create transaction for uniswap trade and sign it
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
		let tradeTxRequest = await UniswapRouter.populateTransaction[txCallArgs.method](
			txCallArgs.amountOut, 
			txCallArgs.tknPath, 
			signer.address,
			txCallArgs.deadline, 
			{ 
				gasPrice: ZERO, 
				value: txCallArgs.amountIn, 
				nonce: nextNonce, 
				gasLimit: 300000, 
				from: signer.address
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Handle new request
		backrunner.handleNewBackrunRequest(signedTradeTxRequest)
		// Check that request was put in backrun requests pool
		let backrunRequests = backrunner.getBackrunRequests()
		expect(backrunRequests.length).to.equal(1)
		let pathsToCheck = [ 'I000311', 'I001605' ].map(
			instrMng.getPathById
		)
		await arbbot.init(
			ethers.provider, 
			signer, 
			ethers.utils.parseUnits('20', 'gwei'), 
			pathsToCheck
		)
		// Get virtual reserves
		let { virtualReserves } = backrunner.getVirtualReserves(
			arbbot.getReserves(), 
			backrunRequests[0].callArgs
		)
		// Execute transaction
		await signer.sendTransaction(tradeTxRequest).then(
			async response => response.wait()
		)
		let poolAffected = instrMng.getPoolById('P0009')
		// Compare reserves after execution to the prediction
		let newReserves = await reservesMng.fetchReserves(poolAffected).then(
			r => Object.fromEntries([r])
		)
		expect(newReserves['P0009']['T0000']).to.equal(
			virtualReserves['P0009']['T0000']
		)
		expect(newReserves['P0009']['T0006']).to.equal(
			virtualReserves['P0009']['T0006']
		)
	})

	it('Bot should find same or more opps with virtual reserves (local)', async () => {
		// Create transaction for uniswap trade and sign it
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
		let tradeTxRequest = await UniswapRouter.populateTransaction[txCallArgs.method](
			txCallArgs.amountOut, 
			txCallArgs.tknPath, 
			signer.address,
			txCallArgs.deadline, 
			{ 
				gasPrice: ZERO, 
				value: txCallArgs.amountIn, 
				nonce: nextNonce, 
				gasLimit: 300000, 
				from: signer.address
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Handle new request
		backrunner.handleNewBackrunRequest(signedTradeTxRequest)
		// Check that request was put in backrun requests pool
		let backrunRequests = backrunner.getBackrunRequests()
		expect(backrunRequests.length).to.equal(1)
		// Set dummy reserves
		let dummyReserves = {
			'P0009': {
				'T0006': ethers.utils.parseUnits('3000000'), 
				'T0000': ethers.utils.parseUnits('2000')
			},
			'P00249': {
				'T0006': ethers.utils.parseUnits('1000000'), 
				'T0003': ethers.utils.parseUnits('1000100')
			},
			'P0003': {
				'T0000': ethers.utils.parseUnits('4000'), 
				'T0003': ethers.utils.parseUnits('6000000')
			},
		}
		arbbot._setReserves(dummyReserves)
		arbbot.updateBotBal(ethers.utils.parseUnits('100'))
		arbbot.updateGasPrice(ethers.utils.parseUnits('20', 'gwei'))
		let pathsToCheck = [ 'I000311', 'I001605' ].map(
			instrMng.getPathById
		)
		let { virtualReserves } = backrunner.getVirtualReserves(
			dummyReserves, 
			backrunRequests[0].callArgs
		)
		let oppsWithVirtualReserves = arbbot.getOppsForVirtualReserves(pathsToCheck, virtualReserves)
		let oppsWithoutVirtualReserves = arbbot.getOppsForVirtualReserves(pathsToCheck, {})
		expect(oppsWithVirtualReserves.length).to.gte(oppsWithoutVirtualReserves.length)
	})

	it('Handle block update (live)', async () => {
		// Create transaction for uniswap trade and sign it
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
		let tradeTxRequest = await UniswapRouter.populateTransaction[txCallArgs.method](
			txCallArgs.amountOut, 
			txCallArgs.tknPath, 
			signer.address,
			txCallArgs.deadline, 
			{ 
				gasPrice: ZERO, 
				value: txCallArgs.amountIn, 
				nonce: nextNonce, 
				gasLimit: 300000, 
				from: signer.address
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Handle new request
		backrunner.handleNewBackrunRequest(signedTradeTxRequest)
		// Check that request was put in backrun requests pool
		let backrunRequests = backrunner.getBackrunRequests()
		expect(backrunRequests.length).to.equal(1)
		let pathsToCheck = [ 'I000311', 'I001605' ].map(
			instrMng.getPathById
		)
		await arbbot.init(
			ethers.provider, 
			signer, 
			ethers.utils.parseUnits('20', 'gwei'), 
			pathsToCheck
		)
		let blockNumber = await ethers.provider.getBlockNumber()
		expect(()=>arbbot.handleBlockUpdate(blockNumber)).to.not.throw()
	})

	it('Handle block update for multiple requests (live)', async () => {
		// Create transaction for uniswap trade and sign it
		let UniswapRouter = new ethers.Contract(
			unilikeRouters.uniswap,
			abis['uniswapRouter'] 
		)
		let tradeTxRequest1 = await UniswapRouter.populateTransaction['swapExactETHForTokens'](
			ZERO, 
			[ assets.WETH, assets.DAI, assets.USDC ], 
			signer.address,
			parseInt(Date.now()/1e3)+300, 
			{ value: ethers.utils.parseEther('1000') }
		)
		let SushiswapRouter = new ethers.Contract(
			unilikeRouters.sushiswap,
			abis['uniswapRouter'] 
		)
		let tradeTxRequest2 = await SushiswapRouter.populateTransaction['swapExactETHForTokens'](
			ZERO, 
			[ assets.WETH, assets.USDC ], 
			signer.address,
			parseInt(Date.now()/1e3)+300, 
			{ value: ethers.utils.parseEther('1000') }
		)
		let signedTradeTxRequest1 = await signer.signTransaction(tradeTxRequest1)
		let signedTradeTxRequest2 = await signer.signTransaction(tradeTxRequest2)
		// Handle new request
		backrunner.handleNewBackrunRequest(signedTradeTxRequest1)
		backrunner.handleNewBackrunRequest(signedTradeTxRequest2)
		// Check that request was put in backrun requests pool
		let backrunRequests = backrunner.getBackrunRequests()
		expect(backrunRequests.length).to.equal(2)
		let pathsToCheck = [ 'I000311', 'I001605', 'I000092' ].map(
			instrMng.getPathById
		)
		await arbbot.init(
			ethers.provider, 
			signer, 
			ethers.utils.parseUnits('20', 'gwei'), 
			pathsToCheck
		)
		let blockNumber = await ethers.provider.getBlockNumber()
		expect(()=>arbbot.handleBlockUpdate(blockNumber)).to.not.throw()
	})
})