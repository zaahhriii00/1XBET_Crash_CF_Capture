const puppeteer = require("puppeteer-extra");
const launch = require("./launch");
const fs = require('fs');
const { format, subHours } = require('date-fns');
const wait = (ms) => new Promise(res => setTimeout(res, ms));

// Get WebSocket endpoint
async function getWsEndpoint() {
    console.log("Launching browser...");
    let wsEndpoint = await launch();
    console.log("WebSocket endpoint obtained:", wsEndpoint);
    return wsEndpoint;
}

// Function to scrape the div data from the iframe
async function scrapeDivData(page) {
    // Attendre que l'iframe soit chargé
    await page.waitForSelector('iframe.games-project-frame__item');

    // Obtenir l'iframe
    const frame = page.frames().find(f => f.url().includes('/games-frame/games/371'));

    if (!frame) {
        console.error("Iframe non trouvé");
        return { totalPlayers: 'N/A', totalBets: 'N/A', totalPrize: 'N/A' };
    }

    // Attendre que le contenu de l'iframe soit chargé
    await frame.waitForSelector('.crash-total__value--players', { timeout: 10000 });

    const data = await frame.evaluate(() => {
        function safeGetText(selector) {
            const element = document.querySelector(selector);
            return element ? element.innerText : 'N/A';
        }

        const totalPlayers = safeGetText('.crash-total__value--players');
        const totalBets = safeGetText('.crash-total__value--bets');
        const totalPrize = safeGetText('.crash-total__value--prize');

        return {
            totalPlayers,
            totalBets,
            totalPrize
        };
    });

    return data;
}

(async () => {
    console.log("Starting script...");

    const browserWSEndpoint = await getWsEndpoint();
    console.log("Connecting to browser with WebSocket endpoint...");
    const browser = await puppeteer.connect({
        browserWSEndpoint,
        defaultViewport: null,
    });

    console.log("Opening new page...");
    let page = await browser.newPage();
    console.log("Navigating to the URL...");
    await page.goto("https://1xbet.com/en/allgamesentrance/crash", { waitUntil: 'networkidle0' });

    // Attendez que l'iframe soit chargé
    await page.waitForSelector('iframe.games-project-frame__item');

    const client = await page.target().createCDPSession();

    console.log("Enabling Network...");
    await client.send('Network.enable');

    client.on('Network.webSocketFrameReceived', async ({ requestId, timestamp, response }) => {
        console.log("↑↑↑↑↑");
        let payloadString = response.payloadData.toString('utf8');
    
        try {
            // Remove non-printable characters
            payloadString = payloadString.replace(/[^\x20-\x7E]/g, '');
            const payload = JSON.parse(payloadString);
            
            // Check if payload is of the correct type and target
            if (payload.type === 1 && payload.target === "OnCrash") {
                const { l, f, ts } = payload.arguments[0];
                console.log(payload.arguments);

                const date = new Date(ts);
                const dateMinusOneHour = subHours(date, 1);
                const formattedTime = format(dateMinusOneHour, 'HH:mm');

                // Scrape the div data
                let scrapedData;
                try {
                    scrapedData = await scrapeDivData(page);
                    console.log("Scraped Data:", scrapedData);
                } catch (scrapeError) {
                    console.error("Error scraping data:", scrapeError);
                    scrapedData = { totalPlayers: 'N/A', totalBets: 'N/A', totalPrize: 'N/A' };
                }

                const csvData = `${formattedTime},${scrapedData.totalPlayers},${scrapedData.totalBets},${f},${scrapedData.totalPrize},${l}\n`;
                const txtData = `${f}\n`;
                console.log("❌");
                
                // Append to CSV
                fs.appendFile('data.csv', csvData, (err) => {
                    if (err) throw err;
                    console.log('Data appended to CSV file');
                });

                // Append to TXT
                fs.appendFile('data.txt', txtData, (err) => {
                    if (err) throw err;
                    console.log('❌❌', txtData, '❌❌');
                });
            }
        } catch (error) {
            console.error('Error processing WebSocket frame:', error);
        }
    });

    console.log("Starting main loop...");
    while (true) {
        await wait(1000);
    }
})();
