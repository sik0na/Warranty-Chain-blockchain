// Moves the local blockchain clock forward so you can demo expired warranties.
// Usage: DAYS=40 npm run time-travel   (default is 31 days)
const { network, ethers } = require("hardhat");

async function main() {
  const days = Number(process.env.DAYS || 31);
  await network.provider.send("evm_increaseTime", [days * 24 * 60 * 60]);
  await network.provider.send("evm_mine"); // mine a block so the new time is used

  const block = await ethers.provider.getBlock("latest");
  console.log("Moved forward", days, "days.");
  console.log("Blockchain date is now:", new Date(block.timestamp * 1000).toDateString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
