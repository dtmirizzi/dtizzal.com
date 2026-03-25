// ghost-chat.js — Terminal-styled AI chat widget powered by WebLLM
// Runs entirely client-side using a browser-based LLM via WebGPU

(function () {
    'use strict';

    const WEBLLM_VERSION = '0.2.82'; // pinned version — includes Qwen3 support

    // ─── Model Catalog ───────────────────────────────────────────

    const MODELS = [
        { id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',   label: 'SmolLM2 360M',  brand: 'HuggingFace', vram: '~376MB',  size: '~200MB', mobile: true },
        { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',    label: 'Llama 3.2 1B',  brand: 'Meta',        vram: '~879MB',  size: '~500MB', mobile: true },
        { id: 'Qwen3-0.6B-q4f16_1-MLC',               label: 'Qwen3 0.6B',    brand: 'Alibaba',     vram: '~1.4GB',  size: '~300MB', mobile: true },
        { id: 'gemma-2-2b-it-q4f16_1-MLC',            label: 'Gemma 2 2B',    brand: 'Google',      vram: '~1.9GB',  size: '~1.2GB', mobile: false },
        { id: 'Qwen3-1.7B-q4f16_1-MLC',               label: 'Qwen3 1.7B',    brand: 'Alibaba',     vram: '~2.0GB',  size: '~900MB', mobile: false },
    ];

    const DEFAULT_MODEL_ID = 'Qwen3-0.6B-q4f16_1-MLC';
    const MAX_HISTORY = 10;

    let currentModelId = DEFAULT_MODEL_ID;
    let engine = null;
    let webllmModule = null;
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

    function printWelcome() {
        const output = document.getElementById('ghost-output');
        output.innerHTML = '';

        printLine("┌──────────────────────────────────────┐", 'ghost-system');
        printLine("│  ghost@dtizzal.com — digital ghost   │", 'ghost-system');
        printLine("│  Ask me about DT's blog, ideas,      │", 'ghost-system');
        printLine("│  career, or technical opinions.       │", 'ghost-system');
        printLine("│                                       │", 'ghost-system');
        printLine("│  Powered by in-browser AI (WebLLM)   │", 'ghost-system');
        printLine("│  Everything runs locally. No servers. │", 'ghost-system');
        printLine("│  Type /model to switch models.        │", 'ghost-system');
        printLine("└──────────────────────────────────────┘", 'ghost-system');
        printLine('', 'ghost-system');

        if (isMobileDevice()) {
            printLine("⚠ Mobile detected — memory is limited.", 'ghost-loading');
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
                const active = m.id === currentModelId ? ' ◀ active' : '';
                printLine('  ' + (i + 1) + ') ' + m.label + ' (' + m.brand + ') — ' + m.vram + ' VRAM, ~' + m.size + ' download' + active, 'ghost-system');
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
            try { engine.unload?.(); } catch (_) { /* ignore */ }
            engine = null;
        }

        currentModelId = selected.id;
        chatHistory = [];
        printLine('Switched to ' + selected.label + ' (' + selected.brand + ').', 'ghost-system');
        printLine('Model will load on your next message.', 'ghost-loading');
        printLine('', 'ghost-system');
    }

    // ─── WebLLM Engine ──────────────────────────────────────────

    function checkWebGPU() {
        return !!navigator.gpu;
    }

    async function initEngine() {
        if (engine || isLoading) return;
        if (!checkWebGPU()) {
            printLine('ERROR: WebGPU not available in this browser.', 'ghost-error');
            printLine('Try Chrome 113+ or Edge 113+ with WebGPU enabled.', 'ghost-error');
            return false;
        }

        isLoading = true;
        const model = getModel(currentModelId);
        const label = model ? model.label : currentModelId;
        const dlSize = model ? model.size : '?';
        const statusLine = printLine('Loading ' + label + '... (first time downloads ' + dlSize + ')', 'ghost-loading');

        try {
            if (!webllmModule) {
                webllmModule = await import(`https://esm.run/@mlc-ai/web-llm@${WEBLLM_VERSION}`);
            }

            engine = await webllmModule.CreateMLCEngine(currentModelId, {
                initProgressCallback: (progress) => {
                    if (progress.text) {
                        statusLine.textContent = progress.text;
                    }
                    scrollOutput();
                }
            });

            statusLine.textContent = label + ' loaded. Ready.';
            statusLine.className = 'ghost-line ghost-system';
            printLine('', 'ghost-system');
            isLoading = false;
            return true;
        } catch (err) {
            isLoading = false;
            statusLine.textContent = 'Failed to load ' + label + '.';
            statusLine.className = 'ghost-line ghost-error';
            printLine('Error: ' + err.message, 'ghost-error');
            printLine('', 'ghost-system');

            if (err.message && err.message.includes('WebGPU')) {
                printLine('WebGPU may not be fully supported. Try:', 'ghost-error');
                printLine('  chrome://flags → #enable-unsafe-webgpu', 'ghost-error');
            }
            return false;
        }
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
            printLine('  /model         — list available models', 'ghost-system');
            printLine('  /model <n>     — switch to model #n', 'ghost-system');
            printLine('  /clear         — clear chat history', 'ghost-system');
            printLine('  /help          — show this help', 'ghost-system');
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

        // Add to history
        chatHistory.push({ role: 'user', content: query });

        // On mobile, keep less history to reduce memory pressure
        const mobile = isMobileDevice();
        const maxTurns = mobile ? 3 : MAX_HISTORY;
        while (chatHistory.length > maxTurns * 2) {
            chatHistory.shift();
        }

        // Build messages array
        const messages = [
            { role: 'system', content: window.GHOST_SYSTEM_PROMPT || 'You are a helpful assistant.' },
            ...chatHistory
        ];

        // Show spinner while waiting for first token
        const spinnerLine = printHTML('<span class="ghost-spinner">thinking...</span>', '');

        // Create response line for streaming (hidden until first token)
        const responseLine = printLine('', 'ghost-response');
        responseLine.style.display = 'none';
        let fullResponse = '';

        try {
            const asyncChunkGenerator = await engine.chat.completions.create({
                messages: messages,
                temperature: 0.7,
                max_tokens: mobile ? 192 : 512,
                stream: true,
            });

            for await (const chunk of asyncChunkGenerator) {
                const delta = chunk.choices[0]?.delta?.content || '';
                if (delta && spinnerLine.parentNode) {
                    spinnerLine.remove();
                    responseLine.style.display = '';
                }
                fullResponse += delta;
                responseLine.textContent = fullResponse;
                scrollOutput();
            }

            // Clean up spinner if no tokens were generated
            if (spinnerLine.parentNode) {
                spinnerLine.remove();
                responseLine.style.display = '';
            }

            if (!fullResponse.trim()) {
                responseLine.textContent = '[no response generated]';
                responseLine.className = 'ghost-line ghost-error';
            }

            // Add assistant response to history
            chatHistory.push({ role: 'assistant', content: fullResponse });
        } catch (err) {
            if (spinnerLine.parentNode) {
                spinnerLine.remove();
                responseLine.style.display = '';
            }
            const msg = err.message || String(err);
            responseLine.textContent = 'Error: ' + msg;
            responseLine.className = 'ghost-line ghost-error';

            // On memory-related errors, try to recover by clearing history and resetting engine
            if (mobile || /memory|oom|abort|lost|destroyed/i.test(msg)) {
                chatHistory = [];
                if (engine) {
                    try { engine.unload?.(); } catch (_) { /* ignore */ }
                    engine = null;
                }
                printLine('Memory pressure detected — context cleared.', 'ghost-error');
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
