// Online demo only (no MetaMask needed).
// This file pretends to be the blockchain: it follows the same rules and error messages as
// contracts/WarrantyChain.sol, and saves everything in the visitor's browser (localStorage).
// It replaces contract-config.js, so app.js works without any changes.

const CHAIN_ID = 31337; // makes app.js show the demo tabs
const RPC_URL = "";
const DEPLOY_BLOCK = 0;
const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const CONTRACT_ABI = [];

const DEMO_ACCOUNTS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // 0 shop
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // 1 service center
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // 2 Alice
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906", // 3 Bob
];
const SHOP = DEMO_ACCOUNTS[0];
const SERVICE_CENTER = DEMO_ACCOUNTS[1];
const STORAGE_KEY = "warrantychain-demo-v1";
const DAY = 24 * 60 * 60;

let chain = null;
chain = loadChain(); // two lines, because sampleChain() also writes to chain

// ---------- saving ----------

function loadChain() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) return saved;
  } catch (err) {
    // storage blocked: just start with the sample data
  }
  return sampleChain();
}

function saveChain() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chain));
  } catch (err) {
    // storage blocked: changes only last until the page is closed
  }
}

// ---------- the "contract" (same rules as WarrantyChain.sol) ----------

function now() {
  return Math.floor(Date.now() / 1000);
}

function fail(message) {
  const error = new Error(message);
  error.reason = message; // app.js shows err.reason
  throw error;
}

function fakeHash() {
  let hash = "0x";
  for (let i = 0; i < 64; i++) hash += Math.floor(Math.random() * 16).toString(16);
  return hash;
}

function emit(eventName, args) {
  chain.blockNumber++;
  chain.events.push({
    eventName: eventName,
    args: args,
    blockNumber: chain.blockNumber,
    index: 0,
    transactionHash: fakeHash(),
    timestamp: now(),
  });
}

function registerProduct(sender, name, serialNumber) {
  if (sender !== SHOP) fail("Only the shop can do this");
  if (!name) fail("Product name is required");
  if (!serialNumber) fail("Serial number is required");
  if (chain.products.some((p) => p.serialNumber === serialNumber)) fail("Serial number already registered");

  const id = chain.products.length + 1;
  chain.products.push({ id: id, name: name, serialNumber: serialNumber, hasWarranty: false });
  emit("ProductRegistered", { productId: id, name: name, serialNumber: serialNumber });
}

function issueWarranty(sender, productId, owner, expiresAt) {
  productId = Number(productId);
  if (sender !== SHOP) fail("Only the shop can do this");
  if (productId < 1 || productId > chain.products.length) fail("Product does not exist");
  if (chain.products[productId - 1].hasWarranty) fail("Product already has a warranty");
  if (owner === SHOP || owner === SERVICE_CENTER) fail("Owner must be a customer");
  if (expiresAt <= now()) fail("Expiry date must be in the future");

  const id = chain.warranties.length + 1;
  chain.warranties.push({
    id: id,
    productId: productId,
    owner: owner,
    issuedAt: now(),
    expiresAt: expiresAt,
    hasOpenClaim: false,
  });
  chain.products[productId - 1].hasWarranty = true;
  emit("WarrantyIssued", { warrantyId: id, productId: productId, owner: owner, expiresAt: expiresAt });
}

function submitClaim(sender, warrantyId, description) {
  const w = getWarranty(warrantyId);
  if (sender !== w.owner) fail("Only the warranty owner can submit a claim");
  if (now() > w.expiresAt) fail("Warranty has expired");
  if (w.hasOpenClaim) fail("This warranty already has an open claim");
  if (!description) fail("Please describe the problem");

  const id = chain.claims.length + 1;
  chain.claims.push({
    id: id,
    warrantyId: w.id,
    customer: sender,
    description: description,
    status: 0, // SUBMITTED
    decisionReason: "",
    repairNote: "",
    submittedAt: now(),
  });
  w.hasOpenClaim = true;
  emit("ClaimSubmitted", { claimId: id, warrantyId: w.id, customer: sender, description: description });
}

function decideClaim(sender, claimId, newStatus, text) {
  if (sender !== SERVICE_CENTER) fail("Only the service center can do this");
  const c = getClaim(claimId);
  const w = getWarranty(c.warrantyId);

  if (newStatus === 1 || newStatus === 2) {
    // approve or reject: only from SUBMITTED
    if (c.status !== 0) fail(newStatus === 1 ? "Only submitted claims can be approved" : "Only submitted claims can be rejected");
    if (!text) fail("A reason is required");
    c.decisionReason = text;
  } else {
    // repaired: only from APPROVED
    if (c.status !== 1) fail("Only approved claims can be marked repaired");
    if (!text) fail("A repair note is required");
    c.repairNote = text;
  }

  c.status = newStatus;
  if (newStatus !== 1) w.hasOpenClaim = false; // rejected or repaired closes the claim

  if (newStatus === 1) emit("ClaimApproved", { claimId: c.id, warrantyId: w.id, reason: text });
  if (newStatus === 2) emit("ClaimRejected", { claimId: c.id, warrantyId: w.id, reason: text });
  if (newStatus === 3) emit("ClaimRepaired", { claimId: c.id, warrantyId: w.id, repairNote: text });
}

function getProduct(id) {
  const p = chain.products[Number(id) - 1];
  if (!p) fail("Product does not exist");
  return p;
}

