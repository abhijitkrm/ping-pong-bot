/**
 *Submitted for verification at Etherscan.io on 2024-02-07
*/

// SPDX-License-Identifier: GPL-3.0
/**
 *  @authors: [@mtsalenc, @salgozino]
 *  @reviewers: []
 *  @auditors: []
 *  @bounties: []
 *  @deployments: []
 */

pragma solidity ^0.8.0;

/**
 * @title PingPong
 * @dev Exercise on syncing and transaction submission.
 */
contract PingPong {

    address public pinger;

    constructor() {
        pinger = msg.sender;
    }

    event Ping();
    event Pong(bytes32 txHash);
    event NewPinger(address pinger);

    function ping() external {
        require(msg.sender == pinger, "Only the pinger can call this.");

        emit Ping();
    }

    function pong(bytes32 _txHash) external {
        emit Pong(_txHash);
    }

    function changePinger(address _pinger) external {
        require(msg.sender == pinger, "Only the pinger can call this.");
        pinger = _pinger;

        emit NewPinger(pinger);
    }
}