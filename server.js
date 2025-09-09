import express from "express";
import fetch from "node-fetch";
import puppeteer from "puppeteer";
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
    let browser;
    try {
        const launchOptions = {
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--single-process",
                "--no-zygote"
            ]
        };
        if (chromePath) launchOptions.executablePath = chromePath;
        browser = await puppeteer.launch(launchOptions);
    } catch (e) {
        console.error('Failed to launch browser:', e);
        throw new Error(`Browser launch failed: ${e.message}`);
    }

    const page = await browser.newPage();
    await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/120 Safari/537.36"
    );

    await page.goto(mediafireUrl, { waitUntil: "domcontentloaded" });
    if (page.waitForTimeout) {
        await page.waitForTimeout(8000);
    } else {
       // await page.waitFor(8000);
    }

    let directLink = null;

    try {
        await page.waitForSelector("a#downloadButton", { timeout: 15000 });

        directLink = await page.$eval("a#downloadButton", el => {
            if (el.href && el.href !== "javascript:void(0)") {
                return el.href;
            }
            const scrambled = el.getAttribute("data-scrambled-url");
            return scrambled ? scrambled : null;
        });

        // Decode scrambled if base64
        if (directLink && !directLink.startsWith("http")) {
            try {
                const buff = Buffer.from(directLink, "base64");
                const decoded = buff.toString("utf-8");
                if (decoded.startsWith("http")) {
                    directLink = decoded;
                }
            } catch (e) {
                throw new Error("Scrambled URL decode failed");
            }
        }
    } catch (err) {
        await page.screenshot({ path: "debug.png", fullPage: true });
        await browser.close();
        throw new Error("Could not extract link. Screenshot saved to debug.png");
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
