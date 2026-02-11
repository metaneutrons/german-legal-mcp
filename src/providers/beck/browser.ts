import puppeteer, { Browser, Page, Cookie } from 'puppeteer';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

dotenv.config();

export class BeckBrowser {
    private static instance: BeckBrowser;
    private browser: Browser | null = null;
    private page: Page | null = null;
    private authCookie: Cookie | null = null;
    private isAuthenticated: boolean = false;
    private readonly COOKIE_PATH = path.join(os.homedir(), '.beck-online-mcp', 'cookies.json');

    private constructor() {}

    public static getInstance(): BeckBrowser {
        if (!BeckBrowser.instance) {
            BeckBrowser.instance = new BeckBrowser();
        }
        return BeckBrowser.instance;
    }

    private async saveSession(cookies: Cookie[]) {
        try {
            const dir = path.dirname(this.COOKIE_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.COOKIE_PATH, JSON.stringify(cookies, null, 2));
            console.error(`[BeckBrowser] Session saved to ${this.COOKIE_PATH}`);
        } catch (e) {
            console.error('[BeckBrowser] Failed to save session:', e);
        }
    }

    private async loadSession(): Promise<boolean> {
        try {
            if (fs.existsSync(this.COOKIE_PATH)) {
                const data = fs.readFileSync(this.COOKIE_PATH, 'utf-8');
                const cookies = JSON.parse(data) as Cookie[];
                
                // Check if auth cookie exists and is not expired
                const auth = cookies.find(c => c.name === 'beck-online.auth');
                if (!auth) return false;
                
                if (auth.expires && auth.expires !== -1 && auth.expires < Date.now() / 1000) {
                    console.error('[BeckBrowser] Saved session expired.');
                    return false;
                }

                if (this.page) {
                    await this.page.setCookie(...cookies);
                    this.authCookie = auth;
                    this.isAuthenticated = true;
                    console.error('[BeckBrowser] Session loaded from disk.');
                    return true;
                }
            }
        } catch (e) {
            console.error('[BeckBrowser] Failed to load session:', e);
        }
        return false;
    }


    public async init(): Promise<void> {
        if (this.browser) return;

        console.error('[BeckBrowser] Launching browser...');
        this.browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        this.page = await this.browser.newPage();
        
        await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Attempt to restore session
        await this.loadSession();
    }

    public async login(): Promise<void> {
        if (!this.page) await this.init();
        if (!this.page) throw new Error('Browser not initialized');

        // Verify session validity if we loaded one
        if (this.isAuthenticated) {
            console.error('[BeckBrowser] Verifying session...');
            try {
                // Quick check: Go to home. If we stay there and have the cookie, we are good.
                await this.page.goto('https://beck-online.beck.de/Home', { waitUntil: 'domcontentloaded' });
                const cookies = await this.page.cookies();
                if (cookies.find(c => c.name === 'beck-online.auth')) {
                    console.error('[BeckBrowser] Session is valid.');
                    return;
                }
                console.error('[BeckBrowser] Session invalid, re-authenticating...');
                this.isAuthenticated = false;
            } catch (_e) {
                // Session check failed
                this.isAuthenticated = false;
            }
        }

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

                await this.page.evaluate(() => {
                    const usernameInput = document.querySelector('input[name="Input.Username"]');
                    const form = usernameInput?.closest('form');
                    const button = form?.querySelector('button[type="submit"]');
                    if (button instanceof HTMLElement) button.click();
                    else throw new Error('Login button not found');
                });

                await this.page.waitForNavigation({ waitUntil: 'networkidle2' });

                if (!this.page.url().includes('beck-online.beck.de')) {
                    console.error('[BeckBrowser] Waiting for redirects...');
                    try {
                        await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });
                    } catch (_e) { 
                        // Ignore timeout
                    }
                }

                if (this.page.url().includes('beck-online.beck.de')) {
                    const cookies = await this.page.cookies();
                    this.authCookie = cookies.find(c => c.name === 'beck-online.auth') || null;
                    
                    if (this.authCookie) {
                        console.error('[BeckBrowser] Successfully authenticated.');
                        this.isAuthenticated = true;
                        await this.saveSession(cookies);
                    } else {
                        throw new Error('Login failed: Auth cookie not found after redirect.');
                    }
                } else {
                    const body = await this.page.evaluate(() => document.body.innerText);
                    throw new Error(`Login failed: Stuck at ${this.page.url()} - ${body.substring(0, 100)}`);
                }
            } else {
                if (this.page.url().includes('beck-online.beck.de')) {
                    console.error('[BeckBrowser] Already logged in (Direct hit).');
                    this.isAuthenticated = true;
                    // Ensure we save the fresh cookies if we just logged in via some other flow or it was a lucky hit
                    const cookies = await this.page.cookies();
                    await this.saveSession(cookies);
                } else {
                    throw new Error(`Unexpected login start page: ${this.page.url()}`);
                }
            }
        } catch (error) {
            console.error('[BeckBrowser] Login Error:', error);
            throw error;
        }
    }


    public async fetchPage(url: string): Promise<string> {
        if (!this.page) await this.init();
        if (!this.isAuthenticated) await this.login();
        if (!this.page) throw new Error('Browser not ready');

        if (url.startsWith('/')) {
            url = `https://beck-online.beck.de${url}`;
        }

        console.error(`[BeckBrowser] Fetching: ${url}`);
        await this.page.goto(url, { waitUntil: 'domcontentloaded' });
        
        try {
            await this.page.waitForSelector('.treffer-wrapper, .paragr, .satz', { timeout: 2000 });
        } catch (_e) { 
            // Ignore timeout - page may not have these selectors
        }

        return await this.page.content();
    }

    public async resolveUrl(url: string): Promise<string> {
        if (!this.page) await this.init();
        if (!this.isAuthenticated) await this.login();
        if (!this.page) throw new Error('Browser not ready');

        if (url.startsWith('/')) {
            url = `https://beck-online.beck.de${url}`;
        }

        console.error(`[BeckBrowser] Resolving: ${url}`);
        await this.page.goto(url, { waitUntil: 'domcontentloaded' });
        return this.page.url();
    }

    public async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
            this.isAuthenticated = false;
        }
    }

    public getCurrentUrl(): string {
        return this.page ? this.page.url() : '';
    }
}
