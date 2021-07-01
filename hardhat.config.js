require("@nomiclabs/hardhat-waffle");
require("hardhat-tracer");
require('dotenv').config();
/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: "0.7.0",
  method: "hardhat_reset",
  networks: {
    hardhat: {
      forking: {
        url: process.env.HTTP_ENDPOINT
      },
      accounts: {
        accountsBalance: "10000000000000000000000000", 
        count: 100
      }
    }
  }, 
  mocha: {
    timeout: 1e5
  }
};
