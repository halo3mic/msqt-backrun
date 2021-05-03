const resolve = require('path').resolve
const ethers = require('ethers')
const dotenv = require('dotenv')
const path = require('path')
require('dotenv').config()
const fs = require('fs')


function loadAllABIs() {
    // Loads all available ABIs in the memory
    const abisLocalPath = "../config/abis"
    const absPath = resolve(`${__dirname}/${abisLocalPath}`)
    const files = fs.readdirSync(absPath)
    const abis = Object.fromEntries(files.map(fileName => [
            fileName.split('.')[0], 
            require(path.join(absPath, fileName))
        ])
    )
    return abis
}

function getPrivateKey() {
    // Specify private key through an argument
    let prefix = '--pk='
    let pkNum = process.argv.filter(a => a.includes(prefix))
    let pkWithAddress = pkNum.length>0 ? process.env[`PK${pkNum[0].replace(prefix, '')}`] : process.env.PK1
    let pk = pkWithAddress.slice(43)
    return pk
}

function getSecrets() {
    dotenv.config()
    return process.env
}

// TODO: Keep constants in json file

BOT_ID = '2'
NETWORK = 1
DISPATCHER = '0x5dc60BC57d7846EEB5C046345950c69224C83b6E'
CLIENT = '0xa2cD5b9D50d19fDFd2F37CbaE0e880F9ce327837'
TRADER = '0xb5789BBBcFbea505fA7bab11E1813b00113fe86f'
DISPATCHER_TIPPER = '0x9cEe83299D2BdCd63443260F6C76f8c9Eb5454e9'
TIPJAR = '0x5312B0d160E16feeeec13437a0053009e7564287'
ROUTERS = {
    UNIISH_PROXY: '0x966A28C71DCCF46605C0d778Ada166bbB321a965',
    SASHIMISWAP: '0xe4FE6a45f354E845F954CdDeE6084603CEDB9410',
    SUSHISWAP: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
    MOONISWAP: '0x798934cdcfAe18764ef4819274687Df3fB24B99B',
    WHITESWAP: '0x463672ffdED540f7613d3e8248e3a8a51bAF7217',
    POLYIENT: '0x5F54e90b296174709Bc00cfC0Cd2b69Cf55b2064',
    LINKSWAP: '0xA7eCe0911FE8C60bff9e99f8fAFcDBE56e07afF1',
    UNISWAP: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    CRYPTO: '0xCeB90E4C17d626BE0fACd78b79c9c87d7ca181b3',
}
UNISWAP_SYNC_TOPIC = '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1'  // Sync(uint112 reserve0, uint112 reserve1)
ARCHER_URL = 'https://api.archerdao.io/v1/submit-opportunity'
ARCHER_BATCHES_URL = 'https://api.archerdao.io/v1/bundle/send'
ARCHER_FAIL_LOGS_PATH = './logs/responsesFail.csv'
ARCHER_PASS_LOGS_PATH = './logs/responsesPass.csv'
ARCHER_REQUESTS_LOGS_PATH='./logs/requests.csv'

GAS_PRICE_LIMIT = ethers.utils.parseUnits('2000', 'gwei')
GAS_PRICE_PRCT_EXTRA = ethers.BigNumber.from('100')  // 100% 
MAX_GAS_COST = ethers.utils.parseEther('0.01')
GAS_LIMIT = "1200000"
GAS_SPEED = 'rapid'

MAX_REQUESTS_POOL_SIZE = 20
MAX_BUNDLE_SIZE = 10
MIN_PROFIT = ethers.utils.parseEther('0')
TIPPER_SHARE_RATE = ethers.utils.parseUnits('0.9')
MAX_HOPS = 4
BASE_ASSET = 'T0000'
BLACKLISTED_TKNS = [
    'T0077',  // ampl
    'T0079', // serges
]
EMPTY_POOL_THRESHOLD = ethers.utils.parseUnits('10')

WS_ENDPOINT = process.env.WS_ENDPOINT
RPC_ENDPOINT = process.env.HTTP_ENDPOINT
PRIVATE_KEY = getPrivateKey()
SECRETS = getSecrets()
ABIS = loadAllABIs()

// TODO: Group these vars into multiple objects
module.exports = {
    ARCHER_REQUESTS_LOGS_PATH,
    MAX_REQUESTS_POOL_SIZE,
    ARCHER_PASS_LOGS_PATH,
    ARCHER_FAIL_LOGS_PATH,
    EMPTY_POOL_THRESHOLD,
    GAS_PRICE_PRCT_EXTRA,
    UNISWAP_SYNC_TOPIC,
    ARCHER_BATCHES_URL,
    DISPATCHER_TIPPER,
    TIPPER_SHARE_RATE,
    BLACKLISTED_TKNS,
    GAS_PRICE_LIMIT,
    MAX_BUNDLE_SIZE,
    RPC_ENDPOINT,
    MAX_GAS_COST,
    WS_ENDPOINT,
    PRIVATE_KEY,
    DISPATCHER,
    BASE_ASSET, 
    MIN_PROFIT, 
    ARCHER_URL,
    GAS_SPEED,
    GAS_LIMIT,
    MAX_HOPS,
    TIPJAR,
    NETWORK, 
    ROUTERS,
    SECRETS,
    TRADER,
    CLIENT, 
    BOT_ID,
    ABIS,
}