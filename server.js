import express from "express";
import fetch from "node-fetch";
import puppeteer from "puppeteer";
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { execSync } from "child_process";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

// Find Chrome executable
function findChrome() {
    const paths = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser'
    ].filter(Boolean); // Remove undefined entries

    console.log('Searching for Chrome in paths:', paths);
    
    for (const path of paths) {
        if (fs.existsSync(path)) {
            try {
                // Try to execute Chrome --version
                const version = execSync(`${path} --version`).toString();
                console.log(`Found Chrome at ${path}, version: ${version.trim()}`);
                return path;
            } catch (e) {
                console.log(`Chrome at ${path} exists but may not be executable:`, e.message);
            }
        } else {
            console.log(`Chrome not found at ${path}`);
        }
    }
    console.warn('No usable Chrome installation found, continuing without explicit executablePath');
    return null;
}

const chromePath = findChrome();
console.log(`Selected Chrome path: ${chromePath}`);

/**
 * Extract direct MediaFire download link
 */
async function getDirectLink(mediafireUrl) {
    console.log('Launching browser with Chrome at:', chromePath);
    // Use puppeteer-extra with stealth to reduce bot detection
    puppeteerExtra.use(StealthPlugin());
    let browser;
    try {
        const launchOptions = {
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--single-process",
                "--no-zygote",
                "--disable-gpu",
                "--window-size=1280,800"
            ]
        };
        if (chromePath) launchOptions.executablePath = chromePath;
        // prefer puppeteer-extra launcher
        browser = await puppeteerExtra.launch(launchOptions);
    } catch (e) {
        console.error('Failed to launch browser:', e);
        throw new Error(`Browser launch failed: ${e.message}`);
    }

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/120 Safari/537.36"
    );

    // increase default timeouts for slow environments
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(60000);

    // Try to load the page; prefer loading DOM and then wait for the download button explicitly
    try {
        await page.goto(mediafireUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (e) {
        console.warn('domcontentloaded failed, will still attempt to continue:', e.message);
    }

    // give JS time to render
    await new Promise((r) => setTimeout(r, 4000));

    let directLink = null;

    // Try multiple selector strategies
    const selectors = [
        'a#downloadButton',
        'a.dlButton',
        'a[aria-label="Download"]',
        'a[role="button"][href]',
        'a[href*="/d/"]',
        'a[href*="download"]'
    ];

    for (const sel of selectors) {
        try {
            const el = await page.$(sel);
            if (!el) continue;

            // Try to get href or data attribute
            const href = await page.$eval(sel, e => e.href || e.getAttribute('data-scrambled-url') || e.getAttribute('href'));
            if (href && href.startsWith('http')) {
                directLink = href;
                console.log('Found direct link via selector', sel, directLink);
                break;
            }

            // If href isn't direct, try click flow and wait for selector/redirect
            console.log('Clicking selector to trigger download/navigation:', sel);
            await page.click(sel).catch(() => {});
            // wait briefly for potential redirect or new button
            await new Promise((r) => setTimeout(r, 3000));
            // also try waiting for a direct download button to appear
            try {
                await page.waitForSelector('a#downloadButton', { timeout: 10000 });
            } catch {}

            // After click, check current URL or look for a redirect link
            const current = page.url();
            if (current && current.startsWith('http') && !current.includes('mediafire.com/folder')) {
                directLink = current;
                console.log('Found direct link after click (page.url):', directLink);
                break;
            }

            // Try to find any anchor that looks like a file link
            const possible = await page.$$eval('a', as => as.map(a => a.href).filter(Boolean));
            const candidate = possible.find(u => /https?:\/\/.+\.(zip|mp4|mp3|mkv|jpg|png|pdf)/i.test(u));
            if (candidate) {
                directLink = candidate;
                console.log('Found candidate file link on page:', candidate);
                break;
            }
        } catch (e) {
            console.warn('Selector check failed for', sel, e.message);
        }
    }

    // Meta refresh fallback
    if (!directLink) {
        try {
            const meta = await page.$eval('meta[http-equiv="refresh"]', el => el.getAttribute('content'));
            if (meta) {
                const m = meta.match(/url=(.+)/i);
                if (m) {
                    directLink = m[1];
                    console.log('Found link via meta refresh:', directLink);
                }
            }
        } catch (e) {
            // ignore
        }
    }

    // Decode scrambled if base64
    if (directLink && !directLink.startsWith('http')) {
        try {
            const buff = Buffer.from(directLink, 'base64');
            const decoded = buff.toString('utf-8');
            if (decoded.startsWith('http')) directLink = decoded;
        } catch (e) {
            console.warn('Scrambled URL decode failed:', e.message);
        }
    }

    if (!directLink) {
        await page.screenshot({ path: 'debug.png', fullPage: true });
        await browser.close();
        throw new Error('Could not extract link. Screenshot saved to debug.png');
    }

    await browser.close();
    return directLink;
}


/**
 * GET /getlink?url=...
 * Returns resolved direct MediaFire link
 */
app.get("/getlink", async (req, res) => {
    const url = req.query.url;
    if (!url) return res.json({ success: false, error: "No URL provided" });

    try {
        const directLink = await getDirectLink(url);
        res.json({ success: true, directLink });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

/**
 * GET /stream?url=...
 * Streams MediaFire file with Range support
 */
app.get("/stream", async (req, res) => {
    const mediafireUrl = req.query.url;
    if (!mediafireUrl) {
        return res.status(400).send("No URL provided");
    }

    try {
        const directLink = await getDirectLink(mediafireUrl);

        // Forward Range headers (for seeking in videos)
        const headers = {};
        if (req.headers.range) {
            headers["Range"] = req.headers.range;
        }

        const response = await fetch(directLink, { headers });

        res.writeHead(response.status, {
            "Content-Type": response.headers.get("content-type") || "application/octet-stream",
            "Content-Length": response.headers.get("content-length"),
            "Accept-Ranges": response.headers.get("accept-ranges") || "bytes",
            "Content-Range": response.headers.get("content-range") || ""
        });

        response.body.pipe(res);

    } catch (err) {
        res.status(500).send("Error streaming: " + err.message);
    }
});

// Simple health endpoint for Render
app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});

// Chrome path is verified at startup

app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server running at http://0.0.0.0:${PORT}`);
});
