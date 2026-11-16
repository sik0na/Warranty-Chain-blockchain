
// CHAIN_ID 31337 = local Hardhat node (demo tabs), anything else = public network (MetaMask)
const IS_LOCAL = typeof CHAIN_ID === "undefined" || CHAIN_ID === 31337;
const provider = new ethers.JsonRpcProvider(IS_LOCAL ? "http://127.0.0.1:8545" : RPC_URL);
if (IS_LOCAL) provider.pollingInterval = 500;

const ACCOUNTS = {
  Alice: 2,
  Bob: 3,
  Shop: 0,
  "Service center": 1,
};

const STATUS = ["SUBMITTED", "APPROVED", "REJECTED", "REPAIRED"];

let contract;
let myAddress; 
let role;
let currentTab = "Alice";

let warranties = []; 
let claims = [];
let modalAction = null;

const $ = (id) => document.getElementById(id);


// signer = null means "not connected yet": the visitor can only look
async function useAccount(signer, name) {
  contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer || provider);
  myAddress = signer ? await signer.getAddress() : null;

  if (!myAddress) {
    role = "Visitor";
  } else if (myAddress === (await contract.shop())) {
    role = "Shop";
  } else if (myAddress === (await contract.serviceCenter())) {
    role = "Service center";
  } else {
    role = "Customer";
  }

  $("account").textContent = !name || name === role ? role : name + " (" + role + ")";
  $("address").textContent = myAddress || "Not connected";

  await loadData();
}

// Local demo: each tab is one of the Hardhat test accounts
async function switchAccount(tabName) {
  currentTab = tabName;
  const signer = await provider.getSigner(ACCOUNTS[tabName]);
  await useAccount(signer, tabName);
}

// Public version: everyone uses their own MetaMask wallet
async function connectMetaMask() {
  if (!window.ethereum) {
    toast("Please install MetaMask first.");
    return;
  }
  try {
    await window.ethereum.request({ method: "eth_requestAccounts" });
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x" + CHAIN_ID.toString(16) }],
    });

    const signer = await new ethers.BrowserProvider(window.ethereum).getSigner();
    await useAccount(signer);
    $("connect").classList.add("hidden");

    window.ethereum.on("accountsChanged", () => location.reload());
    window.ethereum.on("chainChanged", () => location.reload());
  } catch (err) {
    toast(errorText(err));
  }
}

async function loadData() {
  
    const latestBlock = await provider.getBlock("latest");
    const now = latestBlock.timestamp;
  
    warranties = [];
    const warrantyCount = await contract.warrantyCount();
    for (let id = 1; id <= warrantyCount; id++) {
      const w = await contract.getWarranty(id);
      const p = await contract.getProduct(w.productId);
      warranties.push({
        id: id,
        product: p.name,
        serial: p.serialNumber,
        owner: w.owner,
        expiresAt: Number(w.expiresAt),
        active: now <= Number(w.expiresAt),
        hasOpenClaim: w.hasOpenClaim,
      });
  }

  claims = [];
  const claimCount = await contract.claimCount();
  for (let id = 1; id <= claimCount; id++) {
    const c = await contract.getClaim(id);
    claims.push({
      id: id,
      warrantyId: Number(c.warrantyId),
      issue: c.description,
      status: STATUS[Number(c.status)],
      reason: c.decisionReason,
      repairNote: c.repairNote,
    });
  }

  render();
}


function render() {
  
  let list = warranties;
  if (role === "Customer") {
    list = warranties.filter((w) => w.owner === myAddress);
  }

  
  const visibleClaims = claims.filter((c) => list.some((w) => w.id === c.warrantyId));
  const openClaims = visibleClaims.filter((c) => c.status === "SUBMITTED" || c.status === "APPROVED");

  
  $("total").textContent = list.length;
  $("active").textContent = list.filter((w) => w.active).length;
  $("open").textContent = openClaims.length;

  $("issue").classList.toggle("hidden", role !== "Shop");
  $("section-title").textContent = role === "Customer" ? "My warranties" : "Registered warranties";

  renderWarranties(list);
  renderClaims(visibleClaims);
}

