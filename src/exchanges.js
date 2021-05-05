const config = require('./config')
const ethers = require('ethers')
const { ABIS, ROUTERS, WETH_ADDRESS, DISPATCHER } = require('./config')
const tokens = require('../config/tokens.json')
let tokensMap = Object.fromEntries(tokens.map(element => [element.id, element]))

class Uniswap {

    constructor(provider) {
        this.provider = provider
        this.routerAddress = ROUTERS.UNISWAP
        this.routerContract = new ethers.Contract(
            this.routerAddress, 
            ABIS['uniswapRouter']
        )
    }

    async fetchReservesRaw(poolAddress) {
        const poolContract = new ethers.Contract(
            poolAddress, 
            ABIS['uniswapPool'], 
            this.provider
        )
        return await poolContract.getReserves()
    }

    async fetchReserves(pool) {
        const reserves = {}
        const reservesRaw = this.fetchReservesRaw(pool.address)
        const tkn1Dec = tokensMap[pool.tkns[0].id].decimal
        reserves[pool.tkns[0].id] = {
            balance: await reservesRaw.then(
                r => parseFloat(ethers.utils.formatUnits(r[0], tkn1Dec))
            ),
            weight: 50
        }
        const tkn2Dec = tokensMap[pool.tkns[1].id].decimal
        reserves[pool.tkns[1].id] = {
            balance: await reservesRaw.then(
                r => parseFloat(ethers.utils.formatUnits(r[1], tkn2Dec))
            ), 
            weight: 50
        }
        return reserves
    }

    async formQueryTx(inputAmount, path) {
        // Input amount needs to in base units of asset (eg. wei)
        const queryContract = new ethers.Contract(
            config.ROUTERS.UNIISH_PROXY, 
            ABIS['unishRouterProxy']
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

    async formTradeTx(inputAmount, tokenPath, outputAmount=0, timeShift=300) {
        const baseAddress = tokensMap[config.BASE_ASSET].address
        const tradeTimeout = Math.round((Date.now()/1000) + timeShift)
        if (tokenPath[0]==baseAddress) {
            var tx = await this.routerContract.populateTransaction.swapExactETHForTokens(
                outputAmount, 
                tokenPath, 
                DISPATCHER, 
                tradeTimeout
            )
        } else {
            var tx = await this.routerContract.populateTransaction.swapExactTokensForTokens(
                inputAmount,
                outputAmount, 
                tokenPath, 
                DISPATCHER, 
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
        this.routerAddress = ROUTERS.SUSHISWAP
        this.routerContract = new ethers.Contract(
            this.routerAddress, 
            ABIS['uniswapRouter']
        )
    }
}

class Crypto extends Uniswap {

    constructor(provider) {
        super(provider)
        this.routerAddress = ROUTERS.CRYPTO
        this.routerContract = new ethers.Contract(
            this.routerAddress, 
            ABIS['uniswapRouter']
        )
    }
}

class Linkswap extends Uniswap {

    constructor(provider) {
        super(provider)
        this.routerAddress = ROUTERS.LINKSWAP
        this.routerContract = new ethers.Contract(
            this.routerAddress, 
            ABIS['uniswapRouter']
        )
    }
}

class Polyient extends Uniswap {

    constructor(provider) {
        super(provider)
        this.routerAddress = ROUTERS.POLYIENT
        this.routerContract = new ethers.Contract(
            this.routerAddress, 
            ABIS['uniswapRouter']
        )
    }
}

class Whiteswap extends Uniswap {

    constructor(provider) {
        super(provider)
        this.routerAddress = ROUTERS.WHITESWAP
        this.routerContract = new ethers.Contract(
            this.routerAddress, 
            ABIS['uniswapRouter']
        )
    }
}

class Sashimiswap extends Uniswap {

    constructor(provider) {
        super(provider)
        this.routerAddress = ROUTERS.SASHIMISWAP
        this.routerContract = new ethers.Contract(
            this.routerAddress, 
            ABIS['uniswapRouter']
        )
    }
}

function getExchanges(provider) {
    return {
        uniswap: new Uniswap(provider), 
        sushiswap: new Sushiswap(provider), 
        linkswap: new Linkswap(provider), 
        crypto: new Crypto(provider), 
        polyient: new Polyient(provider), 
        whiteswap: new Whiteswap(provider), 
        sashimiswap: new Sashimiswap(provider)
    }   
}

module.exports = { getExchanges }
