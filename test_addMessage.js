import { chatStore } from './services/chatStore.ts';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  console.log("Triggering message send...");
  await chatStore.addMessage(
    "nosso-catalogo", 
    "629d0f3e-a72a-455a-bcbe-c370f0554949",
    "USER",
    "Teste backend evolution api send",
    false
  );
  // Wait to allow fetch to complete
  await new Promise(res => setTimeout(res, 2000));
  console.log("Done");
}
run();
