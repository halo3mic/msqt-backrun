const { provider } = require('../../src/provider').ws
const config = require('../../src/config')
const adder = require('./adder')

const ethers = require('ethers')
const csv = require('csvtojson')

const FLAGS = {
    'import-csv': importPoolsFromCsv, 
    'import-factory': importPoolsFromFactory, 
    'approve': approveTkns, 
    'paths': generatePaths
}

async function main() {
    let flags = Object.keys(FLAGS).filter(f=>process.argv.includes(f))
    flags.forEach(f=>FLAGS[f]())
}

async function importPoolsFromCsv() {
    console.log('Importing pools from csv ...')
    const sourcePath = `${__dirname}/add.csv`
    const addRequests = await csv().fromFile(sourcePath)
    let poolMng = new adder.PoolManager()
    await Promise.all(
        addRequests.map(r => poolMng.add(r.poolAddress))
    )
    process.exit(1)
}

async function importPoolsFromFactory() {
    let poolMng = new adder.PoolManager()
    let factoryAbi = require('../../config/abis/uniswapFactory.json')
    Object.values(config.constants.factories).forEach(async address => {
        console.log(`Querying a factory for pools: ${address}`)
        let factoryContract = new ethers.Contract(address, factoryAbi, provider)
        let max = await factoryContract.allPairsLength().then(l=>l.toNumber())
        let i = 0
        while (i<max) {
            try {
                let a = await factoryContract.allPairs(i)
                poolMng.add(a)
                i ++
            } catch (e) {
                console.log(e)
                break
            }
        }
    })
}

async function approveTkns() {
    console.log('Approving tokens ...')
    let approvalMng = new adder.ApprovalsManager()
    await approvalMng.updateAllApprovals()  // Update the allowance
    await approvalMng.approveAll()  // Approve
    process.exit(1)
}

async function generatePaths() {
    console.log('Generating paths ...')
    let im = new adder.InstructionManager()
    im.findInstructions()
    process.exit(1)
}

main()
