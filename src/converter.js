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
exports.BeckConverter = void 0;
const cheerio = __importStar(require("cheerio"));
const turndown_1 = __importDefault(require("turndown"));
class BeckConverter {
    constructor() {
        this.turndown = new turndown_1.default({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced'
        });
        this.configureTurndown();
    }
    configureTurndown() {
        // Custom rule for Paragraph numbers (Absatz) e.g., (1)
        this.turndown.addRule('absatzNumbers', {
            filter: (node) => {
                return node.nodeName === 'SPAN' && node.classList.contains('absnr');
            },
            replacement: (content) => {
                return `**${content.trim()}** `;
            }
        });
        // Rule for "Satz" spans - just return content, maybe clean spaces
        this.turndown.addRule('satz', {
            filter: (node) => {
                return node.nodeName === 'SPAN' && node.classList.contains('satz');
            },
            replacement: (content) => {
                return content;
            }
        });
        // Rule for "Aufzählung" (Enumeration) numbers e.g., 1.
        this.turndown.addRule('aufzNumbers', {
            filter: (node) => {
                return node.nodeName === 'SPAN' && node.classList.contains('aufz');
            },
            replacement: (content) => {
                return `${content} `;
            }
        });
        // Handle internal links to preserve vpath
        this.turndown.addRule('internalLinks', {
            filter: 'a',
            replacement: (content, node) => {
                const element = node;
                const href = element.getAttribute('href');
                // If it's a vpath link, keep it relative or clean it
                if (href && (href.includes('vpath=') || href.includes('/?typ='))) {
                    return `[${content}](${href})`;
                }
                return `[${content}](${href})`;
            }
        });
    }
    htmlToMarkdown(html) {
        const $ = cheerio.load(html);
        // 1. Extract Title
        const title = $('h2.paragr').text().trim() || $('title').text().trim();
        // 2. Extract Footnotes (from <div class="fn"> or implicitly in text)
        // In the print view, footnotes might be inline or at the bottom.
        // We need to check where they are. In the example provided, they are inline in the title 
        // e.g. [Fn. [1]: ...]
        // But usually there is a section. Let's assume standard behavior for now.
        // 3. Process Main Content
        // The content is usually in #printcontent or .dokcontent
        const contentContainer = $('#printcontent .dokcontent');
        // Remove breadcrumbs and navigation from markdown generation
        contentContainer.find('.breadcrumb').remove();
        contentContainer.find('.dk2').remove(); // Previous/Next buttons
        contentContainer.find('.vkstandfooter').remove(); // Footer
        let markdown = this.turndown.turndown(contentContainer.html() || '');
        // Prepend Title
        markdown = `# ${title}

${markdown}`;
        return markdown;
    }
    extractContext(html) {
        const $ = cheerio.load(html);
        const breadcrumbs = [];
        $('.breadcrumb li').each((i, el) => {
            breadcrumbs.push($(el).text().trim());
        });
        const siblings = {
            previous: $('#dk2prev').attr('href') || null,
            next: $('#dk2next').attr('href') || null
        };
        return {
            breadcrumbs,
            siblings
        };
    }
}
exports.BeckConverter = BeckConverter;
