// SPDX-License-Identifier: CAL
pragma solidity >=0.6.0;

import {Script} from "../lib/forge-std/src/Script.sol";

contract DiagOrder is Script {
    function run() external {
        address to = ; // put arb contract address
        address from = ;
        vm.startPrank(from);
        bytes memory data = hex"calldata"; // put calldata here without 0x
        (bool success, bytes memory result) = to.call(data);
        (success, result);
    }
}