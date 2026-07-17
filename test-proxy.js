const url = 'https://cdn-cosmos.bluesoft.com.br/products/7896658000805';

async function test() {
    const r5 = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }});
    console.log("Googlebot:", r5.status);
    
    // axios? node-fetch?
    
}
test();
