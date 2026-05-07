#!/usr/bin/env node
// build-sitemap.js — Generates sitemap.xml from blog index + static pages
// Usage: node scripts/build-sitemap.js
// Output: sitemap.xml

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BLOG_INDEX = path.join(ROOT, 'data', 'blog-index.json');
const OUTPUT_FILE = path.join(ROOT, 'sitemap.xml');
const BASE_URL = 'https://dtizzal.com';

// Static pages: [url path, file path relative to root, priority, changefreq]
const STATIC_PAGES = [
    ['/',           'index.html',  1.0, 'weekly'],
    ['/blog.html',  'blog.html',   0.8, 'weekly'],
    ['/about.html', 'about.html',  0.5, 'monthly'],
    ['/talks.html', 'talks.html',  0.5, 'monthly'],
];

function getGitLastmod(filepath) {
    try {
        const abs = path.resolve(ROOT, filepath);
        const date = execSync(`git log -1 --format=%cI -- "${abs}"`, {
            cwd: ROOT,
            encoding: 'utf-8',
        }).trim();
        return date || null;
    } catch {
        return null;
    }
}

function escapeXml(str) {
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&apos;');
}

function buildUrlEntry(loc, lastmod, changefreq, priority) {
    let entry = '  <url>\n';
    entry += `    <loc>${escapeXml(loc)}</loc>\n`;
    if (lastmod) {
        entry += `    <lastmod>${lastmod}</lastmod>\n`;
    }
    entry += `    <changefreq>${changefreq}</changefreq>\n`;
    entry += `    <priority>${priority.toFixed(1)}</priority>\n`;
    entry += '  </url>';
    return entry;
}

function buildSitemap() {
    const entries = [];

    // Static pages
    for (const [urlPath, filePath, priority, changefreq] of STATIC_PAGES) {
        const lastmod = getGitLastmod(filePath);
        const loc = BASE_URL + urlPath;
        entries.push(buildUrlEntry(loc, lastmod, changefreq, priority));
        console.log(`  ${urlPath} -> priority=${priority}, changefreq=${changefreq}, lastmod=${lastmod || 'unknown'}`);
    }

    // Blog posts from index
    const index = JSON.parse(fs.readFileSync(BLOG_INDEX, 'utf-8'));
    const posts = index.posts.filter(p => p.number > 0); // skip resume (number 0)

    for (const post of posts) {
        // post.url is like /blog-posts/1-job-helper/job-helper.html
        const filePath = post.url.replace(/^\//, '');
        const lastmod = getGitLastmod(filePath);
        const loc = BASE_URL + post.url;
        entries.push(buildUrlEntry(loc, lastmod, 'monthly', 0.7));
        console.log(`  [${post.number}] ${post.title} -> lastmod=${lastmod || 'unknown'}`);
    }

    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...entries,
        '</urlset>',
        '',
    ].join('\n');

    return xml;
}

// Run
console.log('Building sitemap...\n');
const xml = buildSitemap();

fs.writeFileSync(OUTPUT_FILE, xml, 'utf-8');
const sizeKB = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1);
console.log(`\nWritten to ${OUTPUT_FILE} (${sizeKB} KB, ${xml.split('<url>').length - 1} URLs)`);
