// schedules.js -- scheduled message strip and composer popover
// Extracted from chat.js. Reads shared chat state through window.* transition bridges.

(function() {
    'use strict';

    let schedulesList = [];

    function reportMissingBridge(name) {
        console.error(`Schedules: ${name} bridge not registered`);
    }

    function getSessionToken() {
        return window.SESSION_TOKEN || window.__SESSION_TOKEN__ || '';
    }

    function getActiveMentions() {
        const mentions = window.activeMentions;
        if (!mentions) reportMissingBridge('window.activeMentions');
        return mentions && typeof mentions[Symbol.iterator] === 'function' ? mentions : [];
    }

    function repositionScrollAnchor() {
        if (typeof window.repositionScrollAnchor === 'function') {
            window.repositionScrollAnchor();
        } else {
            reportMissingBridge('window.repositionScrollAnchor');
        }
    }

    function updateSendButton() {
        if (typeof window.updateSendButton === 'function') {
            window.updateSendButton();
        } else {
            reportMissingBridge('window.updateSendButton');
        }
    }

    function showSlashHint(text) {
        if (typeof window.showSlashHint === 'function') {
            window.showSlashHint(text);
        } else {
            reportMissingBridge('window.showSlashHint');
        }
    }

    function setSchedules(schedules) {
        schedulesList = Array.isArray(schedules) ? schedules : [];
        renderSchedulesBar();
    }

    function handleScheduleEvent(action, schedule) {
        if (action === 'create') {
            schedulesList = schedulesList.filter(s => s.id !== schedule.id);
            schedulesList.push(schedule);
        } else if (action === 'update') {
            schedulesList = schedulesList.map(s => s.id === schedule.id ? schedule : s);
        } else if (action === 'delete') {
            schedulesList = schedulesList.filter(s => s.id !== schedule.id);
        }
        renderSchedulesBar();
    }

    function renderSchedulesBar() {
        const bar = document.getElementById('schedules-bar');
        if (!bar) return;

        const active = schedulesList.filter(s => s.active !== false);
        if (schedulesList.length === 0) {
            bar.classList.add('hidden');
            bar.classList.remove('expanded');
            document.getElementById('schedules-list')?.classList.add('hidden');
            repositionScrollAnchor();
            return;
        }

        bar.classList.remove('hidden');

        // Summary line -- Slack-style: describe the next firing
        const countEl = document.getElementById('schedules-count');
        const nextEl = document.getElementById('schedules-next');

        // Clean up inline controls from previous render
        const summaryDiv = bar.querySelector('.schedules-bar-summary');
        summaryDiv.querySelector('.schedule-toggle-inline')?.remove();
        summaryDiv.querySelector('.schedule-delete-inline')?.remove();

        if (schedulesList.length === 1) {
            const s = schedulesList[0];
            const isPaused = s.active === false;
            const targetStr = (s.targets || []).map(t => '@' + t).join(', ');
            countEl.textContent = `${targetStr} "${s.prompt}"` + (isPaused ? ' (paused)' : '');
            const nextStr = (!isPaused && s.next_run) ? formatScheduleTime(s.next_run) : '';
            nextEl.textContent = nextStr
                ? formatScheduleInterval(s) + ' -- next in ' + nextStr
                : formatScheduleInterval(s);
        } else if (active.length > 0) {
            const paused = schedulesList.length - active.length;
            const parts = [`${active.length} active`];
            if (paused > 0) parts.push(`${paused} paused`);
            countEl.textContent = parts.join(', ');
            const futureRuns = active.filter(s => s.next_run && s.next_run * 1000 > Date.now()).map(s => s.next_run);
            const nextTimeStr = futureRuns.length > 0 ? formatScheduleTime(Math.min(...futureRuns)) : '';
            nextEl.textContent = nextTimeStr ? 'next in ' + nextTimeStr : '';
        } else {
            const paused = schedulesList.length;
            countEl.textContent = `${paused} paused schedule${paused !== 1 ? 's' : ''}`;
            nextEl.textContent = '';
        }

        // Inline pause + trash when only 1 schedule; hide "See all" link
        const seeAllLink = summaryDiv.querySelector('.schedules-see-all');
        if (schedulesList.length === 1) {
            const s = schedulesList[0];
            const isPaused = s.active === false;

            const pauseBtn = document.createElement('button');
            pauseBtn.className = 'schedule-toggle-inline' + (isPaused ? ' paused' : '');
            pauseBtn.innerHTML = isPaused
                ? '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M5 3l8 5-8 5V3z" fill="currentColor"/></svg>'
                : '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="4" y="3" width="3" height="10" rx="0.5" fill="currentColor"/><rect x="9" y="3" width="3" height="10" rx="0.5" fill="currentColor"/></svg>';
            pauseBtn.title = isPaused ? 'Resume' : 'Pause';
            pauseBtn.onclick = () => toggleSchedule(s.id);

            const trashBtn = document.createElement('button');
            trashBtn.className = 'schedule-delete-inline';
            trashBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M6 7v5M10 7v5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M4 4l.5 9a1 1 0 001 1h5a1 1 0 001-1L12 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            trashBtn.title = 'Delete';
            trashBtn.onclick = () => deleteSchedule(s.id);

            summaryDiv.append(pauseBtn, trashBtn);
            if (seeAllLink) seeAllLink.style.display = 'none';
            // Collapse expanded list; summary has everything.
            bar.classList.remove('expanded');
            document.getElementById('schedules-list')?.classList.add('hidden');
            if (seeAllLink) seeAllLink.textContent = 'See all';
        } else {
            if (seeAllLink) seeAllLink.style.display = '';
        }

        // Adjust scroll-anchor so it sits above the footer
        repositionScrollAnchor();

        // Expanded list
        const list = document.getElementById('schedules-list');
        list.innerHTML = '';
        for (const s of schedulesList) {
            const row = document.createElement('div');
            row.className = 'schedule-row' + (s.active === false ? ' paused' : '');

            const targets = document.createElement('span');
            targets.className = 'schedule-targets';
            targets.textContent = (s.targets || []).map(t => '@' + t).join(' ');

            const prompt = document.createElement('span');
            prompt.className = 'schedule-prompt';
            prompt.textContent = s.prompt || '';
            prompt.title = s.prompt || '';

            const interval = document.createElement('span');
            interval.className = 'schedule-interval';
            interval.textContent = formatScheduleInterval(s);

            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'schedule-toggle';
            toggleBtn.textContent = s.active === false ? '\u25b6' : '\u23f8';
            toggleBtn.title = s.active === false ? 'Resume' : 'Pause';
            toggleBtn.onclick = () => toggleSchedule(s.id);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'schedule-delete';
            deleteBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M6 7v5M10 7v5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M4 4l.5 9a1 1 0 001 1h5a1 1 0 001-1L12 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            deleteBtn.title = 'Delete';
            deleteBtn.onclick = () => deleteSchedule(s.id);

            row.append(targets, prompt, interval, toggleBtn, deleteBtn);
            list.appendChild(row);
        }
    }

    function formatScheduleTime(ts) {
        const d = new Date(ts * 1000);
        const now = new Date();
        const diffMs = d - now;
        if (diffMs < 0) return '';
        if (diffMs < 60000) return '<1m';
        if (diffMs < 3600000) return Math.ceil(diffMs / 60000) + 'm';
        if (diffMs < 86400000) {
            const h = Math.floor(diffMs / 3600000);
            const m = Math.ceil((diffMs % 3600000) / 60000);
            return m > 0 ? `${h}h ${m}m` : `${h}h`;
        }
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function formatScheduleInterval(s) {
        if (s.daily_at) return 'daily at ' + s.daily_at;
        const sec = s.interval_seconds || 0;
        if (sec < 3600) return 'every ' + Math.round(sec / 60) + 'm';
        if (sec < 86400) return 'every ' + Math.round(sec / 3600) + 'h';
        return 'every ' + Math.round(sec / 86400) + 'd';
    }

    function toggleSchedulesExpand() {
        const bar = document.getElementById('schedules-bar');
        const list = document.getElementById('schedules-list');
        if (!bar || !list) return;
        const expanded = bar.classList.toggle('expanded');
        list.classList.toggle('hidden', !expanded);
        const link = bar.querySelector('.schedules-see-all');
        if (link) link.textContent = expanded ? 'Hide' : 'See all';
    }

    async function toggleSchedule(id) {
        try {
            await fetch(`/api/schedules/${id}/toggle`, {
                method: 'PATCH',
                headers: { 'X-Session-Token': getSessionToken() },
            });
        } catch (e) {
            console.error('Failed to toggle schedule:', e);
        }
    }

    async function deleteSchedule(id) {
        try {
            await fetch(`/api/schedules/${id}`, {
                method: 'DELETE',
                headers: { 'X-Session-Token': getSessionToken() },
            });
        } catch (e) {
            console.error('Failed to delete schedule:', e);
        }
    }

    function showScheduleConfirmation() {
        const bar = document.getElementById('schedules-bar');
        if (!bar) return;
        bar.classList.remove('hidden');
        // Flash the bar green for 2s then transition back
        bar.classList.add('sched-flash');
        setTimeout(() => bar.classList.remove('sched-flash'), 2000);
    }

    function toggleSchedulePopover(e) {
        if (e) e.stopPropagation();
        const pop = document.getElementById('schedule-popover');
        if (!pop) return;
        const opening = pop.classList.contains('hidden');
        pop.classList.toggle('hidden');
        if (opening) {
            populateScheduleDropdowns();
            updateSchedulePopoverState();
        }
    }

    function closeSchedulePopover() {
        const pop = document.getElementById('schedule-popover');
        if (pop) pop.classList.add('hidden');
    }

    function stepNumInput(id, delta) {
        const el = document.getElementById(id);
        if (!el) return;
        const min = parseInt(el.min) || 1;
        const max = parseInt(el.max) || 99;
        const val = Math.max(min, Math.min(max, (parseInt(el.value) || min) + delta));
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function stepSchedNum(delta) {
        stepNumInput('sched-interval-val', delta);
    }

    function toggleRecurringFields() {
        const checked = document.getElementById('sched-recurring')?.checked;
        const fields = document.getElementById('sched-recurring-fields');
        if (fields) fields.classList.toggle('hidden', !checked);
        // Dim both "When" and "At" rows when recurring is active
        const whenRow = document.getElementById('sched-date')?.closest('.sched-pop-row');
        const atRow = document.getElementById('sched-hour')?.closest('.sched-pop-row');
        if (whenRow) whenRow.classList.toggle('sched-dimmed', !!checked);
        if (atRow) atRow.classList.toggle('sched-dimmed', !!checked);
    }

    function populateScheduleDropdowns() {
        const dateEl = document.getElementById('sched-date');
        const hourEl = document.getElementById('sched-hour');
        const minEl = document.getElementById('sched-minute');
        const ampmEl = document.getElementById('sched-ampm');
        if (!dateEl || !hourEl || !minEl || !ampmEl) return;

        // Date options: Today, Tomorrow, then next 5 weekdays
        dateEl.innerHTML = '';
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const now = new Date();
        for (let i = 0; i < 7; i++) {
            const d = new Date(now);
            d.setDate(d.getDate() + i);
            const opt = document.createElement('option');
            opt.value = d.toISOString().slice(0, 10);
            opt.textContent = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : days[d.getDay()];
            dateEl.appendChild(opt);
        }

        // Default to next rounded quarter hour
        const nextQuarter = new Date(now);
        nextQuarter.setMinutes(Math.ceil(nextQuarter.getMinutes() / 15) * 15 + 15, 0, 0);
        const defHr = nextQuarter.getHours();
        const defMin = nextQuarter.getMinutes();

        // Hour (1-12)
        hourEl.innerHTML = '';
        for (let h = 1; h <= 12; h++) {
            const opt = document.createElement('option');
            opt.value = h;
            opt.textContent = h;
            const match24 = defHr === 0 ? 12 : defHr > 12 ? defHr - 12 : defHr;
            if (h === match24) opt.selected = true;
            hourEl.appendChild(opt);
        }

        // Minute (00, 15, 30, 45)
        minEl.innerHTML = '';
        for (const m of [0, 15, 30, 45]) {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = String(m).padStart(2, '0');
            if (m === defMin) opt.selected = true;
            minEl.appendChild(opt);
        }

        // AM/PM
        ampmEl.innerHTML = '';
        for (const p of ['AM', 'PM']) {
            const opt = document.createElement('option');
            opt.value = p;
            opt.textContent = p;
            if ((defHr < 12 && p === 'AM') || (defHr >= 12 && p === 'PM')) opt.selected = true;
            ampmEl.appendChild(opt);
        }
    }

    function getScheduleTime24() {
        let h = parseInt(document.getElementById('sched-hour')?.value) || 12;
        const m = parseInt(document.getElementById('sched-minute')?.value) || 0;
        const ampm = document.getElementById('sched-ampm')?.value || 'AM';
        if (ampm === 'PM' && h < 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }

    function updateSchedulePopoverState() {
        const pop = document.getElementById('schedule-popover');
        if (!pop || pop.classList.contains('hidden')) return;
        const errEl = document.getElementById('sched-pop-error');
        const submitBtn = pop.querySelector('.sched-pop-submit');
        const input = document.getElementById('input');
        const text = input ? input.value.trim() : '';
        const mentionMatches = text.match(/@(\w[\w-]*)/g) || [];
        const targets = new Set(mentionMatches.map(m => m.slice(1)));
        for (const name of getActiveMentions()) targets.add(name);
        if (targets.size === 0) {
            if (errEl) {
                errEl.textContent = 'Toggle an agent to set a target';
                errEl.classList.remove('hidden');
            }
            if (submitBtn) submitBtn.disabled = true;
        } else {
            if (errEl) {
                errEl.classList.add('hidden');
                errEl.textContent = '';
            }
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    async function submitSchedulePopover() {
        const input = document.getElementById('input');
        const text = input ? input.value.trim() : '';

        // Gather targets
        const mentionMatches = text.match(/@(\w[\w-]*)/g) || [];
        const targets = new Set(mentionMatches.map(m => m.slice(1)));
        for (const name of getActiveMentions()) targets.add(name);
        const prompt = text.replace(/@\w[\w-]*/g, '').trim();

        const errEl = document.getElementById('sched-pop-error');

        if (targets.size === 0) return; // button should be disabled anyway
        if (!prompt) {
            if (errEl) {
                errEl.textContent = 'Type a message first';
                errEl.classList.remove('hidden');
            }
            return;
        }

        const recurring = document.getElementById('sched-recurring')?.checked;
        const dateVal = document.getElementById('sched-date')?.value;
        const timeVal = getScheduleTime24();
        const intervalVal = parseInt(document.getElementById('sched-interval-val')?.value) || 1;
        const intervalUnit = document.getElementById('sched-interval-unit')?.value || 'hours';

        // Build spec for the API
        let spec;
        if (recurring) {
            const unitShort = intervalUnit === 'minutes' ? 'm' : intervalUnit === 'hours' ? 'h' : 'd';
            spec = `every ${intervalVal}${unitShort}`;
        } else {
            // One-shot: "daily at HH:MM" with one_shot flag
            spec = `daily at ${timeVal}`;
        }

        closeSchedulePopover();

        try {
            const body = {
                prompt: prompt,
                targets: [...targets],
                channel: window.activeChannel,
                spec: spec,
                created_by: window.username,
            };
            if (!recurring) body.one_shot = true;
            if (!recurring && dateVal) body.send_at_date = dateVal;

            const resp = await fetch('/api/schedules', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Token': getSessionToken(),
                },
                body: JSON.stringify(body),
            });
            if (resp.ok) {
                if (input) {
                    input.value = '';
                    input.style.height = 'auto';
                }
                updateSendButton();
                showScheduleConfirmation();
            } else {
                const err = await resp.json().catch(() => ({}));
                showSlashHint(err.error || 'Failed to schedule');
            }
        } catch (e) {
            console.error('Failed to create schedule:', e);
            showSlashHint('Failed to create schedule');
        }
    }

    // Close popover on outside click
    document.addEventListener('click', (e) => {
        const pop = document.getElementById('schedule-popover');
        if (pop && !pop.classList.contains('hidden')) {
            if (!e.target.closest('.schedule-popover') && !e.target.closest('footer')) {
                pop.classList.add('hidden');
            }
        }
    });

    // Refresh "next: Xm" countdowns every 10s
    setInterval(() => {
        if (schedulesList.length > 0) renderSchedulesBar();
    }, 10000);

    window.Schedules = {
        setSchedules,
        handleScheduleEvent,
        renderSchedulesBar,
        formatScheduleTime,
        formatScheduleInterval,
        toggleSchedulesExpand,
        toggleSchedule,
        deleteSchedule,
        showScheduleConfirmation,
        toggleSchedulePopover,
        closeSchedulePopover,
        stepNumInput,
        stepSchedNum,
        toggleRecurringFields,
        populateScheduleDropdowns,
        getScheduleTime24,
        updateSchedulePopoverState,
        submitSchedulePopover,
    };

    window.handleScheduleEvent = handleScheduleEvent;
    window.renderSchedulesBar = renderSchedulesBar;
    window.formatScheduleTime = formatScheduleTime;
    window.formatScheduleInterval = formatScheduleInterval;
    window.toggleSchedulesExpand = toggleSchedulesExpand;
    window.toggleSchedule = toggleSchedule;
    window.deleteSchedule = deleteSchedule;
    window.showScheduleConfirmation = showScheduleConfirmation;
    window.toggleSchedulePopover = toggleSchedulePopover;
    window.closeSchedulePopover = closeSchedulePopover;
    window.stepNumInput = stepNumInput;
    window.stepSchedNum = stepSchedNum;
    window.toggleRecurringFields = toggleRecurringFields;
    window.populateScheduleDropdowns = populateScheduleDropdowns;
    window.getScheduleTime24 = getScheduleTime24;
    window.updateSchedulePopoverState = updateSchedulePopoverState;
    window.submitSchedulePopover = submitSchedulePopover;
})();