function renderWarranties(list) {
  if (list.length === 0) {
    $("content").innerHTML = '<p class="empty">No warranties yet. The shop can issue a warranty to get started.</p>';
    return;
  }

  let rows = "";
  for (const w of list) {
    let actions = `<button class="secondary small" data-history="${w.id}">History</button> `;
    if (role === "Customer" && w.active) {
      if (w.hasOpenClaim) {
        actions += "<small>Claim in progress</small>";
      } else {
        actions += `<button class="primary small" data-claim="${w.id}">Request repair</button>`;
      }
    }

    rows += `
      <tr>
        <td><b>${escapeHtml(w.product)}</b><br><small class="muted">${escapeHtml(w.serial)}</small></td>
        <td class="mono" title="${w.owner}">${shortAddress(w.owner)}</td>
        <td>${formatDate(w.expiresAt)}</td>
        <td>${badge(w.active ? "ACTIVE" : "EXPIRED")}</td>
        <td>${actions}</td>
      </tr>`;
  }

  $("content").innerHTML = `
    <table>
      <thead>
        <tr><th>PRODUCT / REFERENCE</th><th>OWNER</th><th>EXPIRY DATE</th><th>STATUS</th><th>ACTIONS</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderClaims(list) {
  if (list.length === 0) {
    $("claims").innerHTML = `
      <div class="empty">
        <h3>No repair claims yet</h3>
        <p>Claims will appear here when a customer requests a repair.</p>
      </div>`;
    return;
  }

  let rows = "";
  for (const c of list) {
    const w = warranties.find((w) => w.id === c.warrantyId);

    
    let notes = "";
    if (c.reason) notes += `<br><small class="muted">Reason: ${escapeHtml(c.reason)}</small>`;
    if (c.repairNote) notes += `<br><small class="muted">Repair: ${escapeHtml(c.repairNote)}</small>`;

    
    let actions = `<button class="secondary small" data-history="${w.id}">History</button>`;
    if (role === "Service center" && c.status === "SUBMITTED") {
      actions = `
        <button class="primary small" data-decision="${c.id}" data-state="APPROVED">Approve</button>
        <button class="secondary small" data-decision="${c.id}" data-state="REJECTED">Reject</button>`;
    } else if (role === "Service center" && c.status === "APPROVED") {
      actions = `<button class="primary small" data-decision="${c.id}" data-state="REPAIRED">Complete repair</button>`;
    }

    rows += `
      <tr>
        <td><b>#C${String(c.id).padStart(3, "0")}</b><br>${escapeHtml(w.product)}</td>
        <td>${escapeHtml(c.issue)}${notes}</td>
        <td>${badge(c.status)}</td>
        <td>${actions}</td>
      </tr>`;
  }

  $("claims").innerHTML = `
    <table>
      <thead>
        <tr><th>CLAIM / PRODUCT</th><th>ISSUE</th><th>STATUS</th><th>ACTIONS</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}


function field(label, name, type = "text", value = "") {
  return `<label>${label}<input name="${name}" type="${type}" value="${value}" required></label>`;
}

function showModal(title, fieldsHtml, action) {
  modalAction = action;
  $("modal-title").textContent = title;
  $("fields").innerHTML = fieldsHtml;
  $("error").textContent = "";
  $("save").classList.toggle("hidden", action === null); 
  $("save").disabled = false;
  $("save").textContent = "Save";
  $("cancel").textContent = action === null ? "Close" : "Cancel";
  $("modal").showModal();
}

function openIssueForm() {
  const aliceAddress = IS_LOCAL ? "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" : "";
  showModal(
    "Issue a warranty",
    field("Product name", "product") +
      field("Product reference / serial number", "serial") +
      field("Customer wallet address", "owner", "text", aliceAddress) +
      field("Warranty expiry", "expiry", "date"),
    { type: "issue" }
  );
}

function openClaimForm(warrantyId) {
  showModal(
    "Request a repair",
    `<label>Describe the problem
      <textarea name="issue" required maxlength="500" placeholder="For example: the left headphone stopped working."></textarea>
    </label>`,
    { type: "claim", id: warrantyId }
  );
}

function openDecisionForm(claimId, state) {
  let title = "Reject claim";
  if (state === "APPROVED") title = "Approve claim";
  if (state === "REPAIRED") title = "Complete repair";

  const label = state === "REPAIRED" ? "Repair notes" : "Decision reason";
  showModal(
    title,
    `<label>${label}<textarea name="reason" required maxlength="500"></textarea></label>`,
    { type: "decision", id: claimId, state: state }
  );
}


async function openHistory(warrantyId) {
  const w = warranties.find((x) => x.id === warrantyId);
  showModal(
    "Warranty history",
    `<p><b>${escapeHtml(w.product)}</b> · ${escapeHtml(w.serial)}</p>
     <div class="timeline" id="timeline"><p>Loading from the blockchain...</p></div>`,
    null
  );

  const filters = [
    contract.filters.WarrantyIssued(warrantyId),
    contract.filters.ClaimSubmitted(null, warrantyId),
    contract.filters.ClaimApproved(null, warrantyId),
    contract.filters.ClaimRejected(null, warrantyId),
    contract.filters.ClaimRepaired(null, warrantyId),
  ];
  let events = [];
  for (const filter of filters) {
    const found = await contract.queryFilter(filter, DEPLOY_BLOCK);
    events = events.concat(found);
  }


  events.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);

  let html = "";
  for (const ev of events) {
    const block = await ev.getBlock();
    html += `<p>
      <b>${formatDate(block.timestamp)}</b><br>
      ${describeEvent(ev)}<br>
      <small class="muted mono">tx ${ev.transactionHash.slice(0, 18)}...</small>
    </p>`;
  }
  $("timeline").innerHTML = html;
}

function describeEvent(ev) {
  const a = ev.args;
  const claimName = a.claimId ? "#C" + String(a.claimId).padStart(3, "0") : "";

  if (ev.eventName === "WarrantyIssued") {
    return "Warranty issued by the shop to " + shortAddress(a.owner);
  }
  if (ev.eventName === "ClaimSubmitted") {
    return `Claim ${claimName} submitted: ${escapeHtml(a.description)}`;
  }
  if (ev.eventName === "ClaimApproved") {
    return `Claim ${claimName} approved: ${escapeHtml(a.reason)}`;
  }
  if (ev.eventName === "ClaimRejected") {
    return `Claim ${claimName} rejected: ${escapeHtml(a.reason)}`;
  }
  if (ev.eventName === "ClaimRepaired") {
    return `Claim ${claimName} repaired: ${escapeHtml(a.repairNote)}`;
  }
  return ev.eventName;
}


async function saveForm(event) {
  event.preventDefault();
  if (!modalAction) return;

  const form = Object.fromEntries(new FormData(event.target));
  $("error").textContent = "";
  $("save").disabled = true;
  $("save").textContent = "Waiting for blockchain...";

  try {
    if (modalAction.type === "issue") {
      await issueWarranty(form);
    } else if (modalAction.type === "claim") {
      await sendAndWait(contract.submitClaim(modalAction.id, form.issue.trim()));
    } else if (modalAction.type === "decision") {
      const reason = form.reason.trim();
      if (modalAction.state === "APPROVED") {
        await sendAndWait(contract.approveClaim(modalAction.id, reason));
      } else if (modalAction.state === "REJECTED") {
        await sendAndWait(contract.rejectClaim(modalAction.id, reason));
      } else {
        await sendAndWait(contract.markRepaired(modalAction.id, reason));
      }
    }

    $("modal").close();
    toast("Saved on the blockchain.");
    await loadData();
  } catch (err) {

    $("error").textContent = errorText(err);
  }

  $("save").disabled = false;
  $("save").textContent = "Save";
}


async function issueWarranty(form) {
  
  if (!ethers.isAddress(form.owner.trim())) {
    throw new Error("Enter a valid 42-character wallet address.");
  }
  const owner = ethers.getAddress(form.owner.trim());
  if (owner === (await contract.shop()) || owner === (await contract.serviceCenter())) {
    throw new Error("The owner must be a customer, not the shop or service center.");
  }


  const expiresAt = Math.floor(new Date(form.expiry + "T23:59:59Z").getTime() / 1000);
  const latestBlock = await provider.getBlock("latest");
  if (expiresAt <= latestBlock.timestamp) {
    throw new Error("Choose a future expiry date.");
  }

  await sendAndWait(contract.registerProduct(form.product.trim(), form.serial.trim()));
  const productId = await contract.productCount();
  await sendAndWait(contract.issueWarranty(productId, owner, expiresAt));
}

async function sendAndWait(transactionPromise) {
  const tx = await transactionPromise;
  await tx.wait();
}


function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.remove("hidden");
  setTimeout(() => $("toast").classList.add("hidden"), 3500);
}

function badge(status) {
  return `<span class="badge ${status}">${status}</span>`;
}

function formatDate(timestamp) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10); 
}

function shortAddress(address) {
  return address.slice(0, 6) + "…" + address.slice(-4);
}

function errorText(err) {
  return err.reason || err.shortMessage || err.message;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.onclick = () => {
    document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b === button));
    switchAccount(button.dataset.tab);
  };
});

$("issue").onclick = openIssueForm;
$("connect").onclick = connectMetaMask;
$("cancel").onclick = () => $("modal").close();
$("form").onsubmit = saveForm;


document.addEventListener("click", (e) => {
  const button = e.target.closest("button");
  if (!button) return;

  if (button.dataset.claim) openClaimForm(Number(button.dataset.claim));
  if (button.dataset.decision) openDecisionForm(Number(button.dataset.decision), button.dataset.state);
  if (button.dataset.history) openHistory(Number(button.dataset.history));
});


if (typeof CONTRACT_ADDRESS === "undefined") {
  $("content").innerHTML = '<p class="empty">contract-config.js is missing. Run <b>npm run deploy</b> first.</p>';
} else {
  $("contract-address").textContent = shortAddress(CONTRACT_ADDRESS);

  let start;
  if (IS_LOCAL) {
    start = switchAccount(currentTab);
  } else {
    $("tabs").classList.add("hidden");
    $("connect").classList.remove("hidden");
    // link to Etherscan so anyone can check the records themselves
    $("contract-address").innerHTML =
      `<a href="https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}" target="_blank">${shortAddress(CONTRACT_ADDRESS)}</a>`;
    start = useAccount(null);
  }

  start.catch(() => {
    $("content").innerHTML = IS_LOCAL
      ? '<p class="empty">Cannot connect to the blockchain. Run <b>npm run node</b> and <b>npm run deploy</b>.</p>'
      : '<p class="empty">Cannot connect to the blockchain. Please try again later.</p>';
  });
}
