require("@nomicfoundation/hardhat-toolbox");
const { vars } = require("hardhat/config");

// Secrets are saved with `npx hardhat vars set ...`, NOT in this file,
// so they never end up in the project folder or on GitHub.
module.exports = {
  solidity: "0.8.24",
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    sepolia: {
      url: vars.get("SEPOLIA_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com"),
      accounts: vars.has("DEPLOYER_PRIVATE_KEY") ? [vars.get("DEPLOYER_PRIVATE_KEY")] : [],
    },
  },
};
