import { ethers } from "ethers";
import fs from 'fs';
import path from 'path';
import PingPong from '../PingPong.json';
import dotenv from 'dotenv';

dotenv.config();

const contractAddress = "0xA7F42ff7433cB268dD7D59be62b00c30dEd28d3D";
const contractABI = PingPong.abi;

const pingEventHash = "0xca6e822df923f741dfe968d15d80a18abd25bd1e748bcb9ad81fea5bbb7386af";
const pongEventHash = "0x67050610046771547cf1d6e467b904ccfc523370eebc895dad1d9a73349b9804";

const providerUrl = ["https://rpc.ankr.com/eth_sepolia", "https://gateway.tenderly.co/public/sepolia", "https://eth-sepolia.api.onfinality.io/public", "https://rpc.sepolia.org"];

const provider = new ethers.providers.JsonRpcProvider(providerUrl[Math.floor(Math.random() * providerUrl.length)]);

console.log("Using provider:", provider.connection.url);

const keeper = new ethers.Wallet(process.env.PRIVATE_KEY as string, provider);

let contract = new ethers.Contract(contractAddress, contractABI, keeper);

let pingMissingPongs: string[] = [];

let pingCount = 0;
let pongCount = 0;
let pingPongCount = 0;

export const listener = async () => {

  let lastStoredBlockNumber: number;

  try {
    const filePath = path.join(__dirname, 'lastBlockNumber.json');
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(fileContent);
    lastStoredBlockNumber = data.lastBlockNumber;
    console.log("Last stored block number:", lastStoredBlockNumber);
  } catch (error) {
    console.log("No previous block number found or error reading file, generating new one");
    lastStoredBlockNumber = 0;
  }

  if (!lastStoredBlockNumber) {
    const blockNumber = await provider.getBlockNumber();
    console.log("Current block number:", blockNumber);

    const data = { lastBlockNumber: blockNumber };
    const filePath = path.join(__dirname, 'lastBlockNumber.json');

    fs.writeFile(filePath, JSON.stringify(data, null, 2), (err: any) => {
      if (err) {
        console.error('Error writing to file:', err);
      } else {
        console.log('Block number stored in lastBlockNumber.json');
      }
    });
  }

  const fetchEvents = async () => {
    const latestBlockNumber = await provider.getBlockNumber();
    console.log("Latest block number:", latestBlockNumber);

    const filePath = path.join(__dirname, 'lastBlockNumber.json');
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(fileContent);
    const fromBlock = data.lastBlockNumber;

    console.log(`Fetching events from block ${fromBlock} to ${latestBlockNumber}`);

    try {
      const events = await contract.queryFilter('*', fromBlock, latestBlockNumber);
      console.log(`Fetched ${events.length} events`);      

      // Process events here
      events.forEach(async (event) => {
        // console.log('Event:', (await event.getTransaction()).from);    
        
        // Check if the event matches the Ping event
        if (event.topics[0] === pingEventHash) {
          pingCount++;
          // console.log('Ping event detected! Finding Pong event...');
          const pongEvent = events.find((e: any) => e.data === event.transactionHash);
          if (pongEvent) {
            let account = (await pongEvent.getTransaction()).from;
            if (account === keeper.address) {
              pingPongCount++;
              // console.log('Pong event found for ping');
            }
          }
          else {
            pingMissingPongs.push(event.transactionHash);
            console.log('Ping missing pong for', event.transactionHash);
          }
          // console.log('Pong event found, skipping pong', pingEvent);
          
        }

        // Check if the event matches the Pong event
        else if (event.topics[0] === pongEventHash) {
          // console.log('Pong event detected!');
          pongCount++;
        }

      });

      console.log(`Ping count: ${pingCount}, Pong count: ${pongCount}, PingPong count: ${pingPongCount}`);
    } catch (error) {
      console.error('Error fetching events:', error);
    } finally {
      if(pingMissingPongs.length > 0) {
        checkMissingPongs();
      }
    }
  };

  // Call fetchEvents initially
  fetchEvents();

  const checkMissingPongs = async () => {
    if (pingMissingPongs.length > 0) {
      console.log("Missing pongs:", pingMissingPongs);
      console.log("Sending pong... for previous pings");
      for (let i = pingMissingPongs.length - 1; i >= 0; i--) {
        const ping = pingMissingPongs[i];
        try {
          pingMissingPongs.splice(i, 1);
          const sendPong = await contract.pong(ping);
          console.log(`Sent pong to ${sendPong.hash}`);
          await sendPong.wait(10);
          console.log(`Pong sent successfully`);
        } catch (error) {
          console.error(`Failed to send pong for ${ping}:`, error);
          pingMissingPongs.push(ping);
        } finally {
          
        }
      }
    }
  }

  const handlePing = async (event: any) => {
    let retries = 0;
    const maxRetries = 10000;
    const retryDelay = 300000;
    let gasPrice = await provider.getGasPrice();
    let nonce = await keeper.getTransactionCount("pending");

    while (retries < maxRetries) {
      try {
        console.log("Ping event received at blockHash:", event.blockHash);
        console.log("Sending pong...");
        const sendPong = await contract.pong(event.transactionHash, {
          gasPrice: gasPrice.mul(110).div(100), // Increase gas price by 10%
          nonce: nonce // Use the same nonce to replace the transaction
        });
        console.log(`Sent pong to ${sendPong.hash} for ${event.transactionHash}`);
        await sendPong.wait(10);
        console.log(`Pong sent successfully`);
        return;
      } catch (error) {
        console.error(`Failed to send pong for ${event.transactionHash}:`, error);
        if ((error as any).code === "REPLACEMENT_UNDERPRICED") {
          console.log("Transaction was underpriced. Increasing gas price and retrying...");
          nonce = await keeper.getTransactionCount("pending");
          gasPrice = gasPrice.mul(120).div(100);
          const sendPong = await contract.pong(event.transactionHash, {
            gasPrice: gasPrice, // Increase gas price by 20%
            nonce: nonce // Use the same nonce to replace the transaction
          });
          console.log(`Sent pong to ${sendPong.hash} for ${event.transactionHash}`);
          await sendPong.wait(10);
          console.log(`Pong sent successfully`);
          retries++;
          continue;
        } else if ((error as any).code === "SERVER_ERROR") {
          console.log("Server error. Retrying...");
          nonce = await keeper.getTransactionCount("pending");
          gasPrice = gasPrice.mul(120).div(100);
          const sendPong = await contract.pong(event.transactionHash, {
            gasPrice: gasPrice, // Increase gas price by 20%
            nonce: nonce, // Use the same nonce to replace the transaction
            providerUrl: providerUrl[Math.floor(Math.random() * providerUrl.length)],
          });
          console.log(`Sent pong to ${sendPong.hash} for ${event.transactionHash}`);
          await sendPong.wait(10);
          console.log(`Pong sent successfully`);
          retries++;
          continue;
        }
        retries++;
        if (retries < maxRetries) {
          console.log(`Retrying in ${retryDelay / 1000} seconds... (Attempt ${retries + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          
        }
      } finally {
        fetchEvents();
      }
    }
    console.error(`Failed to send pong after ${maxRetries} attempts. Adding to pingMissingPongs.`);
    pingMissingPongs.push(event.transactionHash);
  };

  contract.on("Ping", handlePing);

  // Reconnection logic
  const reconnect = async () => {
    console.log("Attempting to reconnect...");
    try {
      await changeProvider();
      await contract.provider.getNetwork();
     
      console.log("Reconnected successfully");
      if(pingMissingPongs.length > 0) {
        setInterval(checkMissingPongs, 10000);
      }
    } catch (error) {
      console.error("Reconnection failed, retrying in 10 seconds...");
      // Change provider if network issue
      await changeProvider();
      setTimeout(reconnect, 10000);
    }
  };

  contract.provider.on("error", (error) => {
    console.error("Provider error:", error.message);
    reconnect();
  });

  const changeProvider = async () => {
    console.log("Changing provider...");
    const newProviderUrl = providerUrl[Math.floor(Math.random() * providerUrl.length)];
    console.log(`Switching to new provider: ${newProviderUrl}`);
    const newConnection = new ethers.providers.JsonRpcProvider(newProviderUrl);
    const newKeeper = new ethers.Wallet(process.env.PRIVATE_KEY as string, newConnection);
    contract = new ethers.Contract(contractAddress, contractABI, newKeeper);
    console.log("Provider changed successfully");
  }


}



listener().then(() => {
  console.log("Listening for new blocks...");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});