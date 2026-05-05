// settings.js -- room settings UI, persistence, and notification sound prefs
// Extracted from chat.js. Shared chat state is reached through window.* bridges.

(function() {
    'use strict';

    const SOUND_OPTIONS = [
        { value: 'soft-chime', label: 'Soft Chime' },
        { value: 'bright-ping', label: 'Bright Ping' },
        { value: 'gentle-pop', label: 'Gentle Pop' },
        { value: 'alert-tone', label: 'Alert Tone' },
        { value: 'pluck', label: 'Pluck' },
        { value: 'click', label: 'Click' },
        { value: 'warm-bell', label: 'Warm Bell' },
        { value: 'none', label: 'None' },
    ];
    const SOUND_PREFS_KEY = 'agentchattr-sounds';
    const DEFAULT_SOUND = 'soft-chime';
    const CROSS_CHANNEL_SOUND = 'pluck';
    const soundCache = {};

    let pendingChannelSwitch = null;
    let soundPrefs = {};
    let rawSoundPrefs = '{}';

    try {
        rawSoundPrefs = localStorage.getItem(SOUND_PREFS_KEY) || '{}';
        soundPrefs = JSON.parse(rawSoundPrefs);
    } catch (err) {
        console.error('Corrupt agentchattr-sounds, resetting:', err, rawSoundPrefs);
        soundPrefs = {};
        try {
            localStorage.removeItem(SOUND_PREFS_KEY);
        } catch (removeErr) {
            console.error('Unable to remove corrupt agentchattr-sounds:', removeErr);
        }
    }

    function getEl(id) {
        return document.getElementById(id);
    }

    function setValue(id, value) {
        const el = getEl(id);
        if (el) el.value = value;
    }

    function getSocket() {
        return window.ws || null;
    }

    function socketIsOpen(socket) {
        return socket && (typeof WebSocket === 'undefined' || socket.readyState === WebSocket.OPEN);
    }

    function reportMissingBridge(name) {
        console.error(`Settings: ${name} bridge not registered`);
    }

    function playSound(soundName) {
        if (!soundName || soundName === 'none') return;
        if (!soundCache[soundName]) {
            soundCache[soundName] = new Audio(`/static/sounds/${soundName}.mp3`);
        }
        const audio = soundCache[soundName];
        audio.currentTime = 0;
        audio.play().catch(() => {});
    }

    function playNotificationSound(sender) {
        const key = String(sender || '').toLowerCase();
        const soundName = soundPrefs[key] || soundPrefs.default || DEFAULT_SOUND;
        playSound(soundName);
    }

    function playCrossChannelSound() {
        const soundName = soundPrefs['cross-channel'] || CROSS_CHANNEL_SOUND;
        playSound(soundName);
    }

    function buildSoundSettings() {
        const container = getEl('sound-settings');
        if (!container) return;
        container.innerHTML = '';

        const agentConfig = window.agentConfig || {};
        const agents = ['default', 'cross-channel', ...Object.keys(agentConfig)];
        for (const name of agents) {
            const row = document.createElement('div');
            row.className = 'sound-row';

            const label = document.createElement('span');
            label.className = 'sound-label';
            label.textContent = name === 'default' ? 'Default sound'
                : name === 'cross-channel' ? 'Background alerts'
                : (agentConfig[name]?.label || name);

            const select = document.createElement('select');
            select.className = 'sound-select';
            select.dataset.agent = name;

            const currentVal = soundPrefs[name]
                || (name === 'default' ? DEFAULT_SOUND : name === 'cross-channel' ? CROSS_CHANNEL_SOUND : '');
            for (const opt of SOUND_OPTIONS) {
                const o = document.createElement('option');
                o.value = opt.value;
                o.textContent = opt.label;
                if (currentVal === opt.value) o.selected = true;
                select.appendChild(o);
            }

            if (name !== 'default' && name !== 'cross-channel') {
                const o = document.createElement('option');
                o.value = '';
                o.textContent = 'Use default';
                if (!soundPrefs[name]) o.selected = true;
                select.insertBefore(o, select.firstChild);
            }

            select.addEventListener('change', () => {
                const val = select.value;
                soundPrefs[name] = val;
                localStorage.setItem(SOUND_PREFS_KEY, JSON.stringify(soundPrefs));
                playSound(val);
            });

            row.appendChild(label);
            row.appendChild(select);
            container.appendChild(row);
        }
    }

    function applySettings(data) {
        if (data.title) {
            const roomTitle = getEl('room-title');
            if (roomTitle) roomTitle.textContent = data.title;
            if (!window.agentchattrProjectTitle) document.title = data.title;
        }
        if (data.username) {
            if (typeof window._setUsername === 'function') {
                window._setUsername(data.username);
            } else {
                reportMissingBridge('window._setUsername');
            }
            const senderLabel = getEl('sender-label');
            if (senderLabel) senderLabel.textContent = data.username;
            setValue('setting-username', data.username);
        }
        if (data.font) {
            document.body.classList.remove('font-mono', 'font-serif', 'font-sans');
            document.body.classList.add('font-' + data.font);
            setValue('setting-font', data.font);
        }
        if (data.max_agent_hops !== undefined) {
            setValue('setting-hops', data.max_agent_hops);
        }
        if (data.history_limit !== undefined) {
            setValue('setting-history', String(data.history_limit));
        }
        if (data.contrast) {
            document.body.classList.toggle('high-contrast', data.contrast === 'high');
            setValue('setting-contrast', data.contrast);
        }
        if (data.rules_refresh_interval !== undefined) {
            setValue('setting-rules-refresh', String(data.rules_refresh_interval));
        }
        if (Array.isArray(data.custom_roles)) {
            window.customRoles = data.custom_roles;
        }
        if (data.channels && Array.isArray(data.channels)) {
            window.channelList = data.channels;
            if (!window.channelList.includes(window.activeChannel)) {
                window._setActiveChannel('general');
                localStorage.setItem('agentchattr-channel', 'general');
                if (window.Store && typeof window.Store.set === 'function') {
                    window.Store.set('activeChannel', 'general');
                } else {
                    reportMissingBridge('window.Store.set');
                }
                if (typeof window.filterMessagesByChannel === 'function') {
                    window.filterMessagesByChannel();
                } else {
                    reportMissingBridge('window.filterMessagesByChannel');
                }
            }
            if (typeof window.renderChannelTabs === 'function') {
                window.renderChannelTabs();
            } else {
                reportMissingBridge('window.renderChannelTabs');
            }

            if (pendingChannelSwitch && window.channelList.includes(pendingChannelSwitch)) {
                const name = pendingChannelSwitch;
                pendingChannelSwitch = null;
                if (typeof window.switchChannel === 'function') {
                    window.switchChannel(name);
                } else {
                    reportMissingBridge('window.switchChannel');
                }
            }
        }
    }

    function toggleSettings() {
        const bar = getEl('settings-bar');
        const toggle = getEl('settings-toggle');
        if (!bar) return;
        bar.classList.toggle('hidden');
        const open = !bar.classList.contains('hidden');
        if (toggle) toggle.classList.toggle('active', open);
        if (open) getEl('setting-username')?.focus();
    }

    function saveSettings() {
        const histVal = getEl('setting-history')?.value || '50';
        const newHistory = histVal === 'all' ? 'all' : (parseInt(histVal) || 50);
        const socket = getSocket();

        if (socketIsOpen(socket)) {
            socket.send(JSON.stringify({
                type: 'update_settings',
                data: {
                    username: getEl('setting-username')?.value.trim() || 'user',
                    font: getEl('setting-font')?.value || 'mono',
                    max_agent_hops: parseInt(getEl('setting-hops')?.value) || 100,
                    history_limit: newHistory,
                    contrast: getEl('setting-contrast')?.value || 'normal',
                    rules_refresh_interval: parseInt(getEl('setting-rules-refresh')?.value) || 0,
                },
            }));
        }
    }

    function setupSettingsKeys() {
        // Auto-save on blur/Enter for text/number fields.
        for (const id of ['setting-username', 'setting-hops']) {
            const el = getEl(id);
            if (!el) continue;
            el.addEventListener('blur', () => saveSettings());
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    el.blur();
                }
                if (e.key === 'Escape') {
                    toggleSettings();
                }
            });
        }

        // Auto-save on change for selects, escape to close.
        for (const id of ['setting-font', 'setting-history', 'setting-contrast', 'setting-rules-refresh']) {
            const el = getEl(id);
            if (!el) continue;
            el.addEventListener('change', () => {
                if (id === 'setting-contrast') {
                    document.body.classList.toggle('high-contrast', el.value === 'high');
                }
                saveSettings();
            });
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    toggleSettings();
                }
            });
        }
    }

    window._setPendingChannelSwitch = function(value) {
        pendingChannelSwitch = value;
    };

    window.Settings = {
        applySettings,
        buildSoundSettings,
        playCrossChannelSound,
        playNotificationSound,
        saveSettings,
        setupSettingsKeys,
        toggleSettings,
    };
    window.applySettings = applySettings;
    window.buildSoundSettings = buildSoundSettings;
    window.playCrossChannelSound = playCrossChannelSound;
    window.playNotificationSound = playNotificationSound;
    window.saveSettings = saveSettings;
    window.setupSettingsKeys = setupSettingsKeys;
    window.toggleSettings = toggleSettings;
})();
