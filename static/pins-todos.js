// pins-todos.js -- pinned message and todo actions/panel
// Extracted from chat.js. Reads shared state through window.* transition bridges.

(function() {
    'use strict';

    function reportMissingBridge(name) {
        console.error(`PinsTodos: ${name} bridge not registered`);
    }

    function getTodos() {
        if (!window.todos) reportMissingBridge('window.todos');
        return window.todos || {};
    }

    function getSocket() {
        return window.ws || null;
    }

    function htmlEscape(text) {
        if (typeof window.escapeHtml === 'function') return window.escapeHtml(text);
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function sendTodoAction(type, msgId) {
        const socket = getSocket();
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ type, id: msgId }));
    }

    function todoStatusLabel(status) {
        if (!status) return 'pin';
        if (status === 'todo') return 'done?';
        return 'unpin';
    }

    function todoCycle(msgId) {
        const status = getTodos()[msgId] || null;
        if (!status) {
            sendTodoAction('todo_add', msgId);
        } else if (status === 'todo') {
            sendTodoAction('todo_toggle', msgId);
        } else {
            sendTodoAction('todo_remove', msgId);
        }
    }

    function todoAdd(msgId) {
        sendTodoAction('todo_add', msgId);
    }

    function todoToggle(msgId) {
        sendTodoAction('todo_toggle', msgId);
    }

    function todoRemove(msgId) {
        sendTodoAction('todo_remove', msgId);
    }

    function updateTodoState(msgId, status) {
        const el = document.querySelector(`.message[data-id="${msgId}"]`);
        if (!el) return;

        el.classList.remove('msg-todo', 'msg-todo-todo', 'msg-todo-done');

        if (status === 'todo') {
            el.classList.add('msg-todo', 'msg-todo-todo');
        } else if (status === 'done') {
            el.classList.add('msg-todo', 'msg-todo-done');
        }

        const hint = el.querySelector('.todo-hint');
        if (hint) hint.textContent = todoStatusLabel(status);

        const panel = document.getElementById('pins-panel');
        if (panel && !panel.classList.contains('hidden')) renderTodosPanel();
    }

    function togglePinsPanel() {
        const toggle = () => {
            const panel = document.getElementById('pins-panel');
            const button = document.getElementById('pins-toggle');
            if (!panel) return;
            panel.classList.toggle('hidden');
            const open = !panel.classList.contains('hidden');
            if (button) button.classList.toggle('active', open);
            if (open) renderTodosPanel();
        };

        if (typeof window._preserveScroll === 'function') {
            window._preserveScroll(toggle);
        } else {
            reportMissingBridge('window._preserveScroll');
            toggle();
        }
    }

    function renderTodosPanel() {
        const list = document.getElementById('pins-list');
        if (!list) return;
        list.innerHTML = '';

        const todos = getTodos();
        const todoIds = Object.keys(todos);
        if (todoIds.length === 0) {
            list.innerHTML = '<div class="pins-empty">No pinned messages</div>';
            return;
        }

        const sorted = todoIds.map(Number).sort((a, b) => a - b);

        for (const id of sorted) {
            const el = document.querySelector(`.message[data-id="${id}"]`);
            if (!el) continue;

            const status = todos[id];
            const item = document.createElement('div');
            item.className = `todo-item ${status === 'done' ? 'todo-done' : ''}`;

            const time = el.querySelector('.msg-time')?.textContent || '';
            const sender = (el.querySelector('.msg-sender')?.textContent || '').trim();
            const text = el.querySelector('.msg-text')?.textContent || '';
            const senderColor = el.querySelector('.msg-sender')?.style.color || 'var(--text)';
            const msgChannel = el.dataset.channel || 'general';
            const check = status === 'done' ? '&#10003;' : '&#9675;';
            const checkClass = status === 'done' ? 'todo-check done' : 'todo-check';

            item.innerHTML = `<button class="${checkClass}" onclick="todoToggle(${id})">${check}</button><span class="msg-time" style="color:var(--accent);font-weight:600;margin-right:4px">#${htmlEscape(msgChannel)}</span> <span class="msg-time">${htmlEscape(time)}</span> <span class="msg-sender" style="color: ${senderColor}">${htmlEscape(sender)}</span> <span class="msg-text">${htmlEscape(text)}</span><button class="dismiss-btn danger" onclick="todoRemove(${id})" title="Remove from todos">&times;</button>`;
            item.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                if (msgChannel !== window.activeChannel && typeof window.switchChannel === 'function') {
                    window.switchChannel(msgChannel);
                } else if (msgChannel !== window.activeChannel) {
                    reportMissingBridge('window.switchChannel');
                }
                if (typeof window.scrollToMessage === 'function') {
                    window.scrollToMessage(id);
                } else {
                    reportMissingBridge('window.scrollToMessage');
                }
                togglePinsPanel();
            });
            list.appendChild(item);
        }
    }

    window.PinsTodos = {
        todoStatusLabel,
        todoCycle,
        todoAdd,
        todoToggle,
        todoRemove,
        updateTodoState,
        togglePinsPanel,
        renderTodosPanel,
    };

    window.todoStatusLabel = todoStatusLabel;
    window.todoCycle = todoCycle;
    window.todoAdd = todoAdd;
    window.todoToggle = todoToggle;
    window.todoRemove = todoRemove;
    window.updateTodoState = updateTodoState;
    window.togglePinsPanel = togglePinsPanel;
    window.renderTodosPanel = renderTodosPanel;
})();
