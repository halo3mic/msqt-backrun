# MSQT - Backrun


## About

Bot that searches for arbitrage opportunities across unilike pools with backrunning trades

## Setup:

#### Install dependencies
```
npm install
```

#### Env vars
Create a `.env` file with params specified in `.env.sample`.
**Note that the account passed need to have trading privilages for dispatcher.**

## Run:

#### Start the bot and listeners
```
npm run msqt
```

#### Start the bot and listeners (forever)
```
npm run msqt-forever
```

#### Run all tests
```
npm test
```

## Submit requests

Bot offers two options for backrunning transactions.

### 1. Return a bundle to the sender as a response to REST request

#### About
Method evaluates all opportunities associated with backrunning sent transaction, builds the bundle with most profitable one and returns it to the sender.

#### How to 
Sender sends raw transaction request in the body of POST request to the path `/backrunRequest`.

#### Example if success:

```javascript
{
  status: 1,
  msg: 'OK',
  result: {
    ethCall: {
      method: 'eth_sendBundle',
      params: [ <bundles{Array}>, '0xbccb06' ],
      id: '1',
      jsonrpc: '2.0'
    },
    signature: '0xeaf9b538d514ac41a2b7a8e1b3d037348076946a60274ac2f82cc9d884deced765c88e0a7a3108e88f8b8123fa75572c1540a1e249d5f24b04154c6e7176745b1b',
    senderAddress: '0xb5789BBBcFbea505fA7bab11E1813b00113fe86f'
  }
}
```


### 2. Include transaction request in the local mempool

#### About
Method adds transaction request to the local mempool and evaluates opportunities for it with each new block.

#### How to 
Sender sends raw transaction request in the body of POST request to the path `/submitRequest`.

### Example of success

```javascript
{
  status: 1,
  msg: 'OK'
}
```

## Support

#### Contract support
 - Uniswap-like methods calls
 - ArcherSwap calls

#### Methods supported
 - Uniswap-like 
   - swapExactTokensForTokens
   - swapTokensForExactTokens
   - swapExactETHForTokens
   - swapTokensForExactETH
   - swapExactTokensForETH
   - swapETHForExactTokens
   - swapExactTokensForTokensSupportingFeeOnTransferTokens
   - swapExactETHForTokensSupportingFeeOnTransferTokens
   - swapExactTokensForETHSupportingFeeOnTransferTokens
 - ArcherSwap
   - swapExactTokensForETHAndTipAmount
   - swapExactTokensForETHWithPermitAndTipAmount
   - swapExactTokensForETHAndTipPct
   - swapExactTokensForETHWithPermitAndTipPct
   - swapTokensForExactETHAndTipAmount
   - swapTokensForExactETHWithPermitAndTipAmount
   - swapTokensForExactETHAndTipPct
   - swapTokensForExactETHWithPermitAndTipPct
   - swapExactETHForTokensWithTipAmount
   - swapExactETHForTokensWithTipPct
   - swapETHForExactTokensWithTipAmount
   - swapETHForExactTokensWithTipPct
   - swapExactTokensForTokensWithTipAmount
   - swapExactTokensForTokensWithPermitAndTipAmount
   - swapExactTokensForTokensWithTipPct
   - swapExactTokensForTokensWithPermitAndTipPct
   - swapTokensForExactTokensWithTipAmount
   - swapTokensForExactTokensWithPermitAndTipAmount
   - swapTokensForExactTokensWithTipPct
   - swapTokensForExactTokensWithPermitAndTipPct


## Bot inaccuracy

Current implementation won't be 100% accurate when evaluating the optimal amount and net profit associated with it. Here are the cases/reasons:

1. Gas cost of backrun transaction is not accounted for which could portray false estimates for profit/gasAmount ratio
2. If the trade uses token with fee on transfer the bot will treat it as if there is no fee which could result in false estimation of the optimal amount and the profit.
3. In a case where user tips by % of the output amount (with eg. `swapExactTokensForTokensWithTipPct`) and as `pathToEth` specifies the same pool as the trade went through the bot won't account for the amount of assets put back in the pool by tip conversion. This could result in false estimation of the optimal amount and the profit.