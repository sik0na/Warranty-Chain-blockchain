const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const ONE_DAY = 24 * 60 * 60;
const ONE_YEAR = 365 * ONE_DAY;

// Claim status numbers must match the enum order in the contract
const SUBMITTED = 0;
const APPROVED = 1;
const REJECTED = 2;
const REPAIRED = 3;

describe("WarrantyChain", function () {
  let contract;
  let shop, serviceCenter, customer, otherCustomer;

  // Deploy a fresh contract before every test
  beforeEach(async function () {
    [shop, serviceCenter, customer, otherCustomer] = await ethers.getSigners();
    const WarrantyChain = await ethers.getContractFactory("WarrantyChain");
    contract = await WarrantyChain.connect(shop).deploy(serviceCenter.address);
  });

  // Helper: register headphones and give the customer a 1 year warranty
  async function issueHeadphonesWarranty() {
    await contract.connect(shop).registerProduct("Sony WH-1000XM5", "SN-001");
    const expiresAt = (await time.latest()) + ONE_YEAR;
    await contract.connect(shop).issueWarranty(1, customer.address, expiresAt);
    return expiresAt;
  }

  describe("Deployment", function () {
    it("sets the shop and service center", async function () {
      expect(await contract.shop()).to.equal(shop.address);
      expect(await contract.serviceCenter()).to.equal(serviceCenter.address);
    });

    it("does not allow the shop to also be the service center", async function () {
      const WarrantyChain = await ethers.getContractFactory("WarrantyChain");
      await expect(WarrantyChain.connect(shop).deploy(shop.address)).to.be.revertedWith(
        "Shop and service center must be different"
      );
    });
  });

  describe("Products", function () {
    it("shop can register a product", async function () {
      await expect(contract.connect(shop).registerProduct("Headphones", "SN-001"))
        .to.emit(contract, "ProductRegistered")
        .withArgs(1, "Headphones", "SN-001");

      const product = await contract.getProduct(1);
      expect(product.name).to.equal("Headphones");
      expect(product.serialNumber).to.equal("SN-001");
      expect(product.hasWarranty).to.equal(false);
    });

    it("other people cannot register products", async function () {
      await expect(contract.connect(customer).registerProduct("Fake", "SN-999")).to.be.revertedWith(
        "Only the shop can do this"
      );
    });

    it("does not allow the same serial number twice", async function () {
      await contract.connect(shop).registerProduct("Headphones", "SN-001");
      await expect(contract.connect(shop).registerProduct("Headphones", "SN-001")).to.be.revertedWith(
        "Serial number already registered"
      );
    });
  });

  describe("Warranties", function () {
    it("shop can issue a warranty to a customer", async function () {
      await contract.connect(shop).registerProduct("Headphones", "SN-001");
      const expiresAt = (await time.latest()) + ONE_YEAR;

      await expect(contract.connect(shop).issueWarranty(1, customer.address, expiresAt))
        .to.emit(contract, "WarrantyIssued")
        .withArgs(1, 1, customer.address, expiresAt);

      const warranty = await contract.getWarranty(1);
      expect(warranty.owner).to.equal(customer.address);
      expect(warranty.expiresAt).to.equal(expiresAt);
      expect(await contract.getWarrantiesByOwner(customer.address)).to.deep.equal([1n]);
    });

    it("cannot issue a warranty for a product that does not exist", async function () {
      const expiresAt = (await time.latest()) + ONE_YEAR;
      await expect(contract.connect(shop).issueWarranty(5, customer.address, expiresAt)).to.be.revertedWith(
        "Product does not exist"
      );
    });

    it("cannot issue two warranties for the same product", async function () {
      const expiresAt = await issueHeadphonesWarranty();
      await expect(contract.connect(shop).issueWarranty(1, otherCustomer.address, expiresAt)).to.be.revertedWith(
        "Product already has a warranty"
      );
    });

    it("cannot issue a warranty with a past expiry date", async function () {
      await contract.connect(shop).registerProduct("Headphones", "SN-001");
      const yesterday = (await time.latest()) - ONE_DAY;
      await expect(contract.connect(shop).issueWarranty(1, customer.address, yesterday)).to.be.revertedWith(
        "Expiry date must be in the future"
      );
    });

    it("only the shop can issue warranties", async function () {
      await contract.connect(shop).registerProduct("Headphones", "SN-001");
      const expiresAt = (await time.latest()) + ONE_YEAR;
      await expect(
        contract.connect(serviceCenter).issueWarranty(1, customer.address, expiresAt)
      ).to.be.revertedWith("Only the shop can do this");
    });

    it("warranty is active before expiry and expired after", async function () {
      const expiresAt = await issueHeadphonesWarranty();
      expect(await contract.isWarrantyActive(1)).to.equal(true);

      await time.increaseTo(expiresAt + 1);
      expect(await contract.isWarrantyActive(1)).to.equal(false);
    });
  });

  describe("Claims", function () {
    beforeEach(async function () {
      await issueHeadphonesWarranty();
    });

    it("owner can submit a claim while the warranty is active", async function () {
      await expect(contract.connect(customer).submitClaim(1, "Left speaker has no sound"))
        .to.emit(contract, "ClaimSubmitted")
        .withArgs(1, 1, customer.address, "Left speaker has no sound");

      const claim = await contract.getClaim(1);
      expect(claim.status).to.equal(SUBMITTED);
      expect((await contract.getWarranty(1)).hasOpenClaim).to.equal(true);
    });

    it("someone who is not the owner cannot submit a claim", async function () {
      await expect(contract.connect(otherCustomer).submitClaim(1, "Broken")).to.be.revertedWith(
        "Only the warranty owner can submit a claim"
      );
    });

    it("cannot submit a claim after the warranty expires", async function () {
      await time.increase(ONE_YEAR + ONE_DAY);
      await expect(contract.connect(customer).submitClaim(1, "Broken")).to.be.revertedWith("Warranty has expired");
    });

    it("cannot submit a second claim while one is still open", async function () {
      await contract.connect(customer).submitClaim(1, "Broken");
      await expect(contract.connect(customer).submitClaim(1, "Still broken")).to.be.revertedWith(
        "This warranty already has an open claim"
      );
    });

    it("cannot submit an empty description", async function () {
      await expect(contract.connect(customer).submitClaim(1, "")).to.be.revertedWith("Please describe the problem");
    });
  });

  describe("Service center decisions", function () {
    beforeEach(async function () {
      await issueHeadphonesWarranty();
      await contract.connect(customer).submitClaim(1, "Left speaker has no sound");
    });

    it("full happy path: SUBMITTED -> APPROVED -> REPAIRED", async function () {
      await expect(contract.connect(serviceCenter).approveClaim(1, "Manufacturing defect"))
        .to.emit(contract, "ClaimApproved")
        .withArgs(1, 1, "Manufacturing defect");
      expect((await contract.getClaim(1)).status).to.equal(APPROVED);
      // still open while waiting for repair
      expect((await contract.getWarranty(1)).hasOpenClaim).to.equal(true);

      await expect(contract.connect(serviceCenter).markRepaired(1, "Replaced left driver"))
        .to.emit(contract, "ClaimRepaired")
        .withArgs(1, 1, "Replaced left driver");

      const claim = await contract.getClaim(1);
      expect(claim.status).to.equal(REPAIRED);
      expect(claim.decisionReason).to.equal("Manufacturing defect");
      expect(claim.repairNote).to.equal("Replaced left driver");
      expect((await contract.getWarranty(1)).hasOpenClaim).to.equal(false);
    });

    it("service center can reject a claim with a reason", async function () {
      await expect(contract.connect(serviceCenter).rejectClaim(1, "Water damage is not covered"))
        .to.emit(contract, "ClaimRejected")
        .withArgs(1, 1, "Water damage is not covered");

      const claim = await contract.getClaim(1);
      expect(claim.status).to.equal(REJECTED);
      expect(claim.decisionReason).to.equal("Water damage is not covered");
      expect((await contract.getWarranty(1)).hasOpenClaim).to.equal(false);
    });

    it("customer can submit a new claim after the old one is closed", async function () {
      await contract.connect(serviceCenter).rejectClaim(1, "No defect found");
      await contract.connect(customer).submitClaim(1, "It broke again");
      expect(await contract.getClaimsByWarranty(1)).to.deep.equal([1n, 2n]);
    });

    it("reason is required when rejecting", async function () {
      await expect(contract.connect(serviceCenter).rejectClaim(1, "")).to.be.revertedWith("A reason is required");
    });

    it("shop and customer cannot make decisions", async function () {
      await expect(contract.connect(shop).approveClaim(1, "ok")).to.be.revertedWith(
        "Only the service center can do this"
      );
      await expect(contract.connect(customer).approveClaim(1, "ok")).to.be.revertedWith(
        "Only the service center can do this"
      );
      await expect(contract.connect(customer).rejectClaim(1, "no")).to.be.revertedWith(
        "Only the service center can do this"
      );
      await expect(contract.connect(customer).markRepaired(1, "fixed")).to.be.revertedWith(
        "Only the service center can do this"
      );
    });

    it("cannot mark a claim repaired before it is approved", async function () {
      await expect(contract.connect(serviceCenter).markRepaired(1, "Fixed")).to.be.revertedWith(
        "Only approved claims can be marked repaired"
      );
    });

    it("cannot approve a rejected claim", async function () {
      await contract.connect(serviceCenter).rejectClaim(1, "Not covered");
      await expect(contract.connect(serviceCenter).approveClaim(1, "Changed my mind")).to.be.revertedWith(
        "Only submitted claims can be approved"
      );
    });

    it("cannot reject an approved claim", async function () {
      await contract.connect(serviceCenter).approveClaim(1, "Defect");
      await expect(contract.connect(serviceCenter).rejectClaim(1, "Oops")).to.be.revertedWith(
        "Only submitted claims can be rejected"
      );
    });

    it("cannot change a repaired claim", async function () {
      await contract.connect(serviceCenter).approveClaim(1, "Defect");
      await contract.connect(serviceCenter).markRepaired(1, "Fixed");
      await expect(contract.connect(serviceCenter).markRepaired(1, "Fixed again")).to.be.revertedWith(
        "Only approved claims can be marked repaired"
      );
      await expect(contract.connect(serviceCenter).rejectClaim(1, "No")).to.be.revertedWith(
        "Only submitted claims can be rejected"
      );
    });

    it("cannot decide on a claim that does not exist", async function () {
      await expect(contract.connect(serviceCenter).approveClaim(99, "ok")).to.be.revertedWith("Claim does not exist");
    });
  });
  describe("Edge cases and access control", function () {
    it("rejects an empty product name or serial number", async function () {
      await expect(contract.connect(shop).registerProduct("", "SN-1")).to.be.revertedWith("Product name is required");
      await expect(contract.connect(shop).registerProduct("Phone", "")).to.be.revertedWith("Serial number is required");
    });

    it("cannot issue a warranty to the zero address, the shop or the service center", async function () {
      await contract.connect(shop).registerProduct("Phone", "SN-1");
      const expiresAt = (await time.latest()) + ONE_YEAR;
      await expect(contract.connect(shop).issueWarranty(1, ethers.ZeroAddress, expiresAt)).to.be.revertedWith(
        "Owner address is empty"
      );
      await expect(contract.connect(shop).issueWarranty(1, shop.address, expiresAt)).to.be.revertedWith(
        "Owner must be a customer"
      );
      await expect(contract.connect(shop).issueWarranty(1, serviceCenter.address, expiresAt)).to.be.revertedWith(
        "Owner must be a customer"
      );
    });

    it("cannot submit a claim on a warranty that does not exist", async function () {
      await expect(contract.connect(customer).submitClaim(1, "Broken")).to.be.revertedWith("Warranty does not exist");
    });

    it("approve needs a reason and repair needs a note", async function () {
      await issueHeadphonesWarranty();
      await contract.connect(customer).submitClaim(1, "Broken");
      await expect(contract.connect(serviceCenter).approveClaim(1, "")).to.be.revertedWith("A reason is required");
      await contract.connect(serviceCenter).approveClaim(1, "Defect");
      await expect(contract.connect(serviceCenter).markRepaired(1, "")).to.be.revertedWith("A repair note is required");
    });

    it("an approved claim still blocks a new claim until it is repaired", async function () {
      await issueHeadphonesWarranty();
      await contract.connect(customer).submitClaim(1, "Broken");
      await contract.connect(serviceCenter).approveClaim(1, "Defect");
      await expect(contract.connect(customer).submitClaim(1, "Again")).to.be.revertedWith(
        "This warranty already has an open claim"
      );
    });

    it("a claim filed before expiry can still be finished after expiry", async function () {
      const expiresAt = await issueHeadphonesWarranty();
      await contract.connect(customer).submitClaim(1, "Broken");
      await time.increaseTo(expiresAt + ONE_DAY);
      expect(await contract.isWarrantyActive(1)).to.equal(false);
      await contract.connect(serviceCenter).approveClaim(1, "Filed in time");
      await contract.connect(serviceCenter).markRepaired(1, "Fixed");
      expect((await contract.getClaim(1)).status).to.equal(REPAIRED);
    });

    it("keeps the full claim history of a warranty and lists warranties by owner", async function () {
      await issueHeadphonesWarranty();
      await contract.connect(customer).submitClaim(1, "First");
      await contract.connect(serviceCenter).rejectClaim(1, "User damage");
      await contract.connect(customer).submitClaim(1, "Second");
      expect(await contract.getClaimsByWarranty(1)).to.deep.equal([1n, 2n]);
      expect(await contract.getWarrantiesByOwner(customer.address)).to.deep.equal([1n]);
      expect(await contract.getWarrantiesByOwner(otherCustomer.address)).to.deep.equal([]);
    });

    it("view functions revert for ids that do not exist (including id 0)", async function () {
      await expect(contract.getProduct(0)).to.be.revertedWith("Product does not exist");
      await expect(contract.getWarranty(1)).to.be.revertedWith("Warranty does not exist");
      await expect(contract.getClaim(0)).to.be.revertedWith("Claim does not exist");
    });
  });
});
