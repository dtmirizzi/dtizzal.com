#!/usr/bin/env node
// build-llms-txt.js — Generates llms.txt from blog index
// Usage: node scripts/build-llms-txt.js
// Output: llms.txt
// Spec: https://llmstxt.org

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BLOG_INDEX = path.join(ROOT, 'data', 'blog-index.json');
const OUTPUT_FILE = path.join(ROOT, 'llms.txt');
const BASE_URL = 'https://dtizzal.com';

// Post descriptions — keyed by post number
// These are manually curated summaries for LLM context
const POST_DESCRIPTIONS = {
    1: 'A quantitative framework for evaluating job offers using weighted scoring across compensation, growth, mission, and engineering culture.',
    2: 'Interactive calculator for Roth IRA contribution limits based on filing status and income.',
    3: 'Explores parallels between Gnostic theology and AI development — the idea that building intelligence is a spiritual act of liberation from material constraint.',
    4: 'A tool for automatically slicing half-frame film photography pairs into diptychs and triptychs.',
    5: 'Argues that the real AI opportunity is vertical specialization — domain-specific models that deeply understand one industry — not horizontal general-purpose platforms.',
    6: 'The transition from horizontal SaaS tools to vertical, outcome-oriented platforms that deliver results rather than features.',
    7: 'Why legacy workflow orchestration systems become black holes of complexity, and how to escape with modern architectural patterns.',
    8: 'A framework for evaluating AI-powered rollup strategies from a CTO perspective — what to build, buy, and integrate.',
    9: 'Practical lessons from navigating and contributing to a 14-million-line-of-code monorepo at scale.',
    10: 'How this blog\'s CI/CD pipeline was built — automated publishing, search indexing, and an in-browser AI chatbot, all from static files.',
    11: 'Why AI that reasons about vulnerabilities and attack patterns will reshape the entire cybersecurity industry, and why legacy vendors aren\'t ready.',
    12: 'Analyzes Google\'s AI strategy through a Marxist lens — the tension between automating labor (labormaxxing) and compounding knowledge (knowledgemaxxing).',
    13: 'Why the AI harness — the orchestration layer between models and tools — is the true security control plane, not the model itself.',
    14: 'Defines harness engineering as the emerging discipline of designing, constraining, and governing AI agent systems rather than writing code directly.',
    15: 'Introduces pi-governance, an open-source tool for governing AI agent harnesses with policy-as-code.',
    16: 'Why SOC 2 compliance has become a checkbox exercise that no longer meaningfully signals security posture, and what should replace it.',
};

function buildLlmsTxt() {
    const index = JSON.parse(fs.readFileSync(BLOG_INDEX, 'utf-8'));
    const posts = index.posts.filter(p => p.number > 0);

    const lines = [];

    lines.push('# DT Mirizzi — dtizzal.com');
    lines.push('');
    lines.push('> Personal website and blog of DT Mirizzi — principal software engineer, systems thinker, and builder.');
    lines.push('');
    lines.push('DT Mirizzi is a Principal Software Engineer at Palo Alto Networks based in San Francisco. Background in Golang, Java, Python, Linux, cloud-native development, and cybersecurity. Previously at Obsidian Security. B.S. in Computer Science from California Lutheran University. Also an artist (dt-mirizzi-art.com) and half-frame film photographer.');
    lines.push('');
    lines.push('## Recurring themes');
    lines.push('');
    lines.push('- Specialization over generalization (vertical AI, specialized orchestrators)');
    lines.push('- Control planes as load-bearing architecture (orchestration, security, governance)');
    lines.push('- Critique of hype — challenges simple narratives with structural analysis');
    lines.push('- Intellectual cross-pollination (theology + AI, Marxism + tech strategy)');
    lines.push('- Builder ethos — theory validated through implementation');
    lines.push('');
    lines.push('## Pages');
    lines.push('');
    lines.push('- [Home](https://dtizzal.com/)');
    lines.push('- [Blog](https://dtizzal.com/blog.html)');
    lines.push('- [About](https://dtizzal.com/about.html)');
    lines.push('- [Talks](https://dtizzal.com/talks.html)');
    lines.push('');
    lines.push('## Blog posts');
    lines.push('');

    for (const post of posts) {
        const desc = POST_DESCRIPTIONS[post.number] || '';
        const url = BASE_URL + post.url;
        if (desc) {
            lines.push(`- [${post.title}](${url}): ${desc}`);
        } else {
            lines.push(`- [${post.title}](${url})`);
        }
    }

    lines.push('');
    return lines.join('\n');
}

console.log('Building llms.txt...\n');
const content = buildLlmsTxt();
fs.writeFileSync(OUTPUT_FILE, content, 'utf-8');

const index = JSON.parse(fs.readFileSync(BLOG_INDEX, 'utf-8'));
const postCount = index.posts.filter(p => p.number > 0).length;
const sizeKB = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1);
console.log(`Written to ${OUTPUT_FILE} (${sizeKB} KB, ${postCount} blog posts)`);
