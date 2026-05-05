(function() {
    let agentOpsOpen = false;
    let agentOpsTimer = null;
    let lastProject = null;

    function authHeaders() {
        const token = window.__SESSION_TOKEN__ || window.SESSION_TOKEN || '';
        return token ? { 'X-Session-Token': token } : {};
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[ch]));
    }

    function fmtAge(seconds) {
        if (seconds === null || seconds === undefined) return 'no heartbeat';
        if (seconds < 1) return 'now';
        if (seconds < 60) return `${Math.round(seconds)}s ago`;
        return `${Math.round(seconds / 60)}m ago`;
    }

    function validHex(color) {
        return /^#[0-9a-fA-F]{6}$/.test(String(color || ''));
    }

    async function loadJson(path) {
        const resp = await fetch(path, { headers: authHeaders() });
        if (!resp.ok) throw new Error(`${path} ${resp.status}`);
        return resp.json();
    }

    async function loadProject() {
        try {
            const project = await loadJson('/api/project');
            lastProject = project;
            applyProject(project);
        } catch (err) {
            console.warn('agent operations project load failed', err);
        }
    }

    function applyProject(project) {
        const name = project.title || project.name || 'agentchattr';
        window.agentchattrProjectTitle = name;
        document.title = name.toLowerCase() === 'agentchattr' ? 'agentchattr' : `${name} - agentchattr`;
        if (validHex(project.accent_color)) {
            document.documentElement.style.setProperty('--accent', project.accent_color);
            document.documentElement.style.setProperty('--accent-soft', `${project.accent_color}24`);
        }
        const badge = document.getElementById('project-badge');
        if (badge) {
            badge.textContent = name;
            badge.title = project.team_file || name;
            badge.classList.remove('hidden');
        }
        applyProjectLinks(project);
    }

    function applyProjectLinks(project) {
        const link = document.querySelector('.channel-support');
        if (!link) return;
        const url = project.link_url || project.board_url || project.repo_url || '';
        const rawLabel = project.link_label || (project.board_url || project.link_url ? 'Project Board' : project.repo_url ? 'Repository' : 'Support development');
        const label = ` ${rawLabel}`;
        if (url) {
            link.href = url;
            link.title = rawLabel;
            link.dataset.projectLabel = label;
            const labelEl = link.querySelector('.support-label');
            if (labelEl) labelEl.textContent = label;
        }
    }

    async function refreshAgentOps() {
        const body = document.getElementById('agent-ops-body');
        if (!body) return;
        try {
            const ops = await loadJson('/api/agent-ops');
            lastProject = ops.project || lastProject;
            if (lastProject) applyProject(lastProject);
            body.innerHTML = renderAgentOps(ops);
            wireCopyButtons(body);
        } catch (err) {
            body.innerHTML = `<div class="agent-ops-empty">Unable to load operations data.</div>`;
            console.warn('agent operations load failed', err);
        }
    }

    function renderAgentOps(ops) {
        return [
            renderServices(ops.service_badges || []),
            renderProjectSettings(ops.project || lastProject || {}),
            renderConfiguredAgents(ops.configured_agents || []),
            renderRegisteredAgents(ops.registered_agents || []),
            renderWarnings(ops.mismatches || {}),
        ].join('');
    }

    function renderServices(services) {
        const rows = services.map(s => `
            <div class="agent-ops-service">
                <div class="agent-ops-name">
                    <span class="agent-ops-dot ${s.tmux_running === false ? 'warn' : 'online'}"></span>
                    <span class="agent-ops-label">${escapeHtml(s.label || s.name)}</span>
                </div>
                <span class="agent-ops-meta">${escapeHtml(s.detail || s.status || '')}</span>
            </div>
        `).join('');
        return section('Services', `<div class="agent-ops-services">${rows}</div>`);
    }

    function renderProjectSettings(project) {
        const rows = [
            ['Tmux', project.tmux_prefix || ''],
            ['Data', project.data_dir || ''],
            ['Uploads', project.upload_dir || ''],
            ['Team', project.team_file || 'default config'],
            ['Repo', project.repo_url || ''],
            ['Project Board', project.board_url || ''],
            ['Link', project.link_url || ''],
        ].filter(([, value]) => value).map(([label, value]) => `
            <div class="agent-ops-setting">
                <span class="agent-ops-meta">${escapeHtml(label)}</span>
                ${renderProjectValue(label, value)}
            </div>
        `).join('');
        return section('Project', `<div class="agent-ops-settings">${rows}</div>`);
    }

    function renderProjectValue(label, value) {
        if ((label === 'Repo' || label === 'Project Board' || label === 'Link') && value) {
            return `<a class="agent-ops-link" href="${escapeHtml(value)}" target="_blank" rel="noopener" title="${escapeHtml(value)}">${escapeHtml(value)}</a>`;
        }
        return `<span class="agent-ops-value" title="${escapeHtml(value)}">${escapeHtml(value)}</span>`;
    }

    function renderConfiguredAgents(rows) {
        if (!rows.length) return section('Configured Agents', '<div class="agent-ops-empty">No configured agents.</div>');
        return section('Configured Agents', rows.map(renderConfiguredAgent).join(''));
    }

    function renderConfiguredAgent(row) {
        const mismatch = row.mismatches || {};
        const warn = mismatch.configured_not_registered || mismatch.wrapper_running_without_live_heartbeat;
        const state = row.busy ? 'busy' : row.online ? 'online' : warn ? 'warn' : '';
        const provider = row.provider || row.type || 'agent';
        const role = row.role ? `<span class="agent-ops-tag">role ${escapeHtml(row.role)}</span>` : '<span class="agent-ops-tag">no role</span>';
        const registered = (row.registered_names || []).length
            ? `<span class="agent-ops-tag">@${escapeHtml(row.registered_names.join(', @'))}</span>`
            : '<span class="agent-ops-tag">not registered</span>';
        const liveCommand = row.attach?.live || '';
        const wrapperCommand = row.attach?.wrapper || '';
        return `
            <div class="agent-ops-row ${warn ? 'warn' : ''}">
                <div class="agent-ops-row-top">
                    <div class="agent-ops-name">
                        <span class="agent-ops-dot ${state}" style="background:${escapeHtml(row.color || '')}"></span>
                        <span class="agent-ops-label">${escapeHtml(row.label || row.name)}</span>
                    </div>
                    <span class="agent-ops-meta">${fmtAge(row.heartbeat_age)}</span>
                </div>
                <div class="agent-ops-tags">
                    <span class="agent-ops-tag">@${escapeHtml(row.name)}</span>
                    <span class="agent-ops-tag">${escapeHtml(provider)}</span>
                    ${role}
                    ${registered}
                </div>
                ${copyRow('Live', liveCommand)}
                ${copyRow('Wrapper', wrapperCommand)}
            </div>
        `;
    }

    function renderRegisteredAgents(rows) {
        if (!rows.length) return section('Running Agents', '<div class="agent-ops-empty">No registered agents.</div>');
        return section('Running Agents', rows.map(row => {
            const warn = row.mismatches?.registered_not_configured;
            const state = row.busy ? 'busy' : row.online ? 'online' : warn ? 'warn' : '';
            return `
                <div class="agent-ops-row ${warn ? 'warn' : ''}">
                    <div class="agent-ops-row-top">
                        <div class="agent-ops-name">
                            <span class="agent-ops-dot ${state}" style="background:${escapeHtml(row.color || '')}"></span>
                            <span class="agent-ops-label">${escapeHtml(row.label || row.name)}</span>
                        </div>
                        <span class="agent-ops-meta">${fmtAge(row.heartbeat_age)}</span>
                    </div>
                    <div class="agent-ops-tags">
                        <span class="agent-ops-tag">@${escapeHtml(row.name)}</span>
                        <span class="agent-ops-tag">base ${escapeHtml(row.base)}</span>
                        <span class="agent-ops-tag">${escapeHtml(row.state || 'active')}</span>
                    </div>
                    ${copyRow('Live', row.attach?.live || '')}
                </div>
            `;
        }).join(''));
    }

    function renderWarnings(mismatches) {
        const items = [];
        if ((mismatches.configured_not_registered || []).length) {
            items.push(`Configured but not registered: ${mismatches.configured_not_registered.map(escapeHtml).join(', ')}`);
        }
        if ((mismatches.registered_not_configured || []).length) {
            items.push(`Registered but not configured: ${mismatches.registered_not_configured.map(escapeHtml).join(', ')}`);
        }
        if ((mismatches.wrapper_running_without_live_heartbeat || []).length) {
            items.push(`Wrapper running without live heartbeat: ${mismatches.wrapper_running_without_live_heartbeat.map(escapeHtml).join(', ')}`);
        }
        if (!items.length) return '';
        return section('Warnings', items.map(text => `
            <div class="agent-ops-row warn">
                <div class="agent-ops-meta">${text}</div>
            </div>
        `).join(''));
    }

    function section(title, body) {
        return `
            <div class="agent-ops-section">
                <div class="agent-ops-section-title">${escapeHtml(title)}</div>
                ${body}
            </div>
        `;
    }

    function copyRow(label, command) {
        if (!command) return '';
        return `
            <div class="agent-ops-copy-row">
                <div class="agent-ops-command" title="${escapeHtml(command)}">${escapeHtml(label)}: ${escapeHtml(command)}</div>
                <button class="agent-ops-copy" data-copy="${escapeHtml(command)}" title="Copy attach command">Copy</button>
            </div>
        `;
    }

    function wireCopyButtons(root) {
        root.querySelectorAll('.agent-ops-copy').forEach(btn => {
            btn.addEventListener('click', async () => {
                const text = btn.dataset.copy || '';
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
                const old = btn.textContent;
                btn.textContent = 'Copied';
                setTimeout(() => { btn.textContent = old; }, 900);
            });
        });
    }

    window.toggleAgentOpsPanel = function(force) {
        const panel = document.getElementById('agent-ops-panel');
        const toggle = document.getElementById('agent-ops-toggle');
        if (!panel) return;
        agentOpsOpen = typeof force === 'boolean' ? force : panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !agentOpsOpen);
        document.body.classList.toggle('agent-ops-open', agentOpsOpen);
        if (toggle) toggle.classList.toggle('active', agentOpsOpen);
        if (agentOpsOpen) {
            refreshAgentOps();
            clearInterval(agentOpsTimer);
            agentOpsTimer = setInterval(refreshAgentOps, 5000);
        } else {
            clearInterval(agentOpsTimer);
            agentOpsTimer = null;
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        loadProject();
    });
})();
