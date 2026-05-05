(function() {
    let messages = [];
    let commands = [];
    let activeIndex = 0;
    let lastOps = null;

    function tokenHeaders() {
        const token = window.__SESSION_TOKEN__ || window.SESSION_TOKEN || '';
        return token ? { 'X-Session-Token': token } : {};
    }

    function esc(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[ch]));
    }

    function textOf(msg) {
        return String(msg.text || msg.body || msg.message || '');
    }

    function ensureDialog() {
        let backdrop = document.getElementById('search-nav-backdrop');
        if (backdrop) return backdrop;
        backdrop = document.createElement('div');
        backdrop.id = 'search-nav-backdrop';
        backdrop.className = 'search-nav-backdrop hidden';
        backdrop.innerHTML = `
            <div class="search-nav-dialog" role="dialog" aria-modal="true">
                <div class="search-nav-top">
                    <input id="search-nav-input" class="search-nav-input" type="text" autocomplete="off" spellcheck="false" placeholder="Search messages, @sender, channels, commands">
                    <button id="search-nav-close" class="search-nav-close" title="Close">&times;</button>
                </div>
                <div class="search-nav-filters">
                    <select id="search-nav-sender" title="Sender filter"><option value="">Any sender</option></select>
                    <select id="search-nav-channel" title="Channel filter"><option value="">Any channel</option></select>
                    <label><input type="checkbox" id="search-nav-pinned"> pinned</label>
                    <label><input type="checkbox" id="search-nav-todo"> todo</label>
                    <label><input type="checkbox" id="search-nav-done"> done</label>
                    <label><input type="checkbox" id="search-nav-jobs"> jobs</label>
                    <label><input type="checkbox" id="search-nav-session"> sessions</label>
                    <label><input type="checkbox" id="search-nav-system"> system</label>
                </div>
                <div id="search-nav-results" class="search-nav-results"></div>
            </div>
        `;
        backdrop.addEventListener('click', event => {
            if (event.target === backdrop) closeSearchNav();
        });
        document.body.appendChild(backdrop);

        const input = document.getElementById('search-nav-input');
        input.addEventListener('input', render);
        input.addEventListener('keydown', handleInputKeydown);
        document.getElementById('search-nav-close').addEventListener('click', closeSearchNav);
        backdrop.querySelectorAll('select,input[type="checkbox"]').forEach(el => {
            el.addEventListener('change', render);
        });
        return backdrop;
    }

    async function fetchMessages() {
        const resp = await fetch('/api/messages?limit=500', { headers: tokenHeaders() });
        if (!resp.ok) return [];
        return resp.json();
    }

    async function fetchOps() {
        try {
            const resp = await fetch('/api/agent-ops', { headers: tokenHeaders() });
            if (resp.ok) lastOps = await resp.json();
        } catch (_err) {
            lastOps = null;
        }
    }

    async function refreshData() {
        const [msgs] = await Promise.all([fetchMessages(), fetchOps()]);
        messages = Array.isArray(msgs) ? msgs.slice().reverse() : [];
        buildCommands();
        populateFilters();
        render();
    }

    function buildCommands() {
        const items = [];
        const channels = Array.isArray(window.channelList) ? window.channelList : ['general'];
        for (const ch of channels) {
            items.push({
                title: `Switch to #${ch}`,
                detail: 'channel',
                kind: 'channel',
                value: ch,
                keywords: `channel switch ${ch}`,
                run: () => {
                    window.switchChannel?.(ch);
                },
            });
        }
        items.push({
            title: 'Open Jobs',
            detail: 'panel',
            keywords: 'jobs tasks work',
            run: () => openPanel('jobs-panel', window.toggleJobsPanel),
        });
        items.push({
            title: 'Open Rules',
            detail: 'panel',
            keywords: 'rules decisions',
            run: () => openPanel('rules-panel', window.toggleRulesPanel),
        });
        items.push({
            title: 'Open Agent Operations',
            detail: 'panel',
            keywords: 'agent operations ops tmux status',
            run: () => window.toggleAgentOpsPanel?.(true),
        });
        items.push({
            title: 'Open Pinned Items',
            detail: 'panel',
            keywords: 'pins pinned todos todo done',
            run: () => openPanel('pins-panel', window.togglePinsPanel),
        });
        items.push({
            title: 'Continue Loop Guard',
            detail: 'chat',
            keywords: 'continue loop guard resume routing',
            run: () => {
                const input = document.getElementById('input');
                if (input) input.value = '/continue';
                window.sendMessage?.();
            },
        });
        for (const agent of lastOps?.configured_agents || []) {
            if (agent.attach?.live) {
                items.push({
                    title: `Copy attach command for ${agent.label || agent.name}`,
                    detail: 'tmux',
                    keywords: `copy attach tmux ${agent.name} ${agent.label || ''}`,
                    run: () => copyText(agent.attach.live),
                });
            }
            if (agent.attach?.wrapper) {
                items.push({
                    title: `Copy wrapper attach for ${agent.label || agent.name}`,
                    detail: 'tmux',
                    keywords: `copy attach wrapper tmux ${agent.name} ${agent.label || ''}`,
                    run: () => copyText(agent.attach.wrapper),
                });
            }
        }
        commands = items;
    }

    function openPanel(panelId, toggleFn) {
        const panel = document.getElementById(panelId);
        if (panel?.classList.contains('hidden')) toggleFn?.();
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (_err) {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
    }

    function populateFilters() {
        const senderSelect = document.getElementById('search-nav-sender');
        const channelSelect = document.getElementById('search-nav-channel');
        if (!senderSelect || !channelSelect) return;
        const senderValue = senderSelect.value;
        const channelValue = channelSelect.value;
        const senders = [...new Set(messages.map(m => m.sender).filter(Boolean))].sort();
        const channels = [...new Set([
            ...(Array.isArray(window.channelList) ? window.channelList : []),
            ...messages.map(m => m.channel || 'general'),
        ].filter(Boolean))].sort();
        senderSelect.innerHTML = '<option value="">Any sender</option>' + senders.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
        channelSelect.innerHTML = '<option value="">Any channel</option>' + channels.map(ch => `<option value="${esc(ch)}">#${esc(ch)}</option>`).join('');
        senderSelect.value = senders.includes(senderValue) ? senderValue : '';
        channelSelect.value = channels.includes(channelValue) ? channelValue : '';
    }

    function currentFilters() {
        return {
            query: document.getElementById('search-nav-input')?.value.trim() || '',
            sender: document.getElementById('search-nav-sender')?.value || '',
            channel: document.getElementById('search-nav-channel')?.value || '',
            pinned: document.getElementById('search-nav-pinned')?.checked || false,
            todo: document.getElementById('search-nav-todo')?.checked || false,
            done: document.getElementById('search-nav-done')?.checked || false,
            jobs: document.getElementById('search-nav-jobs')?.checked || false,
            session: document.getElementById('search-nav-session')?.checked || false,
            system: document.getElementById('search-nav-system')?.checked || false,
        };
    }

    function render() {
        const root = document.getElementById('search-nav-results');
        if (!root) return;
        const filters = currentFilters();
        const commandOnly = filters.query.startsWith('>');
        const query = filters.query.replace(/^>\s*/, '').toLowerCase();
        const commandMatches = commandMatchesForQuery(query);
        const messageMatches = commandOnly ? [] : messages.filter(msg => matchesMessage(msg, filters)).slice(0, 80);
        const parts = [];
        if (commandMatches.length) {
            parts.push('<div class="search-nav-group">Commands</div>');
            parts.push(commandMatches.map((cmd, idx) => renderCommand(cmd, idx)).join(''));
        }
        if (messageMatches.length) {
            parts.push('<div class="search-nav-group">Messages</div>');
            parts.push(messageMatches.map((msg, idx) => renderMessageResult(msg, commandMatches.length + idx)).join(''));
        }
        if (!parts.length) {
            parts.push('<div class="search-nav-empty">No matches.</div>');
        }
        root.innerHTML = parts.join('');
        root.querySelectorAll('.search-nav-item').forEach((item, idx) => {
            item.classList.toggle('active', idx === activeIndex);
            item.addEventListener('mouseenter', () => {
                activeIndex = idx;
                updateActive();
            });
        });
        updateActive();
    }

    function matchesMessage(msg, filters) {
        if (filters.query.startsWith('>')) return false;
        const query = filters.query.toLowerCase();
        const senderQuery = query.startsWith('@') ? query.slice(1) : '';
        if (query === '@') return false;
        const content = textOf(msg).toLowerCase();
        if (senderQuery) {
            const sender = String(msg.sender || '').toLowerCase();
            if (!sender.startsWith(senderQuery)) return false;
        } else if (query && !content.includes(query)) {
            return false;
        }
        if (filters.sender && msg.sender !== filters.sender) return false;
        if (filters.channel && (msg.channel || 'general') !== filters.channel) return false;

        const todoStatus = window.todos?.[msg.id] || null;
        const typeFilters = [];
        if (filters.pinned) typeFilters.push(Boolean(todoStatus));
        if (filters.todo) typeFilters.push(todoStatus === 'todo');
        if (filters.done) typeFilters.push(todoStatus === 'done');
        if (filters.jobs) typeFilters.push(Boolean(msg.job_id || msg.metadata?.job_id));
        if (filters.session) typeFilters.push(Boolean(msg.type === 'session' || msg.metadata?.session_id || msg.metadata?.session_run_id));
        if (filters.system) typeFilters.push(Boolean(msg.sender === 'system' || ['join', 'leave', 'summary', 'system'].includes(msg.type)));
        return !typeFilters.length || typeFilters.some(Boolean);
    }

    function renderCommand(cmd, idx) {
        return `
            <button class="search-nav-item" data-index="${idx}" data-kind="command">
                <div class="search-nav-main">
                    <div class="search-nav-title"><span>${esc(cmd.title)}</span></div>
                    <div class="search-nav-snippet">${esc(cmd.keywords || '')}</div>
                </div>
                <div class="search-nav-meta">${esc(cmd.detail || '')}</div>
            </button>
        `;
    }

    function renderMessageResult(msg, idx) {
        const text = textOf(msg).replace(/\s+/g, ' ').trim();
        const title = `${msg.sender || 'unknown'} in #${msg.channel || 'general'}`;
        const meta = msg.time || (msg.timestamp ? new Date(msg.timestamp * 1000).toLocaleString() : '');
        return `
            <button class="search-nav-item" data-index="${idx}" data-kind="message" data-id="${esc(msg.id)}" data-channel="${esc(msg.channel || 'general')}">
                <div class="search-nav-main">
                    <div class="search-nav-title"><span>${esc(title)}</span></div>
                    <div class="search-nav-snippet">${esc(text || '(no text)')}</div>
                </div>
                <div class="search-nav-meta">${esc(meta)}</div>
            </button>
        `;
    }

    function updateActive() {
        const items = [...document.querySelectorAll('#search-nav-results .search-nav-item')];
        if (!items.length) {
            activeIndex = 0;
            return;
        }
        if (activeIndex < 0) activeIndex = items.length - 1;
        if (activeIndex >= items.length) activeIndex = 0;
        items.forEach((item, idx) => item.classList.toggle('active', idx === activeIndex));
    }

    function activateCurrent() {
        const items = [...document.querySelectorAll('#search-nav-results .search-nav-item')];
        const item = items[activeIndex];
        if (!item) return;
        const kind = item.dataset.kind;
        if (kind === 'command') {
            const commandItems = currentCommandMatches();
            const cmd = commandItems[Number(item.dataset.index)];
            closeSearchNav();
            cmd?.run();
            return;
        }
        if (kind === 'message') {
            const id = item.dataset.id;
            const channel = item.dataset.channel || 'general';
            closeSearchNav();
            if (window.activeChannel !== channel) window.switchChannel?.(channel);
            setTimeout(() => window.scrollToMessage?.(id), 80);
        }
    }

    function currentCommandMatches() {
        const filters = currentFilters();
        const query = filters.query.replace(/^>\s*/, '').toLowerCase();
        return commandMatchesForQuery(query);
    }

    function commandMatchesForQuery(query) {
        if (!query) return commands.slice(0, 12);
        return commands
            .map((cmd, index) => ({ cmd, index, score: commandScore(cmd, query) }))
            .filter(item => item.score !== null)
            .sort((a, b) => a.score - b.score || a.index - b.index)
            .map(item => item.cmd)
            .slice(0, 12);
    }

    function commandScore(cmd, query) {
        const title = String(cmd.title || '').toLowerCase();
        const keywords = String(cmd.keywords || '').toLowerCase();
        if (cmd.kind === 'channel') {
            const channel = String(cmd.value || '').toLowerCase();
            if (query === channel || query === `#${channel}`) return 0;
            if (channel.startsWith(query) || `#${channel}`.startsWith(query)) return 1;
        }
        if (title.startsWith(query)) return 2;
        if (keywords.split(/\s+/).some(word => word.startsWith(query))) return 3;
        if (`${title} ${keywords}`.includes(query)) return 4;
        return null;
    }

    function handleInputKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeSearchNav();
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            activeIndex += 1;
            updateActive();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            activeIndex -= 1;
            updateActive();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            activateCurrent();
        }
    }

    window.openSearchNav = function() {
        const backdrop = ensureDialog();
        backdrop.classList.remove('hidden');
        document.getElementById('search-nav-toggle')?.classList.add('active');
        activeIndex = 0;
        refreshData();
        setTimeout(() => document.getElementById('search-nav-input')?.focus(), 0);
    };

    window.closeSearchNav = function() {
        const backdrop = document.getElementById('search-nav-backdrop');
        if (backdrop) backdrop.classList.add('hidden');
        document.getElementById('search-nav-toggle')?.classList.remove('active');
    };

    document.addEventListener('keydown', event => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            window.openSearchNav();
        }
    });

    document.addEventListener('click', event => {
        const item = event.target.closest?.('#search-nav-results .search-nav-item');
        if (!item) return;
        activeIndex = Number(item.dataset.index || 0);
        activateCurrent();
    });
})();
