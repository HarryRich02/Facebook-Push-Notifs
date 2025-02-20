require("dotenv").config();
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const axios = require("axios");
const fs = require("fs");

puppeteer.use(StealthPlugin());

const FACEBOOK_URL = "https://www.facebook.com";
const NOTIFICATIONS_URL = "https://www.facebook.com/notifications";
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const COOKIES_FILE = "cookies.json";  // File to save cookies
const LOCAL_STORAGE_FILE = "localStorage.json"; // File to save localStorage

let lastNotification = null;

async function saveSession(page) {
    // Save cookies to a file
    const cookies = await page.cookies();
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies));

    // Save localStorage to a file
    const localStorageData = await page.evaluate(() => {
        return Object.entries(localStorage).map(([key, value]) => ({ key, value }));
    });
    fs.writeFileSync(LOCAL_STORAGE_FILE, JSON.stringify(localStorageData));

    console.log("Session saved.");
}

async function loadSession(page) {
    // Load cookies from file
    if (fs.existsSync(COOKIES_FILE)) {
        const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf8"));
        await page.setCookie(...cookies);
        console.log("Cookies loaded.");
    }

    // Load localStorage from file
    if (fs.existsSync(LOCAL_STORAGE_FILE)) {
        const localStorageData = JSON.parse(fs.readFileSync(LOCAL_STORAGE_FILE, "utf8"));
        await page.evaluate((data) => {
            data.forEach(({ key, value }) => {
                localStorage.setItem(key, value);
            });
        }, localStorageData);
        console.log("LocalStorage loaded.");
    }
}

async function checkFacebookNotifications() {
    const browser = await puppeteer.launch({
        headless: false,  // Set to 'false' for debugging with GUI
        executablePath: "/usr/bin/chromium-browser",
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
        ],
    });

    try {
        const page = await browser.newPage();

        // Load session if available (cookies & localStorage)
        await loadSession(page);

        // Go to Facebook login page if session is not available
        if (!(fs.existsSync(COOKIES_FILE) && fs.existsSync(LOCAL_STORAGE_FILE))) {
            await page.goto(FACEBOOK_URL, { waitUntil: "networkidle2" });

            // Wait for the Decline Optional Cookies button and click it
            try {
                await page.waitForSelector('div[aria-label="Decline optional cookies"]', { timeout: 5000 });
                await page.click('div[aria-label="Decline optional cookies"]');
                console.log("Declined optional cookies.");
            } catch (error) {
                console.log("No cookie popup detected or no decline option found.");
            }

            // Log in manually if no session
            await page.type("#email", process.env.FB_EMAIL, { delay: 50 });
            await page.type("#pass", process.env.FB_PASSWORD, { delay: 50 });
            await page.click("[name='login']");
            await page.waitForNavigation({ waitUntil: "networkidle2" });
            console.log("Logged in");

            // Save session (cookies & localStorage) after login
            await saveSession(page);
        }

        // Go to Notifications page
        await page.goto(NOTIFICATIONS_URL, { waitUntil: "networkidle2" });

        // Wait for notifications to load
        await page.waitForSelector('[role="listitem"]');

        // Get the latest notification text
        const latestNotification = await page.evaluate(() => {
            const notification = document.querySelector('[role="listitem"]');
            return notification ? notification.innerText : null;
        });

        // If there's a new notification, send it to Discord
        if (latestNotification && latestNotification !== lastNotification) {
            console.log("New notification detected:", latestNotification);

            await axios.post(DISCORD_WEBHOOK, {
                content: `🔔 **New Facebook Notification!**\n${latestNotification}`
            });

            lastNotification = latestNotification;
        }

    } catch (error) {
        console.error("Error checking Facebook:", error);
        await axios.post(DISCORD_WEBHOOK, {
            content: `❌ **Error Checking Notifications**\n${error}`
        });
    } finally {
        await browser.close();
    }
}

// Run the script every 5 minutes
setInterval(checkFacebookNotifications, 5 * 60 * 1000);
console.log("Facebook notification watcher started...");