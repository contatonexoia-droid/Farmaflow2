import fetch from "node-fetch";

async function test() {
  const payload = {
    tenantId: "drogaria-fantasia-nosso-catalogo",
    customerAddress: "avenida independência 100 unamar, cabo frio - rio de janeiro",
    orderTotal: 50.00
  };

  console.log("Sending POST to /api/checkout/delivery-fee with payload:", payload);

  try {
    const res = await fetch("http://localhost:3000/api/checkout/delivery-fee", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    console.log("Response Status:", res.status);
    const data = await res.json();
    console.log("Response Data:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Fetch failed:", err);
  }
}

test();
