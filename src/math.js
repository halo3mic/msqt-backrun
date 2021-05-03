const { BigNumber, FixedNumber } = require('ethers')
const bn = require('bignumber.js')

let d1000 = BigNumber.from("1000");
let d997 = BigNumber.from("997");
const ZERO = BigNumber.from("0");
const ONE = BigNumber.from("1");
const TWO = BigNumber.from("2");

function getNeighbour(array, caller) {
    return caller==array[0] ? array[1] : array[0]
}

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

function getOptimalAmount(Ea, Eb) {
    if (Ea.lt(Eb)) {
        let x = Ea.mul(Eb).mul(d997).mul(d1000)
        // let y = sqrt(x)
        let y = BigNumber.from(bn.BigNumber(x.toString()).sqrt().toFixed(0))
        return y.sub(Ea.mul(d1000)).div(d997)
    }
}

function getAmountOut(amountIn, reserveIn, reserveOut) {
    if (amountIn.eq(ZERO)) {
        return ZERO
    }
    let taxedIn = d997.mul(amountIn)
    let numerator = taxedIn.mul(reserveOut)
    let denominator = d1000.mul(reserveIn).add(taxedIn)
    return numerator.div(denominator)
}

function getAmountOutByPath(tokenIn, amountIn, path) {
    var amountOut = amountIn
    var tokenOut = tokenIn
    for (let pair of path) {
        if (!pair.tkns.includes(tokenOut)) {
            throw new Error('Invalid path')
        }
        tokenOut = getNeighbour(pair.tkns, tokenIn)
        amountOut = getAmountOut(
            amountOut, 
            pair.reserves[tokenIn], 
            pair.reserves[tokenOut]
            )
        tokenIn = tokenOut
    }
    return amountOut
}

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


function getOptimalAmountForPath(reservePath) {
    let result = getEaEb(reservePath)
    return getOptimalAmount(...result) || ZERO
}


module.exports = { 
    getEaEb, 
    getOptimalAmount, 
    getAmountOut, 
    getAmountOutByPath, 
    getOptimalAmountForPath, 
    getAmountOutByReserves,
    getAmountsByReserves
}