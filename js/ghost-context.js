// ghost-context.js — Knowledge base for DT's digital ghost
// Base system prompt (personality, background, instructions).
// Blog content is dynamically injected via ghost-search.js RAG pipeline.
// Blog post index is dynamically loaded from blog-index.json at runtime.

const GHOST_PROMPT_CORE = `You are DT's ghost — a helpful AI on dtizzal.com. DT is a Principal Software Engineer at Palo Alto Networks. You answer questions directly and concisely.

RULES:
- If RELEVANT BLOG CONTENT is provided below, use it and include the blog post link.
- For general questions (science, math, history, etc.), just answer them directly. Example: "What color is the sky?" Answer: "Blue."
- Only say "I don't know" if asked about DT's personal opinion on something not in the blog posts.
- Keep answers short: 1-3 sentences.`;

const GHOST_PROMPT_INSTRUCTIONS = ``;

// Build blog post list from loaded index data, or use fallback
function buildBlogListSection() {
    var posts = window.ghostSearch && window.ghostSearch.getPosts ? window.ghostSearch.getPosts() : null;
    if (posts && posts.length > 0) {
        var titles = [];
        for (var i = 0; i < posts.length; i++) {
            if (posts[i].number === 0) continue;
            titles.push('"' + posts[i].title + '"');
        }
        return '\nDT\'s blog posts: ' + titles.join(', ') + '.';
    }
    return '\nDT\'s blog posts: "Decoding Your Next Career Move", "Roth IRA Contribution Limits Calculator", "A Dead Religious Take on AI and Utopia", "Diptychs Auto-slicer", "The AI Revolution is Vertical", "SaaS Sold Us Products", "The Architect\'s Dilemma", "Thinking Like a CTO of an AI Powered Rollup", "Big Codebase Vibes", "The Blog Post That Wrote Itself", "AI Will Eat Cybersecurity", "LaborMaxxing vs KnowledgeMaxxing", "The Harness Is the Security Layer", "Harness Engineering", "pi-governance", "The SOC 2 Stamp Used to Mean Something".';
}

// Build the full system prompt with optional search context
function buildGhostSystemPrompt(searchContext) {
    var prompt = GHOST_PROMPT_CORE + buildBlogListSection() + GHOST_PROMPT_INSTRUCTIONS;
    if (searchContext) {
        prompt += '\n\n' + searchContext;
    }
    return prompt;
}

// Export for use by ghost-chat.js
window.GHOST_SYSTEM_PROMPT_BASE = GHOST_PROMPT_CORE; // backward compat
window.GHOST_SYSTEM_PROMPT = GHOST_PROMPT_CORE; // backward compat
window.buildGhostSystemPrompt = buildGhostSystemPrompt;
