async function testSearchEngines() {
  const ean = "7891058019488";
  const name = "Neosaldina";
  const query = `"${ean}" ${name}`;

  // 1. Bing
  try {
    const bingUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`;
    const res = await fetch(bingUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9"
      }
    });
    console.log("Bing status:", res.status);
    const html = await res.text();
    const regex = /(?:murl|imgurl)&quot;:&quot;(https?:[^&"]+)&quot;/gi;
    const matches = [];
    let m;
    while ((m = regex.exec(html)) !== null) {
      matches.push(decodeURIComponent(m[1]));
    }
    console.log("Bing murls found:", matches.length, matches.slice(0, 3));
    if (matches.length === 0) {
      const imgRegex = /https?:\/\/[a-zA-Z0-9_\-\.]+\/[^"'\s<>\\]+\.(?:jpg|png|webp|jpeg)/gi;
      const cdnMatches = [];
      while ((m = imgRegex.exec(html)) !== null) {
        const u = m[0];
        if (!u.includes("bing.com") && !u.includes("microsoft.com") && !u.includes("schema.org") && !u.includes("w3.org")) {
          cdnMatches.push(u);
        }
      }
      console.log("Bing fallback images:", cdnMatches.slice(0, 3));
    }
  } catch (e) {
    console.log("Bing error:", e.message);
  }
}
testSearchEngines();
