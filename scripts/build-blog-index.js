#!/usr/bin/env node
// build-blog-index.js — Parses blog HTML files and generates a chunked search index
// Usage: node scripts/build-blog-index.js
// Output: data/blog-index.json

const fs = require('fs');
const path = require('path');

const BLOG_DIR = path.join(__dirname, '..', 'blog-posts');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'blog-index.json');

// Target ~200-300 tokens per chunk (~150-250 words)
const MAX_CHUNK_WORDS = 250;
const MIN_CHUNK_WORDS = 30;

// Blog post metadata — matches ghost-context.js ordering
const POST_META = [
    { number: 1,  slug: 'job-helper',                           title: 'Decoding Your Next Career Move: A Software Engineer\'s Equation for Job Selection' },
    { number: 2,  slug: 'ira-cal',                              title: 'Roth IRA Contribution Limits Calculator' },
    { number: 3,  slug: 'gnostic',                              title: 'A \'Dead\' Religious Take on AI and Utopia' },
    { number: 4,  slug: 'diptychs-and-triptychs-auto-slicer',   title: 'Diptychs Auto-slicer' },
    { number: 5,  slug: 'vertical-ai',                          title: 'The AI Revolution is Vertical' },
    { number: 6,  slug: 'vertical-saas',                        title: 'SaaS Sold Us Products. The Next Wave Will Sell Us Outcomes.' },
    { number: 7,  slug: 'workflows',                            title: 'The Architect\'s Dilemma: Escaping the Event Horizon of Legacy Orchestration' },
    { number: 8,  slug: 'ai-rollup',                            title: 'Thinking Like a CTO of an AI Powered Rollup' },
    { number: 9,  slug: 'large-codebase-vibes',                 title: 'Big Codebase Vibes: Taming the 14M LOC Monorepo' },
    { number: 10, slug: 'automated-blog-pipeline',              title: 'The Blog Post That Wrote Itself' },
    { number: 11, slug: 'ai-eats-cybersecurity',                title: 'AI Will Eat Cybersecurity' },
    { number: 12, slug: 'labormaxxing-vs-knowledgemaxxing',     title: 'LaborMaxxing vs KnowledgeMaxxing: A Marxist Case for Google\'s AI Strategy' },
    { number: 13, slug: 'harness-is-the-security-layer',        title: 'The Harness Is the Security Layer' },
    { number: 14, slug: 'harness-engineering',                  title: 'Harness Engineering: The Discipline That Replaces Writing Code' },
    { number: 15, slug: 'pi-governance',                        title: 'pi-governance: The Harness You Can Actually Install' },
];

function stripHTML(html) {
    // Remove script/style blocks entirely
    html = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
    // Replace block elements with newlines
    html = html.replace(/<\/(p|div|li|h[1-6]|blockquote|tr|br\s*\/?)>/gi, '\n');
    html = html.replace(/<br\s*\/?>/gi, '\n');
    // Strip remaining tags
    html = html.replace(/<[^>]+>/g, '');
    // Decode common HTML entities
    html = html.replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
               .replace(/&quot;/g, '"')
               .replace(/&#39;/g, "'")
               .replace(/&nbsp;/g, ' ')
               .replace(/&#x27;/g, "'")
               .replace(/&#x2F;/g, '/')
               .replace(/&mdash;/g, '—')
               .replace(/&ndash;/g, '–')
               .replace(/&hellip;/g, '…');
    // Collapse whitespace
    html = html.replace(/[ \t]+/g, ' ');
    // Collapse multiple newlines
    html = html.replace(/\n{3,}/g, '\n\n');
    return html.trim();
}

function extractSections(html) {
    // Extract content within #article-content
    const articleMatch = html.match(/<div[^>]*id=["']article-content["'][^>]*>([\s\S]*?)(?:<\/div>\s*(?:<div|<script|<\/body|$))/i);
    if (!articleMatch) {
        // Fallback: try to get the whole body
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (!bodyMatch) return [];
        return [{ heading: '', text: stripHTML(bodyMatch[1]) }];
    }

    const content = articleMatch[1];

    // Split by h2/h3 headings
    const sectionRegex = /<(h[23])[^>]*>([\s\S]*?)<\/\1>/gi;
    const sections = [];
    let lastIndex = 0;
    let currentHeading = 'Introduction';
    let match;

    while ((match = sectionRegex.exec(content)) !== null) {
        // Text before this heading
        const beforeText = stripHTML(content.slice(lastIndex, match.index));
        if (beforeText.trim()) {
            sections.push({ heading: currentHeading, text: beforeText.trim() });
        }
        currentHeading = stripHTML(match[2]).trim() || currentHeading;
        lastIndex = match.index + match[0].length;
    }

    // Remaining text after last heading
    const remaining = stripHTML(content.slice(lastIndex));
    if (remaining.trim()) {
        sections.push({ heading: currentHeading, text: remaining.trim() });
    }

    return sections;
}

function chunkText(text, heading) {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return [];

    const chunks = [];
    let start = 0;

    while (start < words.length) {
        const end = Math.min(start + MAX_CHUNK_WORDS, words.length);
        const chunkWords = words.slice(start, end);

        // Only include chunks with enough content
        if (chunkWords.length >= MIN_CHUNK_WORDS || start === 0) {
            chunks.push({
                section: heading,
                text: chunkWords.join(' ')
            });
        } else if (chunks.length > 0) {
            // Merge small trailing chunk into previous
            chunks[chunks.length - 1].text += ' ' + chunkWords.join(' ');
        }

        start = end;
    }

    return chunks;
}

function buildIndex() {
    const posts = [];
    const chunks = [];
    let chunkId = 0;

    for (const meta of POST_META) {
        const dir = `${meta.number}-${meta.slug}`;
        const filePath = path.join(BLOG_DIR, dir, `${meta.slug}.html`);

        if (!fs.existsSync(filePath)) {
            console.warn(`WARNING: Missing file: ${filePath}`);
            continue;
        }

        const html = fs.readFileSync(filePath, 'utf-8');
        const url = `/blog-posts/${dir}/${meta.slug}.html`;

        const postIndex = posts.length;
        posts.push({
            number: meta.number,
            slug: meta.slug,
            title: meta.title,
            url: url
        });

        const sections = extractSections(html);
        if (sections.length === 0) {
            console.warn(`WARNING: No content extracted from ${filePath}`);
            continue;
        }

        for (const section of sections) {
            const sectionChunks = chunkText(section.text, section.heading);
            for (const chunk of sectionChunks) {
                chunks.push({
                    id: chunkId++,
                    postIndex: postIndex,
                    section: chunk.section,
                    text: chunk.text
                });
            }
        }

        console.log(`  [${meta.number}] ${meta.title}: ${sections.length} sections, ${chunks.filter(c => c.postIndex === postIndex).length} chunks`);
    }

    return { posts, chunks };
}

// Run
console.log('Building blog search index...\n');
const index = buildIndex();
console.log(`\nTotal: ${index.posts.length} posts, ${index.chunks.length} chunks`);

// Ensure output directory exists
const outputDir = path.dirname(OUTPUT_FILE);
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(index), 'utf-8');
const sizeKB = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1);
console.log(`Written to ${OUTPUT_FILE} (${sizeKB} KB)`);
