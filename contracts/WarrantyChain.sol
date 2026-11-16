// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title WarrantyChain - Product Warranty Management
/// @notice One shop issues warranties, customers submit claims,
///         and one authorized service center reviews and repairs.
contract WarrantyChain {
    // ---------------------------------------------------------------
    // Data types
    // ---------------------------------------------------------------

    // Claim lifecycle:
    // SUBMITTED -> APPROVED -> REPAIRED
    // SUBMITTED -> REJECTED
    enum ClaimStatus {
        Submitted,
        Approved,
        Rejected,
        Repaired
    }

    struct Product {
        uint256 id;
        string name;
        string serialNumber;
        bool hasWarranty;
    }

    struct Warranty {
        uint256 id;
        uint256 productId;
        address owner;
        uint256 issuedAt;
        uint256 expiresAt;
        bool hasOpenClaim; // true while a claim is SUBMITTED or APPROVED
    }

    struct Claim {
        uint256 id;
        uint256 warrantyId;
        address customer;
        string description;
        ClaimStatus status;
        string decisionReason; // why it was approved / rejected
        string repairNote; // what the service center did
        uint256 submittedAt;
        uint256 updatedAt;
    }

    // ---------------------------------------------------------------
    // State
    // ---------------------------------------------------------------

    address public shop;
    address public serviceCenter;

    uint256 public productCount;
    uint256 public warrantyCount;
    uint256 public claimCount;

    // IDs start from 1, so 0 means "does not exist"
    mapping(uint256 => Product) public products;
    mapping(uint256 => Warranty) public warranties;
    mapping(uint256 => Claim) public claims;

    mapping(string => bool) private serialNumberUsed;
    mapping(address => uint256[]) private warrantiesByOwner;
    mapping(uint256 => uint256[]) private claimsByWarranty;

    // ---------------------------------------------------------------
    // Events (these are the auditable history)
    // ---------------------------------------------------------------

    event ProductRegistered(uint256 indexed productId, string name, string serialNumber);
    event WarrantyIssued(uint256 indexed warrantyId, uint256 indexed productId, address indexed owner, uint256 expiresAt);
    event ClaimSubmitted(uint256 indexed claimId, uint256 indexed warrantyId, address indexed customer, string description);
    event ClaimApproved(uint256 indexed claimId, uint256 indexed warrantyId, string reason);
    event ClaimRejected(uint256 indexed claimId, uint256 indexed warrantyId, string reason);
    event ClaimRepaired(uint256 indexed claimId, uint256 indexed warrantyId, string repairNote);

    // ---------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------

    modifier onlyShop() {
        require(msg.sender == shop, "Only the shop can do this");
        _;
    }

    modifier onlyServiceCenter() {
        require(msg.sender == serviceCenter, "Only the service center can do this");
        _;
    }

    // ---------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------

    /// @param _serviceCenter the address of the authorized service center
    constructor(address _serviceCenter) {
        require(_serviceCenter != address(0), "Service center address is empty");
        require(_serviceCenter != msg.sender, "Shop and service center must be different");
        shop = msg.sender;
        serviceCenter = _serviceCenter;
    }

    // ---------------------------------------------------------------
    // Shop functions
    // ---------------------------------------------------------------

    function registerProduct(string memory _name, string memory _serialNumber) public onlyShop returns (uint256) {
        require(bytes(_name).length > 0, "Product name is required");
        require(bytes(_serialNumber).length > 0, "Serial number is required");
        require(!serialNumberUsed[_serialNumber], "Serial number already registered");

        productCount++;
        products[productCount] = Product(productCount, _name, _serialNumber, false);
        serialNumberUsed[_serialNumber] = true;

        emit ProductRegistered(productCount, _name, _serialNumber);
        return productCount;
    }

    /// @param _expiresAt unix timestamp (seconds) when the warranty ends
    function issueWarranty(uint256 _productId, address _owner, uint256 _expiresAt) public onlyShop returns (uint256) {
        require(_productId > 0 && _productId <= productCount, "Product does not exist");
        require(!products[_productId].hasWarranty, "Product already has a warranty");
        require(_owner != address(0), "Owner address is empty");
        require(_owner != shop && _owner != serviceCenter, "Owner must be a customer");
        require(_expiresAt > block.timestamp, "Expiry date must be in the future");

        warrantyCount++;
        warranties[warrantyCount] = Warranty(warrantyCount, _productId, _owner, block.timestamp, _expiresAt, false);
        products[_productId].hasWarranty = true;
        warrantiesByOwner[_owner].push(warrantyCount);

        emit WarrantyIssued(warrantyCount, _productId, _owner, _expiresAt);
        return warrantyCount;
    }

    // ---------------------------------------------------------------
    // Customer functions
    // ---------------------------------------------------------------

    function submitClaim(uint256 _warrantyId, string memory _description) public returns (uint256) {
        require(_warrantyId > 0 && _warrantyId <= warrantyCount, "Warranty does not exist");

        Warranty storage w = warranties[_warrantyId];
        require(msg.sender == w.owner, "Only the warranty owner can submit a claim");
        require(isWarrantyActive(_warrantyId), "Warranty has expired");
        require(!w.hasOpenClaim, "This warranty already has an open claim");
        require(bytes(_description).length > 0, "Please describe the problem");

        claimCount++;
        claims[claimCount] = Claim(
            claimCount,
            _warrantyId,
            msg.sender,
            _description,
            ClaimStatus.Submitted,
            "",
            "",
            block.timestamp,
            block.timestamp
        );
        w.hasOpenClaim = true;
        claimsByWarranty[_warrantyId].push(claimCount);

        emit ClaimSubmitted(claimCount, _warrantyId, msg.sender, _description);
        return claimCount;
    }

    // ---------------------------------------------------------------
    // Service center functions
    // ---------------------------------------------------------------

    function approveClaim(uint256 _claimId, string memory _reason) public onlyServiceCenter {
        Claim storage c = getExistingClaim(_claimId);
        require(c.status == ClaimStatus.Submitted, "Only submitted claims can be approved");
        require(bytes(_reason).length > 0, "A reason is required");

        c.status = ClaimStatus.Approved;
        c.decisionReason = _reason;
        c.updatedAt = block.timestamp;
        // the claim is still open until the repair is done

        emit ClaimApproved(_claimId, c.warrantyId, _reason);
    }

    function rejectClaim(uint256 _claimId, string memory _reason) public onlyServiceCenter {
        Claim storage c = getExistingClaim(_claimId);
        require(c.status == ClaimStatus.Submitted, "Only submitted claims can be rejected");
        require(bytes(_reason).length > 0, "A reason is required");

        c.status = ClaimStatus.Rejected;
        c.decisionReason = _reason;
        c.updatedAt = block.timestamp;
        warranties[c.warrantyId].hasOpenClaim = false;

        emit ClaimRejected(_claimId, c.warrantyId, _reason);
    }

    function markRepaired(uint256 _claimId, string memory _repairNote) public onlyServiceCenter {
        Claim storage c = getExistingClaim(_claimId);
        require(c.status == ClaimStatus.Approved, "Only approved claims can be marked repaired");
        require(bytes(_repairNote).length > 0, "A repair note is required");

        c.status = ClaimStatus.Repaired;
        c.repairNote = _repairNote;
        c.updatedAt = block.timestamp;
        warranties[c.warrantyId].hasOpenClaim = false;

        emit ClaimRepaired(_claimId, c.warrantyId, _repairNote);
    }

    // ---------------------------------------------------------------
    // View functions
    // ---------------------------------------------------------------

    function isWarrantyActive(uint256 _warrantyId) public view returns (bool) {
        require(_warrantyId > 0 && _warrantyId <= warrantyCount, "Warranty does not exist");
        return block.timestamp <= warranties[_warrantyId].expiresAt;
    }

    function getProduct(uint256 _productId) public view returns (Product memory) {
        require(_productId > 0 && _productId <= productCount, "Product does not exist");
        return products[_productId];
    }

    function getWarranty(uint256 _warrantyId) public view returns (Warranty memory) {
        require(_warrantyId > 0 && _warrantyId <= warrantyCount, "Warranty does not exist");
        return warranties[_warrantyId];
    }

    function getClaim(uint256 _claimId) public view returns (Claim memory) {
        return getExistingClaim(_claimId);
    }

    function getWarrantiesByOwner(address _owner) public view returns (uint256[] memory) {
        return warrantiesByOwner[_owner];
    }

    function getClaimsByWarranty(uint256 _warrantyId) public view returns (uint256[] memory) {
        return claimsByWarranty[_warrantyId];
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    function getExistingClaim(uint256 _claimId) internal view returns (Claim storage) {
        require(_claimId > 0 && _claimId <= claimCount, "Claim does not exist");
        return claims[_claimId];
    }
}
