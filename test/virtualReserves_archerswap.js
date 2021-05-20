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
		// Handle new request
		await backrunner.handleNewBackrunRequest(signedTradeTxRequest)
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
			amountIn: ethers.utils.parseEther('100'),
			amountOut: ZERO,
			method: 'swapExactETHForTokensWithTipAmount',
			tknPath: [ assets.WETH, assets.DAI, assets.USDC ],
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
		// Handle new request
		await backrunner.handleNewBackrunRequest(signedTradeTxRequest)
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

	it('Virutal reserves match the state of the pool after the execution - ETH tip from input amount', async () => {
		// Create transaction for uniswap trade and sign it
		let txCallArgs = {
			amountIn: ethers.utils.parseEther('10'),
			amountOut: ZERO,
			method: 'swapExactETHForTokensWithTipAmount',
			tknPath: [ assets.WETH, assets.DAI ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+3000, 
			tipAmount: ethers.utils.parseUnits('0.1')
		}
		let archerswapRouter = new ethers.Contract(
			config.constants.routers.archerswap,
			abis['archerswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
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
				value: txCallArgs.amountIn.add(txCallArgs.tipAmount), 
				nonce: nextNonce, 
				gasLimit: 1000000
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Handle new request
		await backrunner.handleNewBackrunRequest(signedTradeTxRequest)
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

	it('Virutal reserves match the state of the pool after the execution - ETH tip not from input amount', async () => {
		// Create transaction for uniswap trade and sign it
		let txCallArgs = {
			amountIn: ethers.utils.parseEther('10'),
			amountOut: ZERO,
			method: 'swapExactTokensForTokensWithTipAmount',
			tknPath: [ assets.WETH, assets.DAI ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+3000, 
			tipAmount: ethers.utils.parseUnits('0.1')
		}
		// Prepare for trade - wrap eth; approve weth (execute before checking the nonce)
		let WETH = new ethers.Contract(assets.WETH, config.abis['weth'], ethers.provider)
		await WETH.connect(signer).deposit({value: txCallArgs.amountIn, gasPrice: ZERO})
		expect(await WETH.balanceOf(signer.address)).to.equal(txCallArgs.amountIn)
		await WETH.connect(signer).approve(config.constants.routers.archerswap, ethers.constants.MaxUint256)
		expect(await WETH.allowance(signer.address, config.constants.routers.archerswap)).to.equal(ethers.constants.MaxUint256)
		let archerswapRouter = new ethers.Contract(
			config.constants.routers.archerswap,
			abis['archerswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
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
				value: txCallArgs.tipAmount, 
				nonce: nextNonce, 
				gasLimit: 1000000
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Handle new request
		await backrunner.handleNewBackrunRequest(signedTradeTxRequest)
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

	})

	it('Virutal reserves match the state of the pool after the execution - Token tip from output amount (non-trade pool)', async () => {
		// Trade gets through pools WETH-DAI & DAI-USDC and tip gets taken from pool WETH-USDC

		// Create transaction for uniswap trade and sign it
		let txCallArgs = {
			amountIn: ethers.utils.parseEther('10'),
			amountOut: ZERO,
			method: 'swapExactTokensForTokensWithTipPct',
			tknPath: [ assets.WETH, assets.DAI, assets.USDC ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+3000, 
			tipPct: (0.5*1000000).toString(),
			pathToEth: [ assets.USDC, assets.WETH ],
			minEth: ZERO
		}
		// Prepare for trade - wrap eth; approve weth (execute before checking the nonce)
		let WETH = new ethers.Contract(assets.WETH, config.abis['weth'], ethers.provider)
		await expect(() => WETH.connect(signer).deposit({value: txCallArgs.amountIn, gasPrice: ZERO}))
  			.to.changeTokenBalance(WETH, signer, txCallArgs.amountIn)
		await WETH.connect(signer).approve(config.constants.routers.archerswap, ethers.constants.MaxUint256)
		expect(await WETH.allowance(signer.address, config.constants.routers.archerswap)).to.equal(ethers.constants.MaxUint256)
		let archerswapRouter = new ethers.Contract(
			config.constants.routers.archerswap,
			abis['archerswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
		let tradeTxRequest = await archerswapRouter.populateTransaction[txCallArgs.method](
			txCallArgs.router,
			[
				txCallArgs.amountIn,
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
			],
			txCallArgs.pathToEth,
			txCallArgs.minEth,
			txCallArgs.tipPct,
			{ 
				gasPrice: ZERO, 
				value: txCallArgs.tipAmount, 
				nonce: nextNonce, 
				gasLimit: 1000000
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Handle new request
		await backrunner.handleNewBackrunRequest(signedTradeTxRequest)
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

	it('Virutal reserves dont1`t match the state of the pool after the execution - Token tip from output amount (trade pool)', async () => {
		// Trade gets through pools WETH-DAI and tip gets taken through the same pool
		
		// Create transaction for uniswap trade and sign it
		let txCallArgs = {
			amountIn: ethers.utils.parseEther('10'),
			amountOut: ZERO,
			method: 'swapExactTokensForTokensWithTipPct',
			tknPath: [ assets.WETH, assets.DAI ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+3000, 
			tipPct: (0.5*1e6).toString(),
			pathToEth: [ assets.DAI, assets.WETH ],
			minEth: ZERO
		}
		// Prepare for trade - wrap eth; approve weth (execute before checking the nonce)
		let WETH = new ethers.Contract(assets.WETH, config.abis['weth'], ethers.provider)
		await expect(() => WETH.connect(signer).deposit({value: txCallArgs.amountIn, gasPrice: ZERO}))
  			.to.changeTokenBalance(WETH, signer, txCallArgs.amountIn)
		await WETH.connect(signer).approve(config.constants.routers.archerswap, ethers.constants.MaxUint256)
		expect(await WETH.allowance(signer.address, config.constants.routers.archerswap)).to.equal(ethers.constants.MaxUint256)
		let archerswapRouter = new ethers.Contract(
			config.constants.routers.archerswap,
			abis['archerswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
		let tradeTxRequest = await archerswapRouter.populateTransaction[txCallArgs.method](
			txCallArgs.router,
			[
				txCallArgs.amountIn,
				txCallArgs.amountOut, 
				txCallArgs.tknPath, 
				signer.address,
				txCallArgs.deadline, 
			],
			txCallArgs.pathToEth,
			txCallArgs.minEth,
			txCallArgs.tipPct,
			{ 
				gasPrice: ZERO, 
				value: txCallArgs.tipAmount, 
				nonce: nextNonce, 
				gasLimit: 1000000
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Handle new request
		await backrunner.handleNewBackrunRequest(signedTradeTxRequest)
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
		let { virtualReserves, amountOut } = backrunner.getVirtualReserves(
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
		expect(newReserves['P0009']['T0000']).to.not.equal(
			virtualReserves['P0009']['T0000']
		)
		expect(newReserves['P0009']['T0006']).to.not.equal(
			virtualReserves['P0009']['T0006']
		)
	})

	it('Bot should find same or more opps with virtual reserves (local)', async () => {
		// Create transaction for uniswap trade and sign it
		let txCallArgs = {
			amountIn: ethers.utils.parseEther('10'),
			amountOut: ZERO,
			method: 'swapExactETHForTokensWithTipAmount',
			tknPath: [ assets.WETH, assets.DAI ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+3000, 
			tipAmount: ethers.utils.parseUnits('0.1')
		}
		let archerswapRouter = new ethers.Contract(
			config.constants.routers.archerswap,
			abis['archerswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
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
				value: txCallArgs.amountIn.add(txCallArgs.tipAmount), 
				nonce: nextNonce, 
				gasLimit: 1000000
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Handle new request
		await backrunner.handleNewBackrunRequest(signedTradeTxRequest)
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
			amountIn: ethers.utils.parseEther('10'),
			amountOut: ZERO,
			method: 'swapExactETHForTokensWithTipAmount',
			tknPath: [ assets.WETH, assets.DAI ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+3000, 
			tipAmount: ethers.utils.parseUnits('0.1')
		}
		let archerswapRouter = new ethers.Contract(
			config.constants.routers.archerswap,
			abis['archerswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
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
				value: txCallArgs.amountIn.add(txCallArgs.tipAmount), 
				nonce: nextNonce, 
				gasLimit: 1000000
			}
		)
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		// Handle new request
		await backrunner.handleNewBackrunRequest(signedTradeTxRequest)
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
		let amountIn
		let tipAmount = ethers.utils.parseUnits('0.1')
		// Uniswap trade
		amountIn = ethers.utils.parseUnits('1000')
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
				[ assets.WETH, assets.DAI, assets.USDC ], 
				signer.address,
				parseInt(Date.now()/1e3)+3000, 
			],
			tipAmount, 
			{ value: amountIn.add(tipAmount), nonce: nextNonce }
		)
		// Sushiswap trade
		amountIn = ethers.utils.parseUnits('2000')
		let tradeTxRequest2 = await archerswapRouter.populateTransaction['swapExactETHForTokensWithTipAmount'](
			unilikeRouters.sushiswap,
			[
				amountIn,
				ZERO, 
				[ assets.WETH, assets.USDC ], 
				signer.address,
				parseInt(Date.now()/1e3)+3000, 
			],
			tipAmount, 
			{ value: amountIn.add(tipAmount), nonce: nextNonce+1 }
		)
		let signedTradeTxRequest1 = await signer.signTransaction(tradeTxRequest1)
		let signedTradeTxRequest2 = await signer.signTransaction(tradeTxRequest2)
		// Handle new request
		await backrunner.handleNewBackrunRequest(signedTradeTxRequest1)
		await backrunner.handleNewBackrunRequest(signedTradeTxRequest2)
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