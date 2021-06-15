require('./helpers/helpers').load()
const relaySimulator = require('./helpers/relaySimulator')
const { formatUnits, parseUnits } = ethers.utils
const providers = require('../src/provider')

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
		
		
		backrunner.init(ethers.provider)  // Set a provider
		// Init the bot and start the listeners
        // ! NOTE: uses live mainnet provider and real signer
        await arbbot.init(ethers.provider, providers.ws.signer, parseUnits('100', 'gwei'), null, providers.ws.provider, [])
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

	// it('Estimated profit should match past execution: 10 WETH -(Sushiswap)-> ARCH', async () => {
    //     // Arb tx info
    //     let txHash = '0xe7166926282543ca2154c67c78796ec9813177773bc3cf574504c7f8434336c6' // Arb tx
    //     let pastTx = await ethers.provider.getTransaction(txHash)
    //     let pastBlock = await ethers.provider.getBlock(pastTx.blockNumber)
    //     // Trade settings
    //     let amountIn = ethers.utils.parseUnits('10')
	// 	let amountOutMin = ethers.utils.parseUnits('0')
    //     let tknPath = [ assets.WETH, assets.ARCH ]
	// 	let exchange = 'sushiswap'

	// 	// Estimate the profit 
	// 	let estimatedProfit = await arbbot.estimateProfitForTrade(
    //         amountIn, 
    //         amountOutMin, 
    //         tknPath, 
    //         exchange, 
    //         pastTx.blockNumber-1
    //     )
    //     console.log(`Estimated profit: ${formatUnits(estimatedProfit)} ETH`)
    //     // Get the real profit
    //     let internalTxs = await getInternalTxsForTx(txHash)
    //     let fromDispatcher = ethers.BigNumber.from(
    //         internalTxs.find(tx => tx.from==config.constants.dispatcher.toLowerCase()).value
    //     )
    //     let toDispatcher = ethers.BigNumber.from(
    //         internalTxs.find(tx => tx.to==config.constants.dispatcher.toLowerCase()).value
    //     )
    //     let toMiner = ethers.BigNumber.from(
    //         internalTxs.find(tx => tx.to==pastBlock.miner.toLowerCase()).value
    //     )
    //     let executedProfit = toDispatcher.sub(fromDispatcher).add(toMiner)
    //     console.log(`Executed profit: ${formatUnits(executedProfit)} ETH`)
    //     expect(executedProfit).to.be.closeTo(estimatedProfit, parseUnits('0.00001'))
	// }).timeout(1000000)

    // // NOTE: This doesnt match 
    // // it('Estimated profit should match past execution: 12623 ARCH -(Sushiswap)-> WETH', async () => {
    // //     // Arb tx info
    // //     let txHash = '0x7ed5747d5da7c73dbbd006d137fbf070214da5b97dfdcbda537fbed9d4b55c1f' // Arb tx
    // //     let pastTx = await ethers.provider.getTransaction(txHash)
    // //     let pastBlock = await ethers.provider.getBlock(pastTx.blockNumber)
    // //     // Trade settings
    // //     let amountIn = ethers.utils.parseUnits('12622.519894')
	// // 	let amountOutMin = ethers.utils.parseUnits('0')
    // //     let tknPath = [ assets.ARCH, assets.WETH ]
	// // 	let exchange = 'sushiswap'

	// // 	// Estimate the profit 
	// // 	let estimatedProfit = await arbbot.estimateProfitForTrade(
    // //         amountIn, 
    // //         amountOutMin, 
    // //         tknPath, 
    // //         exchange, 
    // //         pastTx.blockNumber-1
    // //     )
    // //     console.log(`Estimated profit: ${formatUnits(estimatedProfit)} ETH`)
    // //     // Get the real profit
    // //     let internalTxs = await getInternalTxsForTx(txHash)
    // //     let fromDispatcher = ethers.BigNumber.from(
    // //         internalTxs.find(tx => tx.from==config.constants.dispatcher.toLowerCase()).value
    // //     )
    // //     let toDispatcher = ethers.BigNumber.from(
    // //         internalTxs.find(tx => tx.to==config.constants.dispatcher.toLowerCase()).value
    // //     )
    // //     let toMiner = ethers.BigNumber.from(
    // //         internalTxs.find(tx => tx.to==pastBlock.miner.toLowerCase()).value
    // //     )
    // //     let executedProfit = toDispatcher.sub(fromDispatcher).add(toMiner)
    // //     console.log(`Executed profit: ${formatUnits(executedProfit)} ETH`)
    // //     expect(executedProfit).to.be.closeTo(estimatedProfit, parseUnits('0.00001'))
	// // }).timeout(1000000)

    // it('Estimated profit should match past execution: 1.5 WETH -(Sushiswap)-> SUPER', async () => {
    //     // Arb tx info
    //     let txHash = '0xdc1b605e53601c4d8f18b6b729ae78d107125dedd8f7e5cbb25f21e3ec9ac414' // Arb tx
    //     let pastTx = await ethers.provider.getTransaction(txHash)
    //     let pastBlock = await ethers.provider.getBlock(pastTx.blockNumber)
    //     // Trade settings
    //     let amountIn = ethers.utils.parseUnits('1.5')
	// 	let amountOutMin = ethers.utils.parseUnits('0')
    //     let tknPath = [ assets.WETH, assets.SUPER ]
	// 	let exchange = 'sushiswap'

	// 	// Estimate the profit 
	// 	let estimatedProfit = await arbbot.estimateProfitForTrade(
    //         amountIn, 
    //         amountOutMin, 
    //         tknPath, 
    //         exchange, 
    //         pastTx.blockNumber-1
    //     )
    //     console.log(`Estimated profit: ${formatUnits(estimatedProfit)} ETH`)
    //     // Get the real profit
    //     let internalTxs = await getInternalTxsForTx(txHash)
    //     let fromDispatcher = ethers.BigNumber.from(
    //         internalTxs.find(tx => tx.from==config.constants.dispatcher.toLowerCase()).value
    //     )
    //     let toDispatcher = ethers.BigNumber.from(
    //         internalTxs.find(tx => tx.to==config.constants.dispatcher.toLowerCase()).value
    //     )
    //     let toMiner = ethers.BigNumber.from(
    //         internalTxs.find(tx => tx.to==pastBlock.miner.toLowerCase()).value
    //     )
    //     let executedProfit = toDispatcher.sub(fromDispatcher).add(toMiner)
    //     console.log(`Executed profit: ${formatUnits(executedProfit)} ETH`)
    //     expect(executedProfit).to.be.closeTo(estimatedProfit, parseUnits('0.00001'))
	// }).timeout(1000000)

    // it('Estimated profit should match past execution: 3330 SUPER -(Sushiswap)-> WETH', async () => {
    //     // Arb tx info
    //     let txHash = '0x0c4b1dc384666c33f2e38c618c561531aba8b818eca4e45d18af6a3956883b70' // Arb tx
    //     let pastTx = await ethers.provider.getTransaction(txHash)
    //     let pastBlock = await ethers.provider.getBlock(pastTx.blockNumber)
    //     // Trade settings
    //     let amountIn = ethers.utils.parseUnits('3330.33')
	// 	let amountOutMin = ethers.utils.parseUnits('0')
    //     let tknPath = [ assets.SUPER, assets.WETH ]
	// 	let exchange = 'sushiswap'

	// 	// Estimate the profit 
	// 	let estimatedProfit = await arbbot.estimateProfitForTrade(
    //         amountIn, 
    //         amountOutMin, 
    //         tknPath, 
    //         exchange, 
    //         pastTx.blockNumber-1
    //     )
    //     console.log(`Estimated profit: ${formatUnits(estimatedProfit)} ETH`)
    //     // Get the real profit
    //     let internalTxs = await getInternalTxsForTx(txHash)
    //     let fromDispatcher = ethers.BigNumber.from(
    //         internalTxs.find(tx => tx.from==config.constants.dispatcher.toLowerCase()).value
    //     )
    //     let toDispatcher = ethers.BigNumber.from(
    //         internalTxs.find(tx => tx.to==config.constants.dispatcher.toLowerCase()).value
    //     )
    //     let toMiner = ethers.BigNumber.from(
    //         internalTxs.find(tx => tx.to==pastBlock.miner.toLowerCase()).value
    //     )
    //     let executedProfit = toDispatcher.sub(fromDispatcher).add(toMiner)
    //     console.log(`Executed profit: ${formatUnits(executedProfit)} ETH`)
    //     expect(executedProfit).to.be.closeTo(estimatedProfit, parseUnits('0.00001'))
	// }).timeout(1000000)

    it('', async () => {
        // Arb tx info
        // let txHash = '0x0c4b1dc384666c33f2e38c618c561531aba8b818eca4e45d18af6a3956883b70' // Arb tx
        // let pastTx = await ethers.provider.getTransaction(txHash)
        // let pastBlock = await ethers.provider.getBlock(pastTx.blockNumber)
        // Trade settings
        let amountIn = ethers.utils.parseUnits('2000000', 6)
		let amountOutMin = ethers.utils.parseUnits('0')
        let tknPath = [ assets.USDC, assets.WETH, assets.SUSHI ]
		let exchange = 'sushiswap'

		// Estimate the profit 
		let estimatedProfit = await arbbot.estimateProfitForTrade(
            amountIn, 
            amountOutMin, 
            tknPath, 
            exchange, 
            12470638-1
        )
        console.log(`Estimated profit: ${formatUnits(estimatedProfit)} ETH`)
        // Get the real profit
        // let internalTxs = await getInternalTxsForTx(txHash)
        // let fromDispatcher = ethers.BigNumber.from(
        //     internalTxs.find(tx => tx.from==config.constants.dispatcher.toLowerCase()).value
        // )
        // let toDispatcher = ethers.BigNumber.from(
        //     internalTxs.find(tx => tx.to==config.constants.dispatcher.toLowerCase()).value
        // )
        // let toMiner = ethers.BigNumber.from(
        //     internalTxs.find(tx => tx.to==pastBlock.miner.toLowerCase()).value
        // )
        // let executedProfit = toDispatcher.sub(fromDispatcher).add(toMiner)
        // console.log(`Executed profit: ${formatUnits(executedProfit)} ETH`)
        // expect(executedProfit).to.be.closeTo(estimatedProfit, parseUnits('0.00001'))
	}).timeout(1000000)

})
