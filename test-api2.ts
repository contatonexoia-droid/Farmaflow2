import fetch from "node-fetch";

async function run() {
  const res = await fetch("http://localhost:3000/api/v1/tenants/nosso-catalogo/vouchers?networkId=undefined");
  console.log("Status:", res.status);
  console.log("Body:", await res.text());
}
run();
