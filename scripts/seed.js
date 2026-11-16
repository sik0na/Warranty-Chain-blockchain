// Adds some demo data so the website is not empty during a presentation.
// Run AFTER deploy.js.
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const ONE_DAY = 24 * 60 * 60;

function readContractAddress() {
  const filePath = path.join(__dirname, "..", "frontend", "contract-config.js");
  const text = fs.readFileSync(filePath, "utf8");
  const match = text.match(/CONTRACT_ADDRESS = "(0x[0-9a-fA-F]+)"/);
  if (!match) {
    throw new Error("Could not find contract address. Did you run the deploy script?");
  }
  return match[1];
}

async function main() {
  const [shop, serviceCenter, alice, bob] = await ethers.getSigners();
  const contract = await ethers.getContractAt("WarrantyChain", readContractAddress());

  const latestBlock = await ethers.provider.getBlock("latest");
  const now = latestBlock.timestamp;

  console.log("Registering products...");
  await (await contract.connect(shop).registerProduct("Sony WH-1000XM5 Headphones", "SONY-HP-0001")).wait();
  await (await contract.connect(shop).registerProduct("Logitech MX Master 3 Mouse", "LOGI-MS-0042")).wait();
  await (await contract.connect(shop).registerProduct("Kindle Paperwhite", "AMZ-KD-7781")).wait();

  console.log("Issuing warranties...");
  // Alice: headphones, 1 year
  await (await contract.connect(shop).issueWarranty(1, alice.address, now + 365 * ONE_DAY)).wait();
  // Alice: mouse, only 30 days (use time-travel script to show it expiring)
  await (await contract.connect(shop).issueWarranty(2, alice.address, now + 30 * ONE_DAY)).wait();
  // Bob: kindle, 2 years
  await (await contract.connect(shop).issueWarranty(3, bob.address, now + 730 * ONE_DAY)).wait();

  console.log("Creating an example claim history...");
  // Bob's kindle: a claim that went all the way to REPAIRED
  await (await contract.connect(bob).submitClaim(3, "Screen flickers when turning pages")).wait();
  await (await contract.connect(serviceCenter).approveClaim(1, "Display connector defect, covered")).wait();
  await (await contract.connect(serviceCenter).markRepaired(1, "Replaced display cable")).wait();

  // Alice's headphones: an open claim waiting for the service center
  await (await contract.connect(alice).submitClaim(1, "Left ear cup has no sound")).wait();

  console.log("Done!");
  console.log("Alice (customer):", alice.address, "- Hardhat account #2");
  console.log("Bob   (customer):", bob.address, "- Hardhat account #3");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
