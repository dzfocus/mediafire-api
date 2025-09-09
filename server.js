import express from "express";
import fetch from "node-fetch";
import puppeteer from "puppeteer";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * Extract direct MediaFire download link
 */
async function getDirectLink(mediafireUrl) {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--single-process",
            "--no-zygote"
        ]
    });

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

// If PUPPETEER_EXECUTABLE_PATH not set, try common container paths
if (!process.env.PUPPETEER_EXECUTABLE_PATH) {
    const possible = [
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome"
    ];
    for (const p of possible) {
        try {
            if (fs.existsSync(p)) {
                process.env.PUPPETEER_EXECUTABLE_PATH = p;
                console.log(`Using Chrome executable: ${p}`);
                break;
            }
        } catch (e) {
            // ignore
        }
    }
}

// Ensure Puppeteer cache dir points to Render's cache when available
if (!process.env.PUPPETEER_CACHE_DIR) {
    const renderCache = "/opt/render/.cache/puppeteer";
    try {
        if (fs.existsSync(renderCache)) {
            process.env.PUPPETEER_CACHE_DIR = renderCache;
            console.log(`Using Puppeteer cache dir: ${renderCache}`);
        }
    } catch (e) {
        // ignore
    }
}

app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server running at http://0.0.0.0:${PORT}`);
});
