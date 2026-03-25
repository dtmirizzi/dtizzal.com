// ghost-chat.js — Terminal-styled AI chat widget powered by WebLLM
// Runs entirely client-side using a browser-based LLM via WebGPU

(function () {
    'use strict';

    const MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
    const MAX_HISTORY = 10; // max conversation turns to keep in context

    let engine = null;
    let isLoading = false;
    let isGenerating = false;
    let chatHistory = [];
    let isExpanded = false;
    let resizeState = null;

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
                    <input type="text" id="ghost-input" placeholder="ask the ghost something..." autocomplete="off" spellcheck="false" />
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
        const panel = document.getElementById('ghost-panel');
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
        printLine("└──────────────────────────────────────┘", 'ghost-system');
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
        const statusLine = printLine('Loading model... (first time downloads ~500MB)', 'ghost-loading');

        try {
            const webllm = await import('https://esm.run/@mlc-ai/web-llm');

            engine = await webllm.CreateMLCEngine(MODEL_ID, {
                initProgressCallback: (progress) => {
                    if (progress.text) {
                        statusLine.textContent = progress.text;
                    }
                    scrollOutput();
                }
            });

            statusLine.textContent = 'Model loaded. Ready.';
            statusLine.className = 'ghost-line ghost-system';
            printLine('', 'ghost-system');
            isLoading = false;
            return true;
        } catch (err) {
            isLoading = false;
            statusLine.textContent = 'Failed to load model.';
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

        // Trim history to keep context manageable
        while (chatHistory.length > MAX_HISTORY * 2) {
            chatHistory.shift();
        }

        // Build messages array
        const messages = [
            { role: 'system', content: window.GHOST_SYSTEM_PROMPT || 'You are a helpful assistant.' },
            ...chatHistory
        ];

        // Create response line for streaming
        const responseLine = printLine('', 'ghost-response');
        let fullResponse = '';

        try {
            const asyncChunkGenerator = await engine.chat.completions.create({
                messages: messages,
                temperature: 0.7,
                max_tokens: 512,
                stream: true,
            });

            for await (const chunk of asyncChunkGenerator) {
                const delta = chunk.choices[0]?.delta?.content || '';
                fullResponse += delta;
                responseLine.textContent = fullResponse;
                scrollOutput();
            }

            if (!fullResponse.trim()) {
                responseLine.textContent = '[no response generated]';
                responseLine.className = 'ghost-line ghost-error';
            }

            // Add assistant response to history
            chatHistory.push({ role: 'assistant', content: fullResponse });
        } catch (err) {
            responseLine.textContent = 'Error: ' + err.message;
            responseLine.className = 'ghost-line ghost-error';
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
