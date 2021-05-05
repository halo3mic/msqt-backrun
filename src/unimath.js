/**
  * This module provides math functions suited for caclulation of optimal amount of multi-path arbitrage strategy on Uniswap pools.
  * The math was taken from github repo https://github.com/ccyanxyz/uniswap-arbitrage-analysis/tree/c5325ac7ef8086c544e30e4d686c5e0ab1144d96,
  * for which formatted formulas can be found here https://hackmd.io/@KLMgUhDpRBW3N-1JVEla5A/BJr3wf4lO.
*/

const { BigNumber } = require('ethers')
const BN = require('bignumber.js')

let d1000 = BigNumber.from("1000")
let d997 = BigNumber.from("997")
const ZERO = BigNumber.from("0")    

/**
 * Return optimal amount for a reserve path
 * @param {Array[BigNumber]} reservePatPool reserves ordered by path precedence
 * @returns {BigNumber}
 */
function getOptimalAmountForPath(reservePath) {
    let result = getEaEb(reservePath)
    return getOptimalAmount(...result) || ZERO
}

/**
 * Return reserves for virtual pool
 * @param {Array[BigNumber]} reservePath Pool reserves ordered by path precedence
 * @returns {Array[BigNumber]}
 */
function getEaEb(reservePath) {
    let Rb1, Rc
    let Ea = reservePath[0]
    let Eb = reservePath[1]
    for (let i=2; i<reservePath.length-1; i+=2) {
        Rb1 = reservePath[i]
        Rc = reservePath[i+1]
        Ea = d1000.mul(Ea).mul(Rb1).div(d1000.mul(Rb1).add(d997.mul(Eb)))
        Eb = d997.mul(Eb).mul(Rc).div(d1000.mul(Rb1).add(d997.mul(Eb)))
    }
    return [ Ea, Eb ]
}

/**
 * Return optimal amount for virtual reserves
 * @param {BigNumber} Ea Reserve of virtual pool
 * @param {BigNumber} Eb Reserve of virtual pool
 * @returns {BigNumber}
 */
function getOptimalAmount(Ea, Eb) {
    if (Ea.lt(Eb)) {
        let x = Ea.mul(Eb).mul(d997).mul(d1000)
        let y = BigNumber.from(BN.BigNumber(x.toString()).sqrt().toFixed(0))
        return y.sub(Ea.mul(d1000)).div(d997)
    }
}

/**
 * Return amount recieved for trading amountIn between two assets
 * @param {BigNumber} amountIn Sell amount
 * @param {BigNumber} reserveIn Reserve of selling asset
 * @param {BigNumber} reserveOut Reserve of buying asset
 * @returns {BigNumber}
 */
function getAmountOut(amountIn, reserveIn, reserveOut) {
    if (amountIn.eq(ZERO)) {
        return ZERO
    }
    let taxedIn = d997.mul(amountIn)
    let numerator = taxedIn.mul(reserveOut)
    let denominator = d1000.mul(reserveIn).add(taxedIn)
    return numerator.div(denominator)
}

/**
 * Return amount recieved for trading through a path
 * @param {BigNumber} amountIn Sell amount
 * @param {BigNumber} reservePath Pool reserves ordered by path precedence
 * @returns {BigNumber}
 */
function getAmountOutByReserves(amountIn, reservePath) {
    var amountOut = amountIn
    for (let i=0; i<reservePath.length-1; i+=2) {
        amountOut = getAmountOut(
            amountOut, 
            reservePath[i], 
            reservePath[i+1]
        )
    }
    return amountOut
}

/**
 * Get amount traded for each step of the path
 * @param {BigNumber} amountIn Sell amount
 * @param {Array} reservePath Pool reserves ordered by path precedence
 * @returns {Array}
 */
function getAmountsByReserves(amountIn, reservePath) {
    var amounts = [amountIn]
    var amountOut = amountIn
    for (let i=0; i<reservePath.length-1; i+=2) {
        amountOut = getAmountOut(
            amountOut, 
            reservePath[i], 
            reservePath[i+1]
        )
        amounts.push(amountOut)
    }
    return amounts
}

module.exports = { 
    getOptimalAmountForPath, 
    getAmountOutByReserves,
    getAmountsByReserves,
    getOptimalAmount, 
    getAmountOut, 
    getEaEb, 
}