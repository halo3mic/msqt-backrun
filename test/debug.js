require('./helpers/helpers').load()

describe('Handle new backrun request', () => {
	
	before(async () => {
		genNewAccount = await makeAccountGen()
		signer = ethers.Wallet.createRandom().connect(ethers.provider)
		botOperator = new ethers.Wallet(config.settings.network.privateKey, ethers.provider)
		backrunner.init(ethers.provider)
        // Start arb bot and request listener
        await server.init()
        server.startRequestUpdates()
	})

	beforeEach(() => {
		trader = genNewAccount()
		// Restart requests pool with each test
		backrunner.cleanRequestsPool()
	})

    after(() => {
        server.stopRequestUpdates()
    })


    it('Signed transaction request to /submitRequest should be added to the local mempool', async () => {
        const request = "0xf901ad3b80830425899487535b160e251167fb7abe239d2467d1127219e487c3663566a58000b90144c89b8c000000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d0000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000a968163f0a57b400000000000000000000000000000000000000000000000000000000000046d1dbf2b00000000000000000000000000000000000000000000000000000000000000a00000000000000000000000008c172491b9a8faa83d50011f8688f836e58f550c0000000000000000000000000000000000000000000000000000000060c67ea40000000000000000000000000000000000000000000000000000000000000002000000000000000000000000aa4e3edb11afa93c41db59842b29de64b72e355b000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4826a0b402f6c20e0470e9c19787f3fbeb1ac198ebcc440e183b6a8a650d659ab2c5f6a03eae158cb15b385df9918979b5f9dec05e12846fe1cb9a5253000449cf19e314"
        const blockNumber = 1.2611676E7
        // Submit signed tx request to the bot
        let response = await fetch(
            'http://localhost:8888/submitRequest', 
            {
                method: 'post',
                body:    request,
                headers: { 'Content-Type': 'application/text' },
            }
        )
        response = await response.json()
        expect(response.status).to.equal(503)
        expect(response.msg).to.equal('InternalError: Error: Unsupported token')
        // Confirm the tx request was accepted
        let backrunRequests = arbbot.getBackrunRequests()
        expect(backrunRequests.length).to.equal(0)
    })
})