// SPDX-License-Identifier: CAL
pragma solidity >=0.6.0;

import {Script} from "path/to/forge-std/Script.sol"; // put the path to forge-std/Script.sol

contract DiagOrder is Script {
    function run() external {
        address to = arb_contract_address; // put arb contract address
        bytes memory data = hex"calldata"; // put calldata here without 0x
        (bool success, bytes memory result) = to.call(data);
        (success, result);
    }
}