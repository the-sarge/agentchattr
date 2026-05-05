(function() {
    const SEARCH_LIMIT = 120;

    let messages = [];
    let commands = [];
    let facets = { senders: [], channels: [] };
    let activeIndex = 0;
    let lastOps = null;
    let isSearching = false;
    let searchTimer = null;
    let searchSeq = 0;
    let searchMeta = {
        returned: 0,
        limit: SEARCH_LIMIT,
        total_scanned: 0,
        truncated: false,
    };

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
                <div id="search-nav-status" class="search-nav-status"></div>
            </div>
        `;
        backdrop.addEventListener('click', event => {
            if (event.target === backdrop) closeSearchNav();
        });
        document.body.appendChild(backdrop);

        const input = document.getElementById('search-nav-input');
        input.addEventListener('input', () => scheduleSearch(150));
        input.addEventListener('keydown', handleInputKeydown);
        document.getElementById('search-nav-close').addEventListener('click', closeSearchNav);
        backdrop.querySelectorAll('select,input[type="checkbox"]').forEach(el => {
            el.addEventListener('change', () => scheduleSearch(0));
        });
        return backdrop;
    }

    function searchParams(filters) {
        const params = new URLSearchParams();
        params.set('limit', String(SEARCH_LIMIT));
        if (filters.query) params.set('q', filters.query);
        if (filters.sender) params.set('sender', filters.sender);
        if (filters.channel) params.set('channel', filters.channel);
        for (const key of ['pinned', 'todo', 'done', 'jobs', 'session', 'system']) {
            if (filters[key]) params.set(key, 'true');
        }
        return params;
    }

    async function fetchSearchResults(filters) {
        const seq = ++searchSeq;
        if (filters.query.startsWith('>')) {
            messages = [];
            searchMeta = { returned: 0, limit: SEARCH_LIMIT, total_scanned: 0, truncated: false };
            isSearching = false;
            render();
            return;
        }

        isSearching = true;
        render();
        try {
            const resp = await fetch(`/api/search?${searchParams(filters).toString()}`, { headers: tokenHeaders() });
            if (seq !== searchSeq) return;
            if (!resp.ok) throw new Error(`search failed: ${resp.status}`);
            const payload = await resp.json();
            messages = Array.isArray(payload.results) ? payload.results : [];
            facets = payload.facets || { senders: [], channels: [] };
            searchMeta = {
                returned: Number(payload.returned || messages.length),
                limit: Number(payload.limit || SEARCH_LIMIT),
                total_scanned: Number(payload.total_scanned || 0),
                truncated: Boolean(payload.truncated),
            };
        } catch (_err) {
            if (seq !== searchSeq) return;
            messages = [];
            searchMeta = {
                returned: 0,
                limit: SEARCH_LIMIT,
                total_scanned: 0,
                truncated: false,
                error: true,
            };
        } finally {
            if (seq === searchSeq) {
                isSearching = false;
                buildCommands();
                populateFilters();
                render();
            }
        }
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
        await fetchOps();
        buildCommands();
        populateFilters();
        fetchSearchResults(currentFilters());
    }

    function scheduleSearch(delay) {
        clearTimeout(searchTimer);
        activeIndex = 0;
        const filters = currentFilters();
        if (filters.query.startsWith('>')) {
            ++searchSeq;
            messages = [];
            isSearching = false;
            searchMeta = { returned: 0, limit: SEARCH_LIMIT, total_scanned: 0, truncated: false };
            render();
            return;
        }
        isSearching = true;
        render();
        searchTimer = setTimeout(() => fetchSearchResults(currentFilters()), delay);
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
            keywords: 'jobs job tasks work',
            run: () => openPanel('jobs-panel', window.toggleJobsPanel),
        });
        items.push({
            title: 'Open Rules',
            detail: 'panel',
            keywords: 'rules decisions decision remind',
            run: () => openPanel('rules-panel', window.toggleRulesPanel),
        });
        items.push({
            title: 'Open Agent Operations',
            detail: 'panel',
            keywords: 'agent agents operations ops tmux status services project',
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
                    keywords: `copy attach tmux live ${agent.name} ${agent.label || ''}`,
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

    function uniqueSorted(values) {
        return [...new Set(values.filter(Boolean).map(v => String(v)))].sort((a, b) => a.localeCompare(b));
    }

    function populateFilters() {
        const senderSelect = document.getElementById('search-nav-sender');
        const channelSelect = document.getElementById('search-nav-channel');
        if (!senderSelect || !channelSelect) return;
        const senderValue = senderSelect.value;
        const channelValue = channelSelect.value;
        const configuredSenders = (lastOps?.configured_agents || []).map(agent => agent.name);
        const senders = uniqueSorted([
            ...(facets.senders || []),
            ...configuredSenders,
            ...messages.map(m => m.sender),
        ]);
        const channels = uniqueSorted([
            ...(Array.isArray(window.channelList) ? window.channelList : []),
            ...(facets.channels || []),
            ...messages.map(m => m.channel || 'general'),
        ]);
        if (senderValue && !senders.includes(senderValue)) senders.unshift(senderValue);
        if (channelValue && !channels.includes(channelValue)) channels.unshift(channelValue);

        senderSelect.innerHTML = '<option value="">Any sender</option>' + senders.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
        channelSelect.innerHTML = '<option value="">Any channel</option>' + channels.map(ch => `<option value="${esc(ch)}">#${esc(ch)}</option>`).join('');
        senderSelect.value = senderValue;
        channelSelect.value = channelValue;
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
        const messageMatches = commandOnly || isSearching ? [] : messages.slice(0, SEARCH_LIMIT);
        const parts = [];
        if (commandMatches.length) {
            parts.push('<div class="search-nav-group">Commands</div>');
            parts.push(commandMatches.map((cmd, idx) => renderCommand(cmd, idx, filters.query)).join(''));
        }
        if (isSearching && !commandOnly) {
            parts.push('<div class="search-nav-empty">Searching messages...</div>');
        } else if (messageMatches.length) {
            parts.push('<div class="search-nav-group">Messages</div>');
            parts.push(messageMatches.map((msg, idx) => renderMessageResult(msg, commandMatches.length + idx, filters.query)).join(''));
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
        updateStatus(commandOnly, commandMatches.length, messageMatches.length);
        updateActive();
    }

    function renderCommand(cmd, idx, rawQuery) {
        return `
            <button class="search-nav-item" data-index="${idx}" data-kind="command">
                <div class="search-nav-main">
                    <div class="search-nav-title"><span>${highlightText(cmd.title, rawQuery)}</span></div>
                    <div class="search-nav-snippet">${highlightText(cmd.keywords || '', rawQuery)}</div>
                </div>
                <div class="search-nav-meta">${esc(cmd.detail || '')}</div>
            </button>
        `;
    }

    function renderMessageResult(msg, idx, rawQuery) {
        const text = textOf(msg).replace(/\s+/g, ' ').trim();
        const title = `${msg.sender || 'unknown'} in #${msg.channel || 'general'}`;
        const metaParts = [];
        if (msg.time) metaParts.push(msg.time);
        const todoStatus = msg.todo_status || window.todos?.[msg.id] || '';
        if (todoStatus) metaParts.push(todoStatus);
        const meta = metaParts.join(' | ') || (msg.timestamp ? new Date(msg.timestamp * 1000).toLocaleString() : '');
        const snippet = snippetForQuery(text || '(no text)', rawQuery);
        return `
            <button class="search-nav-item" data-index="${idx}" data-kind="message" data-id="${esc(msg.id)}" data-channel="${esc(msg.channel || 'general')}">
                <div class="search-nav-main">
                    <div class="search-nav-title"><span>${esc(title)}</span></div>
                    <div class="search-nav-snippet">${highlightText(snippet, rawQuery)}</div>
                </div>
                <div class="search-nav-meta">${esc(meta)}</div>
            </button>
        `;
    }

    function highlightText(value, rawQuery) {
        const text = String(value ?? '');
        const query = rawQuery.replace(/^>\s*/, '').trim();
        if (!query || query.startsWith('@')) return esc(text);
        const lower = text.toLowerCase();
        const needle = query.toLowerCase();
        const idx = lower.indexOf(needle);
        if (idx < 0) return esc(text);
        return `${esc(text.slice(0, idx))}<mark class="search-nav-match">${esc(text.slice(idx, idx + needle.length))}</mark>${esc(text.slice(idx + needle.length))}`;
    }

    function snippetForQuery(text, rawQuery) {
        const query = rawQuery.replace(/^>\s*/, '').trim().toLowerCase();
        if (!query || query.startsWith('@')) return text;
        const lower = text.toLowerCase();
        const idx = lower.indexOf(query);
        if (idx < 0) return text;
        const start = Math.max(0, idx - 64);
        const end = Math.min(text.length, idx + query.length + 112);
        return `${start > 0 ? '... ' : ''}${text.slice(start, end)}${end < text.length ? ' ...' : ''}`;
    }

    function updateStatus(commandOnly, commandCount, messageCount) {
        const status = document.getElementById('search-nav-status');
        if (!status) return;
        if (isSearching && !commandOnly) {
            status.textContent = 'Searching full history...';
            return;
        }
        if (searchMeta.error) {
            status.textContent = 'Search failed. Commands are still available.';
            return;
        }
        const parts = [];
        if (commandCount) parts.push(`${commandCount} command${commandCount === 1 ? '' : 's'}`);
        if (!commandOnly) {
            parts.push(`${messageCount} message${messageCount === 1 ? '' : 's'}`);
            if (searchMeta.truncated) parts.push(`showing first ${searchMeta.limit}`);
        }
        parts.push('Enter opens');
        parts.push('Cmd/Ctrl+. focuses composer');
        status.textContent = parts.join(' | ');
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
        items[activeIndex]?.scrollIntoView({ block: 'nearest' });
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
            setTimeout(() => window.scrollToMessage?.(id), 120);
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
        const pageStep = 8;
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
        } else if (event.key === 'PageDown') {
            event.preventDefault();
            activeIndex += pageStep;
            updateActive();
        } else if (event.key === 'PageUp') {
            event.preventDefault();
            activeIndex -= pageStep;
            updateActive();
        } else if (event.key === 'Home') {
            event.preventDefault();
            activeIndex = 0;
            updateActive();
        } else if (event.key === 'End') {
            event.preventDefault();
            activeIndex = 99999;
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
        clearTimeout(searchTimer);
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
