"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BeckBrowser = void 0;
const puppeteer_1 = __importDefault(require("puppeteer"));
const dotenv = __importStar(require("dotenv"));
dotenv.config();
class BeckBrowser {
    constructor() {
        this.browser = null;
        this.page = null;
        this.authCookie = null;
        this.isAuthenticated = false;
    }
    static getInstance() {
        if (!BeckBrowser.instance) {
            BeckBrowser.instance = new BeckBrowser();
        }
        return BeckBrowser.instance;
    }
    async init() {
        if (this.browser)
            return;
        console.error('[BeckBrowser] Launching browser...');
        this.browser = await puppeteer_1.default.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        this.page = await this.browser.newPage();
        // Set a realistic User-Agent
        await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    }
    async login() {
        if (this.isAuthenticated && this.authCookie)
            return;
        if (!this.page)
            await this.init();
        if (!this.page)
            throw new Error('Browser not initialized');
        const username = process.env.BECK_USERNAME;
        const password = process.env.BECK_PASSWORD;
        if (!username || !password) {
            throw new Error('BECK_USERNAME and BECK_PASSWORD environment variables must be set.');
        }
        console.error('[BeckBrowser] Starting OIDC Login Flow...');
        try {
            await this.page.goto('https://beck-online.beck.de/Konto/IdentityProviderLogin', { waitUntil: 'networkidle2' });
            if (this.page.url().includes('account.beck.de/Login')) {
                console.error('[BeckBrowser] Submitting credentials...');
                await this.page.type('input[name="Input.Username"]', username);
                await this.page.type('input[name="Input.Password"]', password);
                // Find and click submit in the correct form
                await this.page.evaluate(() => {
                    const usernameInput = document.querySelector('input[name="Input.Username"]');
                    const form = usernameInput?.closest('form');
                    const button = form?.querySelector('button[type="submit"]');
                    if (button instanceof HTMLElement)
                        button.click();
                    else
                        throw new Error('Login button not found');
                });
                await this.page.waitForNavigation({ waitUntil: 'networkidle2' });
                // Handle potential intermediate redirects
                if (!this.page.url().includes('beck-online.beck.de')) {
                    console.error('[BeckBrowser] Waiting for redirects...');
                    try {
                        await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });
                    }
                    catch (e) {
                        // Timeout is fine if we are already where we need to be
                    }
                }
                if (this.page.url().includes('beck-online.beck.de')) {
                    const cookies = await this.page.cookies();
                    this.authCookie = cookies.find(c => c.name === 'beck-online.auth') || null;
                    if (this.authCookie) {
                        console.error('[BeckBrowser] Successfully authenticated.');
                        this.isAuthenticated = true;
                    }
                    else {
                        throw new Error('Login failed: Auth cookie not found after redirect.');
                    }
                }
                else {
                    const body = await this.page.evaluate(() => document.body.innerText);
                    throw new Error(`Login failed: Stuck at ${this.page.url()} - ${body.substring(0, 100)}`);
                }
            }
            else {
                // Already logged in?
                if (this.page.url().includes('beck-online.beck.de')) {
                    console.error('[BeckBrowser] Already logged in.');
                    this.isAuthenticated = true;
                }
                else {
                    throw new Error(`Unexpected login start page: ${this.page.url()}`);
                }
            }
        }
        catch (error) {
            console.error('[BeckBrowser] Login Error:', error);
            throw error;
        }
    }
    async fetchPage(url) {
        if (!this.page)
            await this.init();
        if (!this.isAuthenticated)
            await this.login();
        if (!this.page)
            throw new Error('Browser not ready');
        // Handle relative URLs
        if (url.startsWith('/')) {
            url = `https://beck-online.beck.de${url}`;
        }
        console.error(`[BeckBrowser] Fetching: ${url}`);
        await this.page.goto(url, { waitUntil: 'domcontentloaded' });
        // Wait specifically for content to prevent empty results
        // .treffer-wrapper for search, .paragr for documents
        // But don't fail if they aren't there (e.g. 0 results)
        try {
            await this.page.waitForSelector('.treffer-wrapper, .paragr, .satz', { timeout: 2000 });
        }
        catch (e) {
            // Ignore timeout
        }
        return await this.page.content();
    }
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
            this.isAuthenticated = false;
        }
    }
    getCurrentUrl() {
        return this.page ? this.page.url() : '';
    }
}
exports.BeckBrowser = BeckBrowser;
