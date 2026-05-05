// message-rendering.js -- timeline message rendering and date dividers
// Extracted from chat.js. Shared chat state is reached through window.* bridges.

(function() {
    'use strict';

    let lastMessageDates = {};  // { channel: dateString } for per-channel dividers
    const missingBridges = new Set();

    function reportMissingBridge(name) {
        if (missingBridges.has(name)) return;
        missingBridges.add(name);
        console.error(`MessageRendering: ${name} bridge not registered`);
    }

    function getBridgeFn(name, fallback) {
        if (typeof window[name] === 'function') return window[name];
        reportMissingBridge(`window.${name}`);
        return fallback;
    }

    function htmlEscape(text) {
        const escape = getBridgeFn('escapeHtml', null);
        if (escape) return escape(text);
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function htmlAttr(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[ch]));
    }

    function renderMarkdownBridge(text) {
        const renderMarkdown = getBridgeFn('renderMarkdown', null);
        return renderMarkdown ? renderMarkdown(text) : htmlEscape(text);
    }

    function styleHashtagsBridge(html) {
        const styleHashtags = getBridgeFn('styleHashtags', null);
        return styleHashtags ? styleHashtags(html) : html;
    }

    function addCodeCopyButtonsBridge(container) {
        const addCodeCopyButtons = getBridgeFn('addCodeCopyButtons', null);
        if (addCodeCopyButtons) addCodeCopyButtons(container);
    }

    function getColorBridge(sender) {
        const getColor = getBridgeFn('getColor', null);
        return getColor ? getColor(sender) : 'var(--text-dim)';
    }

    function getAvatarSvgBridge(sender) {
        const getAvatarSvg = getBridgeFn('getAvatarSvg', null);
        return getAvatarSvg ? getAvatarSvg(sender) : '';
    }

    function resolveAgentBridge(name) {
        const resolveAgent = getBridgeFn('resolveAgent', null);
        return resolveAgent ? resolveAgent(name) : null;
    }

    function isSelfSenderBridge(sender) {
        const isSelfSender = getBridgeFn('isSelfSender', null);
        return isSelfSender ? isSelfSender(sender) : false;
    }

    function todoStatusLabelBridge(status) {
        const todoStatusLabel = getBridgeFn('todoStatusLabel', null);
        if (todoStatusLabel) return todoStatusLabel(status);
        if (!status) return 'pin';
        if (status === 'todo') return 'done?';
        return 'unpin';
    }

    function renderChannelTabsBridge() {
        const renderChannelTabs = getBridgeFn('renderChannelTabs', null);
        if (renderChannelTabs) renderChannelTabs();
    }

    function scrollToBottomBridge() {
        const scrollToBottom = getBridgeFn('scrollToBottom', null);
        if (scrollToBottom) scrollToBottom();
    }

    function updateScrollAnchorBridge() {
        const updateScrollAnchor = getBridgeFn('updateScrollAnchor', null);
        if (updateScrollAnchor) updateScrollAnchor();
    }

    function playCrossChannelSoundBridge() {
        const playCrossChannelSound = getBridgeFn('playCrossChannelSound', null);
        if (playCrossChannelSound) playCrossChannelSound();
    }

    function getActiveChannel() {
        if (typeof window.activeChannel === 'string' && window.activeChannel) return window.activeChannel;
        reportMissingBridge('window.activeChannel');
        return 'general';
    }

    function getAgentConfig() {
        if (window.agentConfig) return window.agentConfig;
        reportMissingBridge('window.agentConfig');
        return {};
    }

    function getAgentHats() {
        if (window.agentHats) return window.agentHats;
        reportMissingBridge('window.agentHats');
        return {};
    }

    function getAgentRole(sender) {
        const getRole = getBridgeFn('getAgentRole', null);
        return getRole ? getRole(sender) : '';
    }

    function getTodos() {
        if (window.todos) return window.todos;
        reportMissingBridge('window.todos');
        return {};
    }

    function getChannelUnread() {
        if (window.channelUnread) return window.channelUnread;
        reportMissingBridge('window.channelUnread');
        return {};
    }

    function soundsEnabled() {
        if (typeof window.soundEnabled === 'boolean') return window.soundEnabled;
        reportMissingBridge('window.soundEnabled');
        return false;
    }

    function autoScrollEnabled() {
        if (typeof window.autoScroll === 'boolean') return window.autoScroll;
        reportMissingBridge('window.autoScroll');
        return true;
    }

    function incrementUnreadCount() {
        // Keep this guard loud if appendMessage ever runs before chat.js installs bridges.
        if (!('unreadCount' in window)) {
            reportMissingBridge('window.unreadCount');
            return;
        }
        window.unreadCount = window.unreadCount + 1;
    }

    function setLastMentionedAgent(agent) {
        // Keep this guard loud if appendMessage ever runs before chat.js installs bridges.
        if ('_lastMentionedAgent' in window) {
            window._lastMentionedAgent = agent;
        } else {
            reportMissingBridge('window._lastMentionedAgent');
        }
    }

    // --- Date dividers ---

    function getMessageDate(msg) {
        // msg.time is "HH:MM:SS" -- we also need the date.
        // Use msg.timestamp (epoch) if available, otherwise infer from today.
        if (msg.timestamp) {
            return new Date(msg.timestamp * 1000).toDateString();
        }
        return new Date().toDateString();
    }

    function formatDateDivider(dateStr) {
        const date = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) return 'Today';
        if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

        return date.toLocaleDateString('en-GB', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
    }

    function maybeInsertDateDivider(container, msg) {
        const msgDate = getMessageDate(msg);
        const channel = msg.channel || 'general';
        const lastDate = lastMessageDates[channel];

        if (msgDate !== lastDate) {
            lastMessageDates[channel] = msgDate;
            const divider = document.createElement('div');
            divider.className = 'date-divider';
            divider.dataset.channel = channel;
            divider.innerHTML = `<span>${formatDateDivider(msgDate)}</span>`;
            if (channel !== getActiveChannel()) {
                divider.style.display = 'none';
            }
            container.appendChild(divider);
        }
    }

    function renameChannelDateState(oldName, newName) {
        if (lastMessageDates[oldName]) {
            lastMessageDates[newName] = lastMessageDates[oldName];
            delete lastMessageDates[oldName];
        }
    }

    function clearChannelDateState(channel) {
        delete lastMessageDates[channel];
    }

    function resetDateState() {
        lastMessageDates = {};
    }

    // --- Messages ---

    function appendMessage(msg) {
        const container = document.getElementById('messages');
        if (!container) {
            console.error('MessageRendering: #messages element not found');
            return;
        }

        // Insert date divider if needed
        maybeInsertDateDivider(container, msg);

        const el = document.createElement('div');
        el.className = 'message';
        el.dataset.id = msg.id;
        const msgChannel = msg.channel || 'general';
        el.dataset.channel = msgChannel;

        if (msg.type === 'join' || msg.type === 'leave') {
            el.classList.add('join-msg');
            const color = getColorBridge(msg.sender);
            el.innerHTML = `<span class="join-dot" style="background: ${color}"></span><span class="join-text"><strong style="color: ${color}">${htmlEscape(msg.sender)}</strong> ${msg.type === 'join' ? 'joined' : 'left'}</span>`;
        } else if (msg.type === 'summary') {
            el.classList.add('summary-msg');
            const color = getColorBridge(msg.sender);
            el.innerHTML = `<div class="summary-card"><span class="summary-pill">Summary</span><span class="summary-author" style="color: ${color}">${htmlEscape(msg.sender)}</span><div class="summary-text">${htmlEscape(msg.text)}</div></div>`;
        } else if (msg.type === 'job_proposal') {
            el.classList.add('proposal-msg');
            const meta = msg.metadata || {};
            const title = htmlEscape(meta.title || '');
            const body = meta.body ? renderMarkdownBridge(meta.body) : '';
            const color = getColorBridge(msg.sender);
            const status = meta.status || 'pending';
            const isPending = status === 'pending';
            el.dataset.proposalTitle = meta.title || '';
            el.dataset.proposalBody = meta.body || '';
            el.dataset.proposalSender = msg.sender || '';
            el.innerHTML = `
                <div class="proposal-card ${isPending ? '' : 'proposal-resolved'}">
                    <div class="proposal-header">
                        <span class="proposal-pill">Job Proposal</span>
                        <span class="proposal-author" style="color: ${color}">${htmlEscape(msg.sender)}</span>
                    </div>
                    <div class="proposal-title">${title}</div>
                    ${body ? `<div class="proposal-body">${body}</div>` : ''}
                    ${isPending ? `
                        <div class="proposal-actions">
                            <button class="proposal-accept" onclick="acceptProposal(${msg.id})">Accept</button>
                            <button class="proposal-request-changes" onclick="requestChangesProposal(${msg.id})">Request Changes</button>
                            <button class="proposal-dismiss" onclick="dismissProposal(${msg.id})">Dismiss</button>
                        </div>
                    ` : `
                        <div class="proposal-status-resolved">${status === 'accepted' ? 'Accepted' : 'Dismissed'}</div>
                    `}
                </div>
                ${!isPending ? `<div class="msg-actions"><button class="reply-btn" onclick="startReply(${msg.id}, event)">reply</button><button class="delete-btn" onclick="deleteClick(${msg.id}, event)" title="Delete">del</button></div>` : ''}`;
        } else if (msg.type === 'rule_proposal') {
            el.classList.add('proposal-msg');
            const meta = msg.metadata || {};
            const ruleText = htmlEscape(meta.text || msg.text || '');
            const color = getColorBridge(msg.sender);
            const status = meta.status || 'pending';
            const isPending = status === 'pending';
            el.innerHTML = `
                <div class="proposal-card rule-proposal-card ${isPending ? '' : 'proposal-resolved'}">
                    <div class="proposal-header">
                        <span class="proposal-pill rule-proposal-pill">Rule Proposal</span>
                        <span class="proposal-author" style="color: ${color}">${htmlEscape(msg.sender)}</span>
                    </div>
                    <div class="rule-proposal-text">${ruleText}</div>
                    ${isPending ? `
                        <div class="proposal-actions">
                            <button class="proposal-accept" onclick="resolveRuleProposal(${msg.id}, 'activate')">Activate</button>
                            <button class="proposal-request-changes" onclick="resolveRuleProposal(${msg.id}, 'draft')">Add to drafts</button>
                            <button class="proposal-dismiss" onclick="dismissRuleProposal(${msg.id})">Dismiss</button>
                        </div>
                    ` : `
                        <div class="proposal-status-resolved">${status === 'activated' ? 'Activated' : status === 'drafted' ? 'Added to drafts' : 'Dismissed'}</div>
                    `}
                </div>
                ${!isPending ? `<div class="msg-actions"><button class="reply-btn" onclick="startReply(${msg.id}, event)">reply</button><button class="delete-btn" onclick="deleteClick(${msg.id}, event)" title="Delete">del</button></div>` : ''}`;
        } else if (window._messageRenderers && window._messageRenderers[msg.type]) {
            window._messageRenderers[msg.type](el, msg);
        } else if (msg.type === 'system' || msg.sender === 'system') {
            el.classList.add('system-msg');
            el.innerHTML = `<span class="msg-text">${htmlEscape(msg.text)}</span>`;
        } else {
            const isError = msg.text.startsWith('[') && msg.text.includes('error');
            if (isError) el.classList.add('error-msg');

            // Update last mentioned agent if message is from user (Ben)
            if (isSelfSenderBridge(msg.sender)) {
                const mentions = msg.text.match(/@(\w[\w-]*)/g);
                if (mentions) {
                    const lastMention = mentions[mentions.length - 1].slice(1).toLowerCase();
                    // Check against registered agents (agentConfig keys are name labels)
                    if (getAgentConfig()[lastMention]) {
                        setLastMentionedAgent(lastMention);
                    }
                }
            }

            let textHtml = styleHashtagsBridge(renderMarkdownBridge(msg.text));

            const senderColor = getColorBridge(msg.sender);
            const isSelf = isSelfSenderBridge(msg.sender);
            el.classList.add(isSelf ? 'self' : 'other');

            let attachmentsHtml = '';
            if (msg.attachments && msg.attachments.length > 0) {
                attachmentsHtml = '<div class="msg-attachments">';
                for (const att of msg.attachments) {
                    attachmentsHtml += `<img src="${htmlAttr(att.url)}" alt="${htmlAttr(att.name)}" data-image-modal-url="${htmlAttr(att.url)}">`;
                }
                attachmentsHtml += '</div>';
            }

            const todoStatus = getTodos()[msg.id] || null;

            // Reply quote (if this message is a reply)
            let replyHtml = '';
            if (msg.reply_to !== undefined && msg.reply_to !== null) {
                const parentEl = document.querySelector(`.message[data-id="${msg.reply_to}"]`);
                if (parentEl) {
                    const parentSender = parentEl.querySelector('.msg-sender')?.textContent || '?';
                    const parentText = parentEl.dataset.rawText || parentEl.querySelector('.msg-text')?.textContent || '';
                    const truncated = parentText.length > 80 ? parentText.slice(0, 80) + '...' : parentText;
                    const parentColor = parentEl.querySelector('.msg-sender')?.style.color || 'var(--text-dim)';
                    replyHtml = `<div class="reply-quote" onclick="scrollToMessage(${msg.reply_to})"><span class="reply-sender" style="color: ${parentColor}">${htmlEscape(parentSender)}</span> ${htmlEscape(truncated)}</div>`;
                }
            }

            const agentKey = (resolveAgentBridge(msg.sender.toLowerCase()) || msg.sender).toLowerCase();
            const hatSvg = getAgentHats()[agentKey] || '';
            const hatHtml = hatSvg ? `<div class="hat-overlay" data-agent="${htmlEscape(agentKey)}">${hatSvg}</div>` : '';
            const avatarHtml = `<div class="avatar-wrap" data-agent="${htmlEscape(agentKey)}"><div class="avatar" style="background-color: ${senderColor}">${getAvatarSvgBridge(msg.sender)}</div>${hatHtml}</div>`;

            const statusLabel = todoStatusLabelBridge(todoStatus);
            el.dataset.rawText = msg.text;
            const senderRole = getAgentRole(msg.sender);
            const roleClass = senderRole ? 'bubble-role has-role' : 'bubble-role';
            const rolePillHtml = !isSelf ? `<button class="${roleClass}" onclick="showBubbleRolePicker(this, '${htmlEscape(msg.sender)}')" title="${senderRole ? htmlEscape(senderRole) : 'Set role'}">${senderRole || 'choose a role'}</button>` : '';
            // Inline decision choices (if present)
            let choicesHtml = '';
            const meta = msg.metadata || {};
            const choicesList = meta.choices || [];
            if (msg.type === 'decision' && choicesList.length > 0) {
                if (meta.resolved) {
                    choicesHtml = `<div class="decision-choices"><div class="decision-resolved">You chose: <strong>${htmlEscape(meta.chosen || '')}</strong></div></div>`;
                } else {
                    choicesHtml = '<div class="decision-choices">' + choicesList.map(c =>
                        `<button class="decision-choice" onclick="resolveDecision(${msg.id}, '${htmlEscape(c).replace(/'/g, "\\'")}')">${htmlEscape(c)}</button>`
                    ).join('') + '</div>';
                }
            }
            el.innerHTML = `<div class="todo-strip"></div>${isSelf ? '' : avatarHtml}<div class="chat-bubble" style="--bubble-color: ${senderColor}">${replyHtml}<div class="bubble-header"><span class="msg-sender" style="color: ${senderColor}">${htmlEscape(msg.sender)}</span>${rolePillHtml}<span class="msg-time">${msg.time || ''}</span></div><div class="msg-text">${textHtml}</div>${choicesHtml}${attachmentsHtml}<button class="convert-job-pill" onclick="startJobFromMessage(${msg.id}); event.stopPropagation();" title="Convert to job">convert to job</button><button class="bubble-copy" onclick="copyMessage(${msg.id}, event)" title="Copy message"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button></div><div class="msg-actions"><button class="reply-btn" onclick="startReply(${msg.id}, event)">reply</button><button class="todo-hint" onclick="todoCycle(${msg.id}); event.stopPropagation();">${statusLabel}</button><button class="delete-btn" onclick="deleteClick(${msg.id}, event)" title="Delete">del</button></div>`;
            if (todoStatus) el.classList.add('msg-todo', `msg-todo-${todoStatus}`);
            if (msg.metadata?.session_output) el.classList.add('session-output');

            // Add copy buttons to code blocks
            addCodeCopyButtonsBridge(el);
        }

        // Hide messages from other channels
        if (msgChannel !== getActiveChannel()) {
            el.style.display = 'none';
            // Track unread for background channels (skip joins/leaves and initial history load)
            if (soundsEnabled() && msg.type !== 'join' && msg.type !== 'leave') {
                const channelUnread = getChannelUnread();
                channelUnread[msgChannel] = (channelUnread[msgChannel] || 0) + 1;
                renderChannelTabsBridge();
                // Play soft pluck for cross-channel chat messages from others (only when focused)
                if (document.hasFocus() && msg.type === 'chat' && msg.sender && !isSelfSenderBridge(msg.sender)) {
                    playCrossChannelSoundBridge();
                }
            }
        }

        container.appendChild(el);

        // Collapse consecutive job_created messages into a group
        if (msg.type === 'job_created' && window._collapseJobBreadcrumbs) {
            window._collapseJobBreadcrumbs(container, el);
        }

        if (msgChannel !== getActiveChannel()) return;  // don't scroll for hidden messages

        if (autoScrollEnabled()) {
            scrollToBottomBridge();
        } else {
            incrementUnreadCount();
            updateScrollAnchorBridge();
        }
    }

    window.MessageRendering = {
        appendMessage,
        clearChannelDateState,
        formatDateDivider,
        getMessageDate,
        maybeInsertDateDivider,
        renameChannelDateState,
        resetDateState,
    };

    window.appendMessage = appendMessage;
})();