function getWarranty(id) {
  const w = chain.warranties[Number(id) - 1];
  if (!w) fail("Warranty does not exist");
  return w;
}

function getClaim(id) {
  const c = chain.claims[Number(id) - 1];
  if (!c) fail("Claim does not exist");
  return c;
}

// ---------- sample data (same story as scripts/seed.js) ----------

function sampleChain() {
  chain = { blockNumber: 0, products: [], warranties: [], claims: [], events: [] };
  const [shop, service, alice, bob] = DEMO_ACCOUNTS;

  registerProduct(shop, "Sony WH-1000XM5 Headphones", "SONY-HP-0001");
  registerProduct(shop, "Logitech MX Master 3 Mouse", "LOGI-MS-0042");
  registerProduct(shop, "Kindle Paperwhite", "AMZ-KD-7781");
  registerProduct(shop, "JBL Flip 6 Speaker", "JBL-SP-0310");

  issueWarranty(shop, 1, alice, now() + 365 * DAY);
  issueWarranty(shop, 2, alice, now() + 30 * DAY);
  issueWarranty(shop, 3, bob, now() + 730 * DAY);
  issueWarranty(shop, 4, bob, now() + DAY);
  // pretend Bob bought the speaker last year, so this warranty is already expired
  chain.warranties[3].issuedAt = now() - 395 * DAY;
  chain.warranties[3].expiresAt = now() - 30 * DAY;
  chain.events[chain.events.length - 1].args.expiresAt = chain.warranties[3].expiresAt;

  submitClaim(bob, 3, "Screen flickers when turning pages");
  decideClaim(service, 1, 1, "Display connector defect, covered");
  decideClaim(service, 1, 3, "Replaced display cable");
  submitClaim(alice, 1, "Left ear cup has no sound");

  return chain;
}

// ---------- fake versions of the ethers.js objects that app.js uses ----------

class DemoProvider {
  constructor() {
    this.pollingInterval = 0;
  }
  async getSigner(index) {
    return { getAddress: async () => DEMO_ACCOUNTS[index] };
  }
  async getBlock() {
    return { timestamp: now() };
  }
}

class DemoContract {
  constructor(address, abi, runner) {
    this.runner = runner;
    this.filters = {
      WarrantyIssued: (warrantyId) => ({ eventName: "WarrantyIssued", warrantyId: warrantyId }),
      ClaimSubmitted: (_, warrantyId) => ({ eventName: "ClaimSubmitted", warrantyId: warrantyId }),
      ClaimApproved: (_, warrantyId) => ({ eventName: "ClaimApproved", warrantyId: warrantyId }),
      ClaimRejected: (_, warrantyId) => ({ eventName: "ClaimRejected", warrantyId: warrantyId }),
      ClaimRepaired: (_, warrantyId) => ({ eventName: "ClaimRepaired", warrantyId: warrantyId }),
    };
  }

  // Runs a write function as the current account, like sending a transaction
  async send(action) {
    const sender = await this.runner.getAddress();
    action(sender);
    saveChain();
    return { wait: async () => {} };
  }

  // write functions
  registerProduct(name, serial) { return this.send((from) => registerProduct(from, name, serial)); }
  issueWarranty(productId, owner, expiresAt) { return this.send((from) => issueWarranty(from, productId, owner, expiresAt)); }
  submitClaim(warrantyId, text) { return this.send((from) => submitClaim(from, warrantyId, text)); }
  approveClaim(claimId, reason) { return this.send((from) => decideClaim(from, claimId, 1, reason)); }
  rejectClaim(claimId, reason) { return this.send((from) => decideClaim(from, claimId, 2, reason)); }
  markRepaired(claimId, note) { return this.send((from) => decideClaim(from, claimId, 3, note)); }

  // read functions
  async shop() { return SHOP; }
  async serviceCenter() { return SERVICE_CENTER; }
  async productCount() { return chain.products.length; }
  async warrantyCount() { return chain.warranties.length; }
  async claimCount() { return chain.claims.length; }
  async getProduct(id) { return getProduct(id); }
  async getWarranty(id) { return getWarranty(id); }
  async getClaim(id) { return getClaim(id); }

  async queryFilter(filter) {
    return chain.events
      .filter((ev) => ev.eventName === filter.eventName && ev.args.warrantyId === Number(filter.warrantyId))
      .map((ev) => ({ ...ev, getBlock: async () => ({ timestamp: ev.timestamp }) }));
  }
}

// Swap in the fake objects, keep the real ethers helpers (isAddress, getAddress, ...)
window.ethers = Object.assign({}, window.ethers, { JsonRpcProvider: DemoProvider, Contract: DemoContract });

// ---------- small changes to the page for the online demo ----------

document.querySelector(".demo").textContent = "Online demo";
document.querySelector(".notice").innerHTML =
  "<b>How this demo works:</b> Switch tabs to issue a warranty, submit a claim, and review a repair. " +
  "This online demo simulates the WarrantyChain smart contract in your browser with the same rules, " +
  "so no wallet is needed. Your changes are saved only in your own browser. " +
  '<button id="reset-demo" class="secondary small">Reset demo data</button>';

document.getElementById("reset-demo").onclick = () => {
  chain = sampleChain();
  saveChain();
  loadData(); // from app.js
  toast("Demo data reset."); // from app.js
};
