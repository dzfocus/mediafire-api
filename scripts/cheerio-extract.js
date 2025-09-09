import axios from 'axios';
import cheerio from 'cheerio';

async function tryExtract(url) {
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' };
  const res = await axios.get(url, { headers, timeout: 20000 });
  const $ = cheerio.load(res.data);

  // Common selectors
  const selList = ['#downloadButton', '.dlButton', 'a[aria-label="Download"]', 'a.dlButton'];
  for (const s of selList) {
    const el = $(s).first();
    if (el && el.length) {
      let href = el.attr('href') || el.attr('data-scrambled-url') || el.attr('data-url');
      if (href) {
        if (!href.startsWith('http')) {
          // try base64 decode
          try {
            const buff = Buffer.from(href, 'base64');
            const decoded = buff.toString('utf8');
            if (decoded.startsWith('http')) href = decoded;
          } catch (e) {}
        }
        if (href && href.startsWith('http')) return href;
      }
    }
  }

  // Look for anchors with /d/ or typical file extensions
  const anchors = $('a').map((i, a) => $(a).attr('href')).get().filter(Boolean);
  let candidate = anchors.find(u => /https?:\/\/.+\/d\//i.test(u));
  if (candidate) return candidate;
  candidate = anchors.find(u => /https?:\/\/.+\.(zip|mp4|mp3|mkv|jpg|png|pdf)/i.test(u));
  if (candidate) return candidate;

  // Some MediaFire pages embed the link in scripts - try simple regex
  const body = res.data;
    const m = body.match(/(https?:\/\/(?:download|download\.mediafire)[^"'<>\s]+)/i) || body.match(/(https?:\/\/(?:download|download\.mediafire)[^"'<>\s]+)/i);
  if (m && m[1]) return m[1];

  return null;
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node scripts/cheerio-extract.js <mediafire-url>');
    process.exit(2);
  }

  try {
    const link = await tryExtract(url);
    if (link) {
      console.log(JSON.stringify({ success: true, directLink: link }));
      process.exit(0);
    } else {
      console.log(JSON.stringify({ success: false, error: 'No link found (cheerio fallback)' }));
      process.exit(0);
    }
  } catch (err) {
    console.log(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || !process.env.JEST_WORKER_ID) {
  main();
}
