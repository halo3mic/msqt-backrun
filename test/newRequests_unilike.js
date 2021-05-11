require('./helpers/helpers').load()

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

	it('Uniswaplike signed tx with supported method should be decrypted', async () => {
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

	it('Uniswaplike signed tx with unsupported method should not be decrypted', async () => {
		// Create transaction for uniswap trade and sign it
		let UniswapRouter = new ethers.Contract(
			unilikeRouters.uniswap,
			abis['uniswapRouter'] 
		)
		let nextNonce = await signer.getTransactionCount()
		nextNonce = nextNonce==0 ? 1 : nextNonce
		let tradeTxRequest = await UniswapRouter.populateTransaction['addLiquidity'](
			assets.DAI, 
			assets.WETH, 
			ethers.utils.parseUnits('1'), 
			ethers.utils.parseUnits('3500'), 
			ZERO, 
			ZERO, 
			signer.address, 
			parseInt(Date.now()/1e3)+300
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
		let signedTradeTxRequest = await signer.signTransaction(tradeTxRequest)
		backrunner.handleNewBackrunRequest(signedTradeTxRequest)
		let backrunRequests = backrunner.getBackrunRequests()
		expect(backrunRequests.length).to.equal(1)
		let { callArgs, txRequest, sender } = backrunRequests[0]
		// Compare passed call arguments to decrypted ones
		expect(callArgs.amountIn).to.equal(txCallArgs.amountIn)
		expect(callArgs.amountOut).to.equal(txCallArgs.amountOutMin)
		expect(callArgs.tknPath.join('')).to.equal(['T0000', 'T0006'].join(''))
		expect(callArgs.deadline).to.equal(txCallArgs.deadline)
		// Compare passed transaction parameters to unsigned ones
		expect(txRequest.to).to.equal(tradeTxRequest.to)
		expect(txRequest.nonce).to.equal(tradeTxRequest.nonce)
		expect(txRequest.value).to.equal(tradeTxRequest.value)
		expect(sender).to.equal(signer.address)
	})

})