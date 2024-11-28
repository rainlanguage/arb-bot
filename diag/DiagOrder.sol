// SPDX-License-Identifier: CAL
pragma solidity >=0.6.0;

import {Script} from "../lib/forge-std/src/Script.sol";

contract DiagOrder is Script {
    function run() external {
        vm.createSelectFork(""); // rpc url
        vm.rollFork(); // block number
        address to = ; // put arb contract address
        address from = ; // sender address
        bytes memory data = hex""; // put calldata here without 0x

        vm.startPrank(from);
        (bool success, bytes memory result) = to.call(data);
        (success, result);
    }
}