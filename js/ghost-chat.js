// ghost-chat.js — Terminal-styled AI chat widget powered by Transformers.js
// Runs entirely client-side: WebGPU when available, WASM (CPU) otherwise
// Includes client-side RAG via MiniSearch for blog content retrieval

(function () {
    'use strict';

    const TRANSFORMERS_VERSION = '4.3.2'; // pinned @huggingface/transformers release
    const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@'
        + TRANSFORMERS_VERSION + '/dist/transformers.min.js';

    // Debug logging — set to false to silence. Filter the devtools console
    // by "[ghost]" to see only this widget's traces.
    const DEBUG = true;
    function log() {
        if (!DEBUG) return;
        const args = Array.prototype.slice.call(arguments);
        args.unshift('[ghost]');
        console.log.apply(console, args);
    }

    // ─── Model Catalog ───────────────────────────────────────────
    // ONNX builds on Hugging Face, loaded with Transformers.js. `dtype` is the
    // WebGPU build; `wasmDtype` is the CPU fallback (the q4 builds quantize the
    // embedding with an op the WASM backend lacks). Sizes are real download sizes. `gen` holds each vendor's recommended sampling
    // settings. `thinking: true` marks hybrid-reasoning models (Qwen); we pass
    // enable_thinking: false to the chat template so they answer directly.
    const LFM_GEN  = { do_sample: true, temperature: 0.1, top_k: 50, top_p: 0.1, repetition_penalty: 1.05 };
    const QWEN_GEN = { do_sample: true, temperature: 0.7, top_k: 20, top_p: 0.8, repetition_penalty: 1.05 };
    const MODELS = [
        { id: 'LiquidAI/LFM2.5-230M-ONNX',             label: 'LFM2.5 230M',     brand: 'Liquid AI', dtype: 'q4', size: '211MB', wasmDtype: 'q4f32',     wasmSize: '403MB', mobile: true,  thinking: false, gen: LFM_GEN },
        { id: 'LiquidAI/LFM2.5-350M-ONNX',             label: 'LFM2.5 350M',     brand: 'Liquid AI', dtype: 'q4', size: '294MB', wasmDtype: 'q4f32',     wasmSize: '481MB', mobile: true,  thinking: false, gen: LFM_GEN },
        { id: 'onnx-community/Qwen3.5-0.8B-Text-ONNX', label: 'Qwen3.5 0.8B',    brand: 'Alibaba',   dtype: 'q4', size: '551MB', wasmDtype: 'quantized', wasmSize: '939MB', mobile: false, thinking: true,  gen: QWEN_GEN },
        { id: 'LiquidAI/LFM2.5-1.2B-Instruct-ONNX',    label: 'LFM2.5 1.2B',     brand: 'Liquid AI', dtype: 'q4', size: '850MB', wasmDtype: 'quantized', wasmSize: '1.5GB', mobile: false, thinking: false, gen: LFM_GEN },
    ];

    // Smallest model = fastest first download. Used everywhere by default.
    const DEFAULT_MODEL_ID_DESKTOP = 'LiquidAI/LFM2.5-230M-ONNX';
    const DEFAULT_MODEL_ID_MOBILE  = 'LiquidAI/LFM2.5-230M-ONNX';
    const MAX_HISTORY = 10;

    let currentModelId = isMobileDevice() ? DEFAULT_MODEL_ID_MOBILE : DEFAULT_MODEL_ID_DESKTOP;
    let engine = null;
    let tjs = null; // lazily imported Transformers.js module
    let isLoading = false;
    let isGenerating = false;
    let chatHistory = [];
    let isExpanded = false;
    let resizeState = null;

    function isMobileDevice() {
        return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
            || (window.innerWidth <= 768 && 'ontouchstart' in window);
    }

    function getModel(id) {
        return MODELS.find(m => m.id === id);
    }

    function getAvailableModels() {
        if (isMobileDevice()) return MODELS.filter(m => m.mobile);
        return MODELS;
    }

    // ─── DOM Creation ───────────────────────────────────────────

    function createWidget() {
        const widget = document.createElement('div');
        widget.id = 'ghost-terminal';
        widget.innerHTML = `
            <div id="ghost-bar" title="Ask DT's digital ghost a question">
                <span class="ghost-prompt">
                    <span class="ghost-user">ghost</span><span class="ghost-at">@</span><span class="ghost-host">dtizzal.com</span><span class="ghost-sep"> ~ </span><span class="ghost-cmd">ask-dt</span><span class="ghost-cursor">&#x2588;</span>
                </span>
                <span class="ghost-hint">click to chat</span>
                <button id="ghost-expand-btn" aria-label="Expand chat">
                    <span class="ghost-chevron">&#x25B2;</span>
                </button>
            </div>
            <div id="ghost-panel" class="ghost-hidden">
                <div id="ghost-resize-handle"></div>
                <div id="ghost-output"></div>
                <div id="ghost-input-row">
                    <span class="ghost-input-prompt">$&nbsp;</span>
                    <input type="text" id="ghost-input" placeholder="ask the ghost something... (type /model for options)" autocomplete="off" spellcheck="false" />
                </div>
            </div>
        `;
        document.body.appendChild(widget);
        bindEvents();
        printWelcome();
    }

    // ─── Event Binding ──────────────────────────────────────────

    function bindEvents() {
        const bar = document.getElementById('ghost-bar');
        const input = document.getElementById('ghost-input');
        const resizeHandle = document.getElementById('ghost-resize-handle');

        bar.addEventListener('click', togglePanel);

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
            }
        });

        // Resize logic
        resizeHandle.addEventListener('mousedown', startResize);
        document.addEventListener('mousemove', doResize);
        document.addEventListener('mouseup', stopResize);

        // Touch resize for mobile
        resizeHandle.addEventListener('touchstart', startResizeTouch, { passive: false });
        document.addEventListener('touchmove', doResizeTouch, { passive: false });
        document.addEventListener('touchend', stopResize);

        // Escape to close
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && isExpanded) {
                collapsePanel();
            }
        });
    }

    // ─── Panel Toggle ───────────────────────────────────────────

    function togglePanel() {
        if (isExpanded) {
            collapsePanel();
        } else {
            expandPanel();
        }
    }

    function expandPanel() {
        const panel = document.getElementById('ghost-panel');
        const bar = document.getElementById('ghost-bar');
        const hint = bar.querySelector('.ghost-hint');
        const chevron = bar.querySelector('.ghost-chevron');
        panel.classList.remove('ghost-hidden');
        hint.textContent = '';
        chevron.innerHTML = '&#x25BC;';
        isExpanded = true;
        setTimeout(() => {
            document.getElementById('ghost-input').focus();
            scrollOutput();
        }, 50);
    }

    function collapsePanel() {
        const panel = document.getElementById('ghost-panel');
        const bar = document.getElementById('ghost-bar');
        const hint = bar.querySelector('.ghost-hint');
        const chevron = bar.querySelector('.ghost-chevron');
        panel.classList.add('ghost-hidden');
        hint.textContent = 'click to chat';
        chevron.innerHTML = '&#x25B2;';
        isExpanded = false;
    }

    // ─── Resize ─────────────────────────────────────────────────

    function startResize(e) {
        e.preventDefault();
        resizeState = { startY: e.clientY, startH: document.getElementById('ghost-panel').offsetHeight };
    }

    function startResizeTouch(e) {
        e.preventDefault();
        const touch = e.touches[0];
        resizeState = { startY: touch.clientY, startH: document.getElementById('ghost-panel').offsetHeight };
    }

    function doResize(e) {
        if (!resizeState) return;
        const panel = document.getElementById('ghost-panel');
        const delta = resizeState.startY - e.clientY;
        const newH = Math.min(Math.max(resizeState.startH + delta, 200), window.innerHeight - 60);
        panel.style.height = newH + 'px';
    }

    function doResizeTouch(e) {
        if (!resizeState) return;
        e.preventDefault();
        const touch = e.touches[0];
        const panel = document.getElementById('ghost-panel');
        const delta = resizeState.startY - touch.clientY;
        const newH = Math.min(Math.max(resizeState.startH + delta, 200), window.innerHeight - 60);
        panel.style.height = newH + 'px';
    }

    function stopResize() {
        resizeState = null;
    }

    // ─── Output Helpers ─────────────────────────────────────────

    function printLine(text, cls) {
        const output = document.getElementById('ghost-output');
        const line = document.createElement('div');
        line.className = 'ghost-line ' + (cls || '');
        line.textContent = text;
        output.appendChild(line);
        scrollOutput();
        return line;
    }

    function printHTML(html, cls) {
        const output = document.getElementById('ghost-output');
        const line = document.createElement('div');
        line.className = 'ghost-line ' + (cls || '');
        line.innerHTML = html;
        output.appendChild(line);
        scrollOutput();
        return line;
    }

    function scrollOutput() {
        const output = document.getElementById('ghost-output');
        output.scrollTop = output.scrollHeight;
    }

    // ─── Tool Call Visualization ─────────────────────────────────

    function printToolCall(toolName, args, results) {
        const output = document.getElementById('ghost-output');
        const block = document.createElement('div');
        block.className = 'ghost-tool-block';

        var lines = [];
        lines.push('<span class="ghost-tool-header">\u250C\u2500 ' + escapeHTML(toolName) + '("' + escapeHTML(args) + '")</span>');

        if (results && results.length > 0) {
            lines.push('<span class="ghost-tool-body">\u2502  Found ' + results.length + ' result' + (results.length !== 1 ? 's' : '') + ':</span>');
            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                lines.push('<span class="ghost-tool-body">\u2502  ' + (i + 1) + '. "' + escapeHTML(r.postTitle) + '" \u2014 ' + escapeHTML(r.section) + '</span>');
            }
        } else {
            lines.push('<span class="ghost-tool-body">\u2502  No results found</span>');
        }
        lines.push('<span class="ghost-tool-footer">\u2514\u2500 injecting context...</span>');

        block.innerHTML = lines.join('\n');
        output.appendChild(block);
        scrollOutput();
        return block;
    }

    function dismissToolBlock(block) {
        if (!block || !block.parentNode) return;
        // Update footer to show completion, then fade out
        var footer = block.querySelector('.ghost-tool-footer');
        if (footer) footer.textContent = '\u2514\u2500 done';
        block.classList.add('ghost-tool-done');
        setTimeout(function () {
            if (block.parentNode) block.remove();
            scrollOutput();
        }, 600);
    }

    // ─── Link Rendering ─────────────────────────────────────────

    // ─── Response Rendering ────────────────────────────────────
    // Qwen reasoning is disabled via the chat template, but small models occasionally emit
    // think tags. Strip them defensively in both render and history paths
    // so users never see them and the next turn isn't fed CoT.

    function stripThinkTags(text) {
        return text
            .replace(/<think>[\s\S]*?<\/think>/g, '')
            .replace(/<think>[\s\S]*$/, '')
            .replace(/<\/think>/g, '')
            .trim();
    }

    function renderResponse(text) {
        var escaped = escapeHTML(stripThinkTags(text));
        return escaped.replace(
            /https:\/\/dtizzal\.com\/blog-posts\/[^\s<)"']+/g,
            function (url) {
                return '<a href="' + url + '" target="_blank" rel="noopener noreferrer" class="ghost-link">' + url + '</a>';
            }
        );
    }

    function printWelcome() {
        const output = document.getElementById('ghost-output');
        output.innerHTML = '';

        printLine("\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510", 'ghost-system');
        printLine("\u2502  ghost@dtizzal.com \u2014 digital ghost   \u2502", 'ghost-system');
        printLine("\u2502  Ask me about DT's blog, ideas,      \u2502", 'ghost-system');
        printLine("\u2502  career, or technical opinions.       \u2502", 'ghost-system');
        printLine("\u2502                                       \u2502", 'ghost-system');
        printLine("\u2502  Powered by in-browser AI            \u2502", 'ghost-system');
        printLine("\u2502  (Transformers.js + LFM2.5)          \u2502", 'ghost-system');
        printLine("\u2502  Everything runs locally. No servers. \u2502", 'ghost-system');
        printLine("\u2502  Blog search powered by MiniSearch.   \u2502", 'ghost-system');
        printLine("\u2502  Type /model to switch models.        \u2502", 'ghost-system');
        printLine("\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518", 'ghost-system');
        printLine('', 'ghost-system');

        if (isMobileDevice()) {
            printLine("\u26A0 Mobile detected \u2014 memory is limited.", 'ghost-loading');
            printLine("  Responses capped to avoid crashes.", 'ghost-loading');
            printLine("  For best experience, use desktop.", 'ghost-loading');
            printLine('', 'ghost-system');
        }
    }

    // ─── /model Command ─────────────────────────────────────────

    function handleModelCommand(args) {
        const available = getAvailableModels();

        // /model with no args — list models
        if (!args) {
            printLine('Available models:', 'ghost-system');
            printLine('', 'ghost-system');
            available.forEach(function (m, i) {
                const active = m.id === currentModelId ? ' \u25C0 active' : '';
                printLine('  ' + (i + 1) + ') ' + m.label + ' (' + m.brand + ') \u2014 ' + m.size + ' download' + active, 'ghost-system');
            });
            printLine('', 'ghost-system');
            printLine('Usage: /model <number>  e.g. /model 3', 'ghost-loading');
            printLine('', 'ghost-system');
            return;
        }

        // /model <number> — switch model
        const idx = parseInt(args, 10);
        if (isNaN(idx) || idx < 1 || idx > available.length) {
            printLine('Invalid model number. Type /model to see the list.', 'ghost-error');
            return;
        }

        const selected = available[idx - 1];
        if (selected.id === currentModelId && engine) {
            printLine('Already using ' + selected.label + '.', 'ghost-system');
            return;
        }

        // Unload current engine
        if (engine) {
            printLine('Unloading ' + (getModel(currentModelId)?.label || currentModelId) + '...', 'ghost-loading');
            disposeEngine();
        }

        currentModelId = selected.id;
        chatHistory = [];
        printLine('Switched to ' + selected.label + ' (' + selected.brand + ').', 'ghost-system');
        printLine('Model will load on your next message.', 'ghost-loading');
        printLine('', 'ghost-system');
    }

    // ─── Transformers.js Engine ─────────────────────────────────
    // A thin adapter exposing the same surface the chat loop uses
    // (engine.chat.completions.create → async iterable of delta chunks),
    // backed by AutoModelForCausalLM.generate + TextStreamer.

    async function pickDevice() {
        if (!navigator.gpu) return 'wasm';
        try {
            const adapter = await navigator.gpu.requestAdapter();
            return adapter ? 'webgpu' : 'wasm';
        } catch (_) {
            return 'wasm';
        }
    }

    function makeEngine(tokenizer, lm, model, device) {
        const stopper = new tjs.InterruptableStoppingCriteria();

        async function* stream(messages, maxTokens) {
            const inputs = tokenizer.apply_chat_template(messages, Object.assign(
                { add_generation_prompt: true, return_dict: true },
                model.thinking ? { enable_thinking: false } : {}
            ));
            const queue = [];
            let done = false, error = null, wake = null;
            const notify = function () { if (wake) { const w = wake; wake = null; w(); } };
            const streamer = new tjs.TextStreamer(tokenizer, {
                skip_prompt: true,
                skip_special_tokens: true,
                callback_function: function (text) { queue.push(text); notify(); },
            });
            stopper.reset();
            const run = lm.generate(Object.assign({}, inputs, model.gen, {
                max_new_tokens: maxTokens,
                streamer: streamer,
                stopping_criteria: stopper,
            })).catch(function (e) { error = e; })
              .finally(function () { done = true; notify(); });
            try {
                while (true) {
                    if (queue.length) {
                        yield { choices: [{ delta: { content: queue.shift() } }] };
                        continue;
                    }
                    if (done) break;
                    await new Promise(function (r) { wake = r; });
                }
                if (error) throw error;
            } finally {
                stopper.interrupt(); // no-op if finished; stops generation if the consumer bailed
                await run;
            }
        }

        return {
            device: device,
            chat: { completions: { create: async function (req) { return stream(req.messages, req.max_tokens); } } },
            dispose: function () {
                stopper.interrupt();
                try { lm.dispose(); } catch (_) { /* ignore */ }
            },
        };
    }

    function disposeEngine() {
        if (!engine) return;
        try { engine.dispose(); } catch (_) { /* ignore */ }
        engine = null;
    }

    function isEngineReady() {
        return engine != null;
    }

    async function initEngine() {
        if (engine || isLoading) return;

        isLoading = true;
        const model = getModel(currentModelId);
        const label = model.label;
        const device = await pickDevice();
        const dtype = device === 'webgpu' ? model.dtype : model.wasmDtype;
        const dlSize = device === 'webgpu' ? model.size : model.wasmSize;
        if (device === 'wasm') {
            printLine('WebGPU unavailable \u2014 running on CPU (slower).', 'ghost-loading');
        }
        const statusLine = printLine('Loading ' + label + '... (first time downloads ~' + dlSize + ')', 'ghost-loading');

        // Preload search index while model downloads
        if (window.ghostSearch) {
            window.ghostSearch.preload();
        }

        const t0 = performance.now();
        log('initEngine: starting', { model: currentModelId, device: device, dtype: dtype, transformersVersion: TRANSFORMERS_VERSION });
        try {
            if (!tjs) {
                tjs = await import(TRANSFORMERS_URL);
                log('initEngine: transformers.js loaded');
            }

            // Aggregate per-file download progress into one status line.
            const files = {};
            const progress_callback = function (p) {
                if (p.status === 'progress' && p.total) {
                    files[p.file] = [p.loaded, p.total];
                    let loaded = 0, total = 0;
                    Object.keys(files).forEach(function (f) { loaded += files[f][0]; total += files[f][1]; });
                    statusLine.textContent = 'Downloading ' + label + '... '
                        + Math.round(loaded / total * 100) + '% ('
                        + Math.round(loaded / 1e6) + ' / ' + Math.round(total / 1e6) + ' MB)';
                    scrollOutput();
                } else if (p.status === 'done' || p.status === 'ready') {
                    statusLine.textContent = 'Initializing ' + label + ' on ' + device + '...';
                }
            };

            const tokenizer = await tjs.AutoTokenizer.from_pretrained(model.id, { progress_callback: progress_callback });
            const lm = await tjs.AutoModelForCausalLM.from_pretrained(model.id, {
                dtype: dtype,
                device: device,
                progress_callback: progress_callback,
            });
            engine = makeEngine(tokenizer, lm, model, device);

            log('initEngine: ready', { model: currentModelId, device: device, ms: Math.round(performance.now() - t0) });
            statusLine.textContent = label + ' loaded (' + device + '). Ready.';
            statusLine.className = 'ghost-line ghost-system';
            printLine('', 'ghost-system');
            isLoading = false;
            return true;
        } catch (err) {
            isLoading = false;
            log('initEngine: FAILED', err);
            statusLine.textContent = 'Failed to load ' + label + '.';
            statusLine.className = 'ghost-line ghost-error';
            printLine('Error: ' + (err && err.message ? err.message : String(err)), 'ghost-error');
            printLine('Try /model 1 for the smallest model, or reload the page.', 'ghost-loading');
            printLine('', 'ghost-system');
            return false;
        }
    }

    // ─── Search Integration ──────────────────────────────────────

    async function performSearch(query, topK) {
        if (!window.ghostSearch) return [];
        try {
            return await window.ghostSearch.search(query, topK || 3);
        } catch (err) {
            console.warn('[ghost-chat] Search failed:', err);
            return [];
        }
    }

    // ─── Spinner Controller ────────────────────────────────────
    // Single spinner element with state transitions. Centralizing this
    // removes the flicker/double-spinner bugs from ad-hoc spinner handling.

    function makeSpinner() {
        let el = null;
        return {
            show: function (text) {
                if (el && el.parentNode) {
                    const span = el.querySelector('.ghost-spinner');
                    if (span) span.textContent = text;
                } else {
                    el = printHTML('<span class="ghost-spinner">' + escapeHTML(text) + '</span>', '');
                }
                scrollOutput();
            },
            hide: function () {
                if (el && el.parentNode) el.remove();
                el = null;
            }
        };
    }

    // ─── Safe Streaming Helper ─────────────────────────────────

    async function streamResponse(generator, responseLine, spinner) {
        let fullResponse = '';
        let chunkCount = 0;
        let firstTokenAt = null;
        const tStart = performance.now();
        try {
            for await (const chunk of generator) {
                if (!isEngineReady()) throw new Error('Engine disposed during generation');
                const delta = chunk.choices[0]?.delta?.content || '';
                if (delta && firstTokenAt === null) {
                    firstTokenAt = performance.now();
                    log('stream: first token', { ttftMs: Math.round(firstTokenAt - tStart) });
                }
                chunkCount++;
                fullResponse += delta;
                responseLine.innerHTML = renderResponse(fullResponse);
                // Hide spinner only once user-visible content lands —
                // renderResponse strips <think> blocks, so during a CoT
                // burst responseLine.textContent stays empty.
                if (responseLine.textContent.trim().length > 0) {
                    spinner.hide();
                    responseLine.style.display = '';
                }
                scrollOutput();
            }
            log('stream: complete', { chunks: chunkCount, totalLen: fullResponse.length });
        } catch (streamErr) {
            log('stream: error', { chunks: chunkCount, partialLen: fullResponse.length, err: streamErr });
            if (fullResponse.trim()) {
                responseLine.innerHTML = renderResponse(fullResponse + ' [interrupted]');
            }
            throw streamErr;
        }
        spinner.hide();
        responseLine.style.display = '';
        return fullResponse;
    }

    // ─── Chat Submit ────────────────────────────────────────────

    async function handleSubmit() {
        const input = document.getElementById('ghost-input');
        const query = input.value.trim();
        if (!query || isGenerating) return;

        input.value = '';

        // Check for /model command
        if (query.startsWith('/model')) {
            printHTML('<span class="ghost-prompt-echo">$ </span>' + escapeHTML(query), 'ghost-user-line');
            const args = query.slice(6).trim() || null;
            handleModelCommand(args);
            return;
        }

        // Check for /help command
        if (query === '/help') {
            printHTML('<span class="ghost-prompt-echo">$ </span>' + escapeHTML(query), 'ghost-user-line');
            printLine('Commands:', 'ghost-system');
            printLine('  /model         \u2014 list available models', 'ghost-system');
            printLine('  /model <n>     \u2014 switch to model #n', 'ghost-system');
            printLine('  /clear         \u2014 clear chat history', 'ghost-system');
            printLine('  /help          \u2014 show this help', 'ghost-system');
            printLine('', 'ghost-system');
            return;
        }

        // Check for /clear command
        if (query === '/clear') {
            printHTML('<span class="ghost-prompt-echo">$ </span>' + escapeHTML(query), 'ghost-user-line');
            chatHistory = [];
            printLine('Chat history cleared.', 'ghost-system');
            printLine('', 'ghost-system');
            return;
        }

        // Echo user input
        printHTML('<span class="ghost-prompt-echo">$ </span>' + escapeHTML(query), 'ghost-user-line');

        // Initialize engine on first message
        if (!engine) {
            const ok = await initEngine();
            if (!ok) return;
        }

        isGenerating = true;
        input.disabled = true;

        log('turn: start', {
            query: query,
            historyLenBefore: chatHistory.length,
            model: currentModelId,
        });

        // Add to history
        chatHistory.push({ role: 'user', content: query });

        // On mobile, keep less history to reduce memory pressure.
        // Splice in pairs so the history always starts on a user message —
        // shifting one at a time used to leave [assistant, user, ...] which
        // some chat templates reject.
        const mobile = isMobileDevice();
        const maxTurns = mobile ? 2 : MAX_HISTORY;
        while (chatHistory.length > maxTurns * 2) {
            chatHistory.splice(0, 2);
        }

        const spinner = makeSpinner();
        spinner.show('searching...');

        // Create response line for streaming (hidden until first token)
        const responseLine = document.createElement('div');
        responseLine.className = 'ghost-line ghost-response';
        responseLine.style.display = 'none';
        document.getElementById('ghost-output').appendChild(responseLine);
        let fullResponse = '';

        try {
            const topK = mobile ? 2 : 3;
            let systemPrompt;

            // Guard: engine may have been disposed during search
            if (!isEngineReady()) {
                throw new Error('Engine was disposed before generation could start');
            }

            // Search the blog before every query and inject the hits as context
            const tSearch = performance.now();
            var searchResults = await performSearch(query, topK);
            log('search: done', {
                query: query,
                results: searchResults.length,
                titles: searchResults.map(function (r) { return r.postTitle; }),
                ms: Math.round(performance.now() - tSearch),
            });
            var toolBlock = null;

            if (searchResults.length > 0) {
                spinner.hide();
                toolBlock = printToolCall('search_blog', query, searchResults);
            }

            var searchContext = window.ghostSearch
                ? window.ghostSearch.format(searchResults)
                : '';
            systemPrompt = window.buildGhostSystemPrompt
                ? window.buildGhostSystemPrompt(searchContext)
                : (window.GHOST_SYSTEM_PROMPT || 'You are a helpful assistant.');

            const messages = [
                { role: 'system', content: systemPrompt },
                ...chatHistory
            ];

            dismissToolBlock(toolBlock);
            spinner.show('thinking...');

            log('engine.create: calling', {
                msgCount: messages.length,
                roles: messages.map(function (m) { return m.role; }),
                systemPromptLen: systemPrompt.length,
                systemPromptHasBlogList: systemPrompt.indexOf("DT's blog posts:") !== -1,
                historyMessages: chatHistory.map(function (m) {
                    return { role: m.role, contentLen: (m.content || '').length };
                }),
            });

            const tGen = performance.now();
            const asyncChunkGenerator = await engine.chat.completions.create({
                messages: messages,
                max_tokens: mobile ? 128 : 512,
                stream: true,
            });

            fullResponse = await streamResponse(asyncChunkGenerator, responseLine, spinner);
            log('engine.create: streamed', {
                fullResponseLen: fullResponse.length,
                ms: Math.round(performance.now() - tGen),
            });

            // Final render pass
            responseLine.innerHTML = renderResponse(fullResponse);

            const cleanResponse = stripThinkTags(fullResponse);
            log('turn: response', {
                fullResponse: fullResponse,
                cleanResponse: cleanResponse,
                empty: !cleanResponse,
            });

            if (!cleanResponse) {
                // CoT-only or empty: show error and roll the user turn back
                // out of history so the next turn doesn't see a dangling
                // user msg or get fed unstripped reasoning.
                responseLine.textContent = '[no response generated]';
                responseLine.className = 'ghost-line ghost-error';
                if (chatHistory.length && chatHistory[chatHistory.length - 1].role === 'user') {
                    chatHistory.pop();
                }
            } else {
                chatHistory.push({ role: 'assistant', content: cleanResponse });
            }
            log('turn: end', { historyLenAfter: chatHistory.length });
        } catch (err) {
            log('turn: error', err);
            spinner.hide();
            responseLine.style.display = '';
            const msg = err.message || String(err);
            responseLine.textContent = 'Error: ' + msg;
            responseLine.className = 'ghost-line ghost-error';

            // Only nuke the engine on errors that actually indicate it's
            // unusable. The old `mobile ||` clause forced a redownload after
            // every transient hiccup on phones.
            if (/memory|oom|abort|lost|destroy|disposed|gpu/i.test(msg)) {
                chatHistory = [];
                disposeEngine();
                printLine('Memory pressure detected \u2014 context cleared.', 'ghost-error');
                printLine('You can try again with a shorter question.', 'ghost-loading');
            }
        }

        // Add blank line after response
        printLine('', 'ghost-system');

        isGenerating = false;
        input.disabled = false;
        input.focus();
    }

    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ─── Init ───────────────────────────────────────────────────

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createWidget);
    } else {
        createWidget();
    }
})();
