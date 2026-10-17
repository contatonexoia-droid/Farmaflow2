const fs = require('fs');

async function checkBing() {
  const q = '7897947610408';
  const res = await fetch(`https://www.bing.com/images/search?q=${encodeURIComponent(q)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9'
    }
  });
  const html = await res.text();
  console.log('Bing html length:', html.length);
  const regex = /https?:\/\/[a-zA-Z0-9_\-\.]+\/[^"'\s<>\\]+\.(?:jpg|png|webp|jpeg)/gi;
  const urls = [];
  let m;
  while ((m = regex.exec(html)) !== null) {
    if (!m[0].includes('bing.com') && !m[0].includes('microsoft.com')) {
      urls.push(m[0]);
    }
  }
  console.log('Non-bing image urls:', [...new Set(urls)].slice(0, 5));
}

checkBing();
