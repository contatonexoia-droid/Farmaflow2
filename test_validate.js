import fetch from 'node-fetch';

async function run() {
  const response = await fetch("http://localhost:3000/api/v1/integration/validate-token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ token: "FF-36E834", machineId: "unknown" })
  });
  
  const text = await response.text();
  console.log("Response:", text);
}
run();
