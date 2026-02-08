import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

export interface MarkdownResult {
    title: string;
    body: string;
}

export class BeckConverter {
    private turndown: TurndownService;

    constructor() {
        this.turndown = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced'
        });

        this.configureTurndown();
    }

    private configureTurndown() {
        this.turndown.addRule('absatzNumbers', {
            filter: (node) => node.nodeName === 'SPAN' && node.classList.contains('absnr'),
            replacement: (content) => `\n**${content.trim()}**`
        });

        this.turndown.addRule('satz', {
            filter: (node) => node.nodeName === 'SPAN' && node.classList.contains('satz'),
            replacement: (content) => content
        });

        this.turndown.addRule('aufzNumbers', {
            filter: (node) => node.nodeName === 'SPAN' && node.classList.contains('aufz'),
            replacement: (content) => `\n${content} `
        });

        // Handle Randnummern in court decisions (sidebar-inside with em.randnr)
        this.turndown.addRule('randnummerInside', {
            filter: (node) => node.nodeName === 'SPAN' && node.classList.contains('sidebar-inside'),
            replacement: (content, node) => {
                const element = node as HTMLElement;
                const randnr = element.querySelector('.randnr, .randnr.rn-beck');
                if (randnr) {
                    return `\n\n**[Rn. ${randnr.textContent?.trim()}]** `;
                }
                return '';
            }
        });

        // Handle Randnummern in commentaries (sidebar-outside with em.randnr)
        this.turndown.addRule('randnummerOutside', {
            filter: (node) => node.nodeName === 'SPAN' && node.classList.contains('sidebar-outside'),
            replacement: (content, node) => {
                const element = node as HTMLElement;
                const randnr = element.querySelector('.randnr');
                if (randnr) {
                    return `\n\n**[Rn. ${randnr.textContent?.trim()}]** `;
                }
                return '';
            }
        });

        this.turndown.addRule('internalLinks', {
            filter: 'a',
            replacement: (content, node) => {
                const element = node as HTMLAnchorElement;
                let href = element.getAttribute('href');
                
                // Filter out empty anchors or anchors without href
                if (!href || href === 'null') {
                    return content;
                }
                
                // Ensure links are absolute or handled correctly
                if (href.startsWith('/')) {
                    href = 'https://beck-online.beck.de' + href;
                }
                
                return `[${content}](${href})`;
            }
        });
        
        // Remove empty paragraphs that result in []
        this.turndown.addRule('removeEmpty', {
            filter: (node) => {
                return node.nodeName === 'P' && node.textContent?.trim() === '';
            },
            replacement: () => ''
        });
    }

    public isAccessDenied(html: string): boolean {
        const h = html.toLowerCase();
        return h.includes('nicht über die notwendigen rechte verfügen') || 
               h.includes('dokument kann nicht angezeigt werden') || 
               h.includes('keine berechtigung zum aufruf');
    }

    public htmlToMarkdown(html: string): MarkdownResult {
        const $ = cheerio.load(html);
        const title = $('h2.paragr').first().text().trim() || 
                      $('h1').first().text().trim() ||
                      $('title').text().trim();
        
        // Try different content containers (print view vs regular view)
        let contentContainer = $('#printcontent .dokcontent');
        if (!contentContainer.length) {
            contentContainer = $('#dokcontent');
        }
        if (!contentContainer.length) {
            contentContainer = $('.dokcontent');
        }
        
        // Remove navigation, footer, and the title element itself (since we prepend it)
        contentContainer.find('.breadcrumb, .dk2, .vkstandfooter').remove();
        contentContainer.find('h2.paragr').remove(); 
        contentContainer.find('a[name]').remove(); 

        let body = this.turndown.turndown(contentContainer.html() || '');
        
        // Post-processing cleanup
        
        // 1. Format Randnummern [123] -> **[Rn. 123]**
        // Matches [123] at start of line or after newlines
        body = body.replace(/(^|\n)\[(\d+)\]/g, '$1**[Rn. $2]**');

        // 2. Remove excessive newlines
        body = body.replace(/\n{3,}/g, '\n\n');
        
        // 3. Remove artifacts like [](null)
        body = body.replace(/\[\]\(null\)/g, '');

        return { title, body: body.trim() };
    }

    public extractContext(html: string): any {
        const $ = cheerio.load(html);
        const breadcrumbs: string[] = [];
        $('.breadcrumb li').each((i, el) => {
            breadcrumbs.push($(el).text().trim());
        });
        return {
            breadcrumbs,
            siblings: {
                previous: $('#dk2prev').attr('href') || null,
                next: $('#dk2next').attr('href') || null
            }
        };
    }
}
