const { expect } = require("chai");
const { ethers } = require("hardhat");

const { assets, unilikeRouters } = require('./addresses.json') 
const reservesMng = require('../src/reservesManager')
const instrMng = require('../src/instrManager')
const backrunner = require('../src/backrunner')
const txMng = require('../src/txManager')
const config = require('../src/config')
const arbbot = require('../src/arbbot')

const ZERO = ethers.constants.Zero

async function makeAccountGen() {
	function* getNewAccount() {
		for (let account of accounts) {
			yield account
		}
	}
	accounts = await ethers.getSigners();
	let newAccountGen = getNewAccount()
	let genNewAccount = () => newAccountGen.next().value
	return genNewAccount
}

async function impersonateAccount(address) {
	return network.provider.request({
		method: "hardhat_impersonateAccount",
		params: [ address ],
	  })
}

// Modify colors to distinguish between execution output and tests easier
const _clrYellow = '\x1b[33m'
const _clrCyan = '\x1b[36m'
const _clrReset = '\x1b[0m'
var originalIt = it
it = (description, fun) => {
	return originalIt(_clrCyan+description+_clrReset, fun)
}
var originalDescribe = describe
describe = (description, fun) => {
	return originalDescribe(_clrYellow+description+_clrReset, fun)
}

describe('Handle new backrun request', () => {

	let genNewAccount, botOperator, signer, msqtTrader
	
	before(async () => {
		genNewAccount = await makeAccountGen()
		signer = ethers.Wallet.createRandom().connect(ethers.provider)
		botOperator = new ethers.Wallet(config.PRIVATE_KEY, ethers.provider)

		
	})

	beforeEach(() => {
		trader = genNewAccount()
	})

	it('Uniswaplike signed tx should be decrypted', async () => {
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
			ABIS['uniswapRouter'] 
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
		let { txRequest, callArgs, sender } = backrunner.decryptRawTx(signedTradeTxRequest)
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

	it('`decryptUnilikeTx` should revert if tx is not unilike (no data)', async () => {
		let tx = {
			to: ethers.constants.AddressZero, 
			from: trader.address
		}
		// Decrypt signed transaction
		expect(() => backrunner.decryptUnilikeTx(tx)).to.throw(
			'Transaction is not uniswap-like'
		)
	})

	it('Enrich call-args with supported pool for two tokens', () => {
		let callArgs = {
			amountIn: ethers.utils.parseEther('10'),
			amountOut: ethers.utils.parseUnits('30000', 6),
			method: 'swapExactETHForTokens',
			tknPath: [ assets.WETH, assets.USDC ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+300
		}
		let enrichedArgs = backrunner.enrichCallArgs(callArgs)
		expect(enrichedArgs.tknPath.join()).to.equal(['T0000', 'T0003'].join())
		expect(enrichedArgs.poolAddresses.join()).to.equal([
			'0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'
		].join())
		expect(enrichedArgs.poolIds.join()).to.equal(['P0003'].join())
		expect(enrichedArgs.amountIn).to.equal(ethers.utils.parseUnits('10'))
		expect(enrichedArgs.amountOutMin).to.equal(ethers.utils.parseUnits('30000'))
	})

	it('Enrich call-args with supported pool for three tokens', () => {
		let callArgs = {
			amountIn: ethers.utils.parseEther('10'),
			amountOut: ethers.utils.parseUnits('3000', 6),
			method: 'swapExactETHForTokens',
			tknPath: [ assets.WETH, assets.DAI, assets.USDC ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+300
		}
		let enrichedArgs = backrunner.enrichCallArgs(callArgs)
		expect(enrichedArgs.tknPath.join()).to.equal(['T0000', 'T0006', 'T0003'].join())
		expect(enrichedArgs.poolAddresses.join()).to.equal([
			'0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11',
			'0xAE461cA67B15dc8dc81CE7615e0320dA1A9aB8D5' 
		].join())
		expect(enrichedArgs.poolIds.join()).to.equal(['P0009', 'P00249'].join())
		expect(enrichedArgs.amountIn).to.equal(ethers.utils.parseUnits('10'))
		expect(enrichedArgs.amountOutMin).to.equal(ethers.utils.parseUnits('3000'))
	})

	it('Enrich call-args with unsupported pool for two tokens should return `undefined`', () => {
		let callArgs = {
			amountIn: ethers.utils.parseEther('100'),
			amountOut: ZERO,
			method: 'swapExactTokensForTokens',
			tknPath: [ assets.LINK, assets.DAI ],
			router: unilikeRouters.uniswap, 
			deadline: parseInt(Date.now()/1e3)+300
		}
		expect(backrunner.enrichCallArgs(callArgs)).to.equal(undefined)
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
			ABIS['uniswapRouter'] 
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
		let [ backrunRequest1 ] = backrunner.getBackrunRequests()
		let { callArgs, txRequest, sender } = backrunRequest1
		// Compare passed call arguments to decrypted ones
		expect(callArgs.amountIn).to.equal(txCallArgs.amountIn)
		expect(callArgs.amountOut).to.equal(txCallArgs.amountOutMin)
		expect(callArgs.tknPath.join('')).to.equal(['T0000', 'T0006'].join(''))
		expect(callArgs.deadline).to.equal(txCallArgs.deadline)
		// // Compare passed transaction parameters to unsigned ones
		expect(txRequest.to).to.equal(tradeTxRequest.to)
		expect(txRequest.nonce).to.equal(tradeTxRequest.nonce)
		expect(txRequest.value).to.equal(tradeTxRequest.value)
		expect(sender).to.equal(signer.address)
	})

})
