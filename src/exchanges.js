let instrMng = require('./instrManager')
const config = require('./config')
const ethers = require('ethers')

class Uniswap {

    constructor(provider) {
        this.provider = provider
        this.key = 'uniswap'
        this.routerAddress = config.constants.routers[this.key]
        this.routerContract = new ethers.Contract(
            this.routerAddress, 
            config.abis['uniswapRouter']
        )
    }

    async fetchReservesRaw(poolAddress) {
        const poolContract = new ethers.Contract(
            poolAddress, 
            config.abis['uniswapPool'], 
            this.provider
        )
        return await poolContract.getReserves()
    }

    async fetchReserves(pool) {
        const reserves = {}
        const reservesRaw = this.fetchReservesRaw(pool.address)
        const tkn1Dec = instrMng.getTokenById(pool.tkns[0].id).decimal
        reserves[pool.tkns[0].id] = {
            balance: await reservesRaw.then(
                r => parseFloat(ethers.utils.formatUnits(r[0], tkn1Dec))
            ),
            weight: 50
        }
        const tkn2Dec = instrMng.getTokenById(pool.tkns[1].id).decimal
        reserves[pool.tkns[1].id] = {
            balance: await reservesRaw.then(
                r => parseFloat(ethers.utils.formatUnits(r[1], tkn2Dec))
            ), 
            weight: 50
        }
        return reserves
    }

    async formQuery(inputAmount, path) {
        // Input amount needs to in base units of asset (eg. wei)
        const queryContract = new ethers.Contract(
            config.constants.routers.unishProxy, 
            config.abis['unishRouterProxy']
        )
        let tx = await queryContract.populateTransaction.getOutputAmount(
            this.routerAddress, 
            inputAmount, 
            path
        )
        // If input location is 0 input amount needs to be injected on the call
        const inputLocs = inputAmount==ethers.constants.Zero ? [88] : []   // In bytes

        return { tx, inputLocs }
    }

    async formTrade(inputAmount, tokenPath, outputAmount=0, timeShift=300) {
        const baseAddress = instrMng.getTokenById(config.settings.arb.baseAsset).address
        const tradeTimeout = Math.round((Date.now()/1000) + timeShift)
        if (tokenPath[0]==baseAddress) {
            var tx = await this.routerContract.populateTransaction.swapExactETHForTokens(
                outputAmount, 
                tokenPath, 
                config.constants.dispatcher, 
                tradeTimeout
            )
        } else {
            var tx = await this.routerContract.populateTransaction.swapExactTokensForTokens(
                inputAmount,
                outputAmount, 
                tokenPath, 
                config.constants.dispatcher, 
                tradeTimeout
            )
        }
        // If input location is 0 input amount needs to be injected on the call
        const inputLocs = inputAmount==ethers.constants.Zero && tokenPath[0]!=baseAddress ? [56] : []   // In bytes

        return { tx, inputLocs }
    }
}

class Sushiswap extends Uniswap {

    constructor(provider) {
        super(provider)
        this.key = 'sushiswap'
        this.routerAddress = config.constants.routers[this.key]
        this.routerContract = new ethers.Contract(
            this.routerAddress, 
            config.abis['uniswapRouter']
        )
    }
}

class Crypto extends Uniswap {

    constructor(provider) {
        super(provider)
        this.key = 'crypto'
        this.routerAddress = config.constants.routers[this.key]
        this.routerContract = new ethers.Contract(
            this.routerAddress, 
            config.abis['uniswapRouter']
        )
    }
}

class Linkswap extends Uniswap {

    constructor(provider) {
        super(provider)
        this.key = 'linkswap'
        this.routerAddress = config.constants.routers[this.key]
        this.routerContract = new ethers.Contract(
            this.routerAddress, 
            config.abis['uniswapRouter']
        )
    }
}

class Polyient extends Uniswap {

    constructor(provider) {
        super(provider)
        this.key = 'polyient'
        this.routerAddress = config.constants.routers[this.key]
        this.routerContract = new ethers.Contract(
            this.routerAddress, 
            config.abis['uniswapRouter']
        )
    }
}

class Whiteswap extends Uniswap {

    constructor(provider) {
        super(provider)
        this.key = 'whiteswap'
        this.routerAddress = config.constants.routers[this.key]
        this.routerContract = new ethers.Contract(
            this.routerAddress, 
            config.abis['uniswapRouter']
        )
    }
}

class Sashimiswap extends Uniswap {

    constructor(provider) {
        super(provider)
        this.key = 'sashimiswap'
        this.routerAddress = config.constants.routers[this.key]
        this.routerContract = new ethers.Contract(
            this.routerAddress, 
            config.abis['uniswapRouter']
        )
    }
}

function getExchanges(provider) {
    return {
        sashimiswap: new Sashimiswap(provider),
        sushiswap: new Sushiswap(provider), 
        whiteswap: new Whiteswap(provider), 
        linkswap: new Linkswap(provider), 
        polyient: new Polyient(provider), 
        uniswap: new Uniswap(provider), 
        crypto: new Crypto(provider), 
    }   
}

module.exports = { getExchanges }
