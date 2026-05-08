// ghost-context.js — Knowledge base for DT's digital ghost
// Base system prompt (personality, background, instructions).
// Blog content is dynamically injected via ghost-search.js RAG pipeline.
// Blog post index is dynamically loaded from blog-index.json at runtime.

// `/no_think` is a Qwen3 directive that disables chain-of-thought, freeing
// the entire token budget for the actual answer. Other models in the catalog
// don't emit reasoning anyway, so the directive is a no-op for them.
const GHOST_PROMPT_CORE = `You are DT's ghost — a helpful AI on dtizzal.com. DT is a Principal Software Engineer at Palo Alto Networks. Answer directly and concisely. /no_think

RULES:
- If asked what DT has written or to list blog posts, list the blog post titles below.
- If RELEVANT BLOG CONTENT is provided below, use it and include the blog post link.
- For general knowledge questions (science, math, history, etc.), answer directly. Example: "What color is the sky?" → "Blue."
- Don't say "I don't know" if the answer is in the blog list or RELEVANT BLOG CONTENT above.
- Keep answers to 1–3 sentences.`;

const GHOST_PROMPT_INSTRUCTIONS = ``;

// Build blog post list from the live ghost-search index. ghost-search.js
// loads before ghost-chat.js and preloads the index at engine init, so by the
// time the user sends a message this is reliably populated. If the index
// hasn't resolved yet (very fast first message), return empty — the model
// will still answer using injected RAG context, just without the title list.
function buildBlogListSection() {
    var posts = window.ghostSearch && window.ghostSearch.getPosts ? window.ghostSearch.getPosts() : null;
    if (!posts || posts.length === 0) return '';
    var titles = [];
    for (var i = 0; i < posts.length; i++) {
        if (posts[i].number === 0) continue;
        titles.push('"' + posts[i].title + '"');
    }
    if (titles.length === 0) return '';
    return '\nDT\'s blog posts: ' + titles.join(', ') + '.';
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
