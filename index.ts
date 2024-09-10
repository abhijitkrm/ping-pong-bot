import { listener } from "./src/listener";

async function main() {
    listener();
}

main().then(() => {
    console.log("Listening for new blocks...");
}).
catch((error) => {
    console.error(error);
    process.exit(1);
});