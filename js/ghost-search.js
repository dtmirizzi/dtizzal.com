// ghost-search.js — Client-side blog search using MiniSearch
// Loads data/blog-index.json and provides searchBlog() for the ghost chat widget

(function () {
    'use strict';

    const INDEX_URL = '/data/blog-index.json';
    const MINISEARCH_CDN = 'https://esm.run/minisearch@7.1.1';

    let miniSearchModule = null;
    let searchIndex = null;
    let indexData = null;
    let initPromise = null;

    async function ensureInitialized() {
        if (searchIndex) return true;
        if (initPromise) return initPromise;

        initPromise = (async () => {
            try {
                // Load MiniSearch and index data in parallel
                const [mod, response] = await Promise.all([
                    import(MINISEARCH_CDN),
                    fetch(INDEX_URL)
                ]);

                miniSearchModule = mod.default || mod;
                if (!response.ok) {
                    throw new Error('Failed to load blog index: ' + response.status);
                }
                indexData = await response.json();

                // Build the search index
                searchIndex = new miniSearchModule({
                    fields: ['title', 'text', 'section'],
                    storeFields: ['postIndex', 'section', 'text'],
                    searchOptions: {
                        boost: { title: 3, section: 1.5, text: 1 },
                        fuzzy: 0.2,
                        prefix: true
                    }
                });

                // Add post title as a field on each chunk for boosted matching
                const docs = indexData.chunks.map(function (chunk) {
                    return {
                        id: chunk.id,
                        postIndex: chunk.postIndex,
                        section: chunk.section,
                        text: chunk.text,
                        title: indexData.posts[chunk.postIndex].title
                    };
                });

                searchIndex.addAll(docs);
                return true;
            } catch (err) {
                console.warn('[ghost-search] Init failed:', err);
                initPromise = null;
                return false;
            }
        })();

        return initPromise;
    }

    /**
     * Search blog posts. Returns top K results with post metadata.
     * @param {string} query - Search query
     * @param {number} topK - Max results (default 3)
     * @returns {Promise<Array<{postTitle: string, postUrl: string, postNumber: number, section: string, text: string, score: number}>>}
     */
    async function searchBlog(query, topK) {
        topK = topK || 3;
        const ready = await ensureInitialized();
        if (!ready || !query || !query.trim()) return [];

        const results = searchIndex.search(query.trim(), { limit: topK * 2 });

        // Deduplicate: keep best chunk per post, up to topK
        const seen = {};
        const deduped = [];
        for (var i = 0; i < results.length && deduped.length < topK; i++) {
            var r = results[i];
            var postIdx = r.postIndex;
            if (seen[postIdx]) continue;
            seen[postIdx] = true;

            var post = indexData.posts[postIdx];
            deduped.push({
                postTitle: post.title,
                postUrl: post.url,
                postNumber: post.number,
                section: r.section,
                text: r.text,
                score: r.score
            });
        }

        return deduped;
    }

    /**
     * Format search results into a context string for the system prompt.
     * @param {Array} results - From searchBlog()
     * @returns {string}
     */
    function formatSearchContext(results) {
        if (!results || results.length === 0) return '';

        var parts = ['RELEVANT BLOG CONTENT:'];
        for (var i = 0; i < results.length; i++) {
            var r = results[i];
            parts.push('');
            parts.push('[From "' + r.postTitle + '" — ' + r.section + ']');
            // Truncate long chunks to ~200 words for prompt space
            var words = r.text.split(/\s+/);
            var truncated = words.length > 200 ? words.slice(0, 200).join(' ') + '...' : r.text;
            parts.push(truncated);
            parts.push('Link: https://dtizzal.com' + r.postUrl);
        }
        return parts.join('\n');
    }

    /**
     * Preload the search index (call during engine init to hide latency).
     */
    function preloadSearch() {
        ensureInitialized();
    }

    // Export globally
    window.ghostSearch = {
        search: searchBlog,
        format: formatSearchContext,
        preload: preloadSearch
    };
})();
