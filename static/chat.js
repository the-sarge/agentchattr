/* agentchattr — WebSocket client */

// Session token injected by the server into the HTML page.
// Sent with every API call and WebSocket connection to authenticate.
const SESSION_TOKEN = window.__SESSION_TOKEN__ || "";

let ws = null;
let autoScroll = true;
let reconnectTimer = null;
let username = 'user';
let selfNames = loadSelfNames();
let agentConfig = {};  // { name: { color, label } } — registered instances (used for pills)
let baseColors = {};   // { name: { color, label } } — base agent colors (for message coloring)
let todos = {};  // { msg_id: "todo" | "done" }
let rules = [];  // array of rule objects from server
let activeMentions = new Set();  // agent names with pre-@ toggled on
let replyingTo = null;  // { id, sender, text } or null
let unreadCount = 0;    // messages received while scrolled up
let soundEnabled = false;  // suppress sounds during initial history load
let activeChannel = localStorage.getItem('agentchattr-channel') || 'general';
let channelList = ['general'];
let channelUnread = {};  // { channelName: count }
let agentHats = {};  // { agent_name: svg_string }
window.customRoles = [];  // saved custom roles from settings
let colorOverrides = JSON.parse(localStorage.getItem('agentchattr-color-overrides') || '{}');
let attachmentsModuleMissingNotified = false;
let attachmentsModuleMissingContexts = new Set();
let helpTourModuleMissingNotified = false;
let helpTourModuleMissingContexts = new Set();
let messageRenderingModuleMissingNotified = false;
let messageRenderingModuleMissingContexts = new Set();
let schedulesModuleMissingNotified = false;

// Expose globals that extracted modules (sessions.js, jobs.js) read via window.*
// Using defineProperty so live values are always returned.
Object.defineProperty(window, 'SESSION_TOKEN', { get() { return SESSION_TOKEN; } });
Object.defineProperty(window, 'activeChannel', { get() { return activeChannel; } });
Object.defineProperty(window, 'channelList', { get() { return channelList; }, set(v) { channelList = v; } });
Object.defineProperty(window, 'channelUnread', { get() { return channelUnread; }, set(v) { channelUnread = v; } });
window._setActiveChannel = function(v) { activeChannel = v; };
// scrollToBottom is set after function definition (see below)
Object.defineProperty(window, 'username', { get() { return username; } });
window._setUsername = function(v) {
    username = v;
    rememberSelfName(username);
};
Object.defineProperty(window, 'agentConfig', { get() { return agentConfig; } });
// Cross-module read bridge for search-nav filters; chat.js remains the owner.
Object.defineProperty(window, 'todos', { get() { return todos; } });
Object.defineProperty(window, 'ws', { get() { return ws; } });
Object.defineProperty(window, 'soundEnabled', { get() { return soundEnabled; } });
Object.defineProperty(window, 'rules', { get() { return rules; }, set(v) { rules = v; } });
Object.defineProperty(window, 'autoScroll', { get() { return autoScroll; } });
Object.defineProperty(window, 'unreadCount', { get() { return unreadCount; }, set(v) { unreadCount = v; } });
Object.defineProperty(window, 'activeMentions', { get() { return activeMentions; } });
Object.defineProperty(window, 'agentHats', { get() { return agentHats; } });
Object.defineProperty(window, '_lastMentionedAgent', {
    get() { return _lastMentionedAgent; },
    set(v) { _lastMentionedAgent = v; },
});

function loadSelfNames() {
    try {
        const raw = JSON.parse(localStorage.getItem('agentchattr-self-names') || '["user"]');
        if (Array.isArray(raw)) {
            const names = raw.map(n => String(n || '').trim().toLowerCase()).filter(Boolean);
            return new Set(names.length ? names : ['user']);
        }
    } catch (_err) {}
    return new Set(['user']);
}

function rememberSelfName(name) {
    const normalized = String(name || '').trim().toLowerCase();
    if (!normalized) return;
    selfNames.add(normalized);
    try {
        localStorage.setItem('agentchattr-self-names', JSON.stringify([...selfNames]));
    } catch (_err) {}
}

function isSelfSender(sender) {
    const normalized = String(sender || '').trim().toLowerCase();
    if (!normalized || normalized === 'system') return false;
    if (selfNames.has(normalized)) return true;
    // Unknown senders are not self; during reconnects they may be agents
    // before the registry/base-color messages have finished loading.
    return false;
}
window.isSelfSender = isSelfSender;

// --- Drag-scroll for overflow containers ---
function enableDragScroll(el) {
    let isDown = false, startX, scrollLeft;
    el.addEventListener('mousedown', e => {
        if (e.button !== 0) return;  // left-click only
        isDown = true; startX = e.pageX - el.offsetLeft; scrollLeft = el.scrollLeft;
        el.style.cursor = 'grabbing';
    });
    el.addEventListener('mouseleave', () => { isDown = false; el.style.cursor = ''; });
    el.addEventListener('mouseup', () => { isDown = false; el.style.cursor = ''; });
    el.addEventListener('mousemove', e => {
        if (!isDown) return;
        e.preventDefault();
        el.scrollLeft = scrollLeft - (e.pageX - el.offsetLeft - startX);
    });
}

function reportSchedulesModuleUnavailable(context) {
    console.error(`Schedules module unavailable for ${context}`);
    if (!schedulesModuleMissingNotified) {
        schedulesModuleMissingNotified = true;
        showSlashHint('Schedules module failed to load - refresh required');
    }
}

function reportAttachmentsModuleUnavailable(context) {
    if (!attachmentsModuleMissingContexts.has(context)) {
        attachmentsModuleMissingContexts.add(context);
        console.error(`Attachments module unavailable for ${context}`);
    }
    if (!attachmentsModuleMissingNotified) {
        attachmentsModuleMissingNotified = true;
        showSlashHint('Attachments module failed to load - refresh required');
    }
}

function getAttachmentsMethod(name, context) {
    if (!window.Attachments) {
        reportAttachmentsModuleUnavailable(context);
        return null;
    }
    if (typeof window.Attachments[name] !== 'function') {
        reportAttachmentsModuleUnavailable(`${context}: ${name} missing`);
        return null;
    }
    return window.Attachments[name];
}

function reportHelpTourModuleUnavailable(context) {
    if (!helpTourModuleMissingContexts.has(context)) {
        helpTourModuleMissingContexts.add(context);
        console.error(`Help tour module unavailable for ${context}`);
    }
    if (!helpTourModuleMissingNotified) {
        helpTourModuleMissingNotified = true;
        showSlashHint('Help tour module failed to load - refresh required');
    }
}

function getHelpTourMethod(name, context) {
    if (!window.HelpTour) {
        reportHelpTourModuleUnavailable(context);
        return null;
    }
    if (typeof window.HelpTour[name] !== 'function') {
        reportHelpTourModuleUnavailable(`${context}: ${name} missing`);
        return null;
    }
    return window.HelpTour[name];
}

function reportMessageRenderingModuleUnavailable(context) {
    if (!messageRenderingModuleMissingContexts.has(context)) {
        messageRenderingModuleMissingContexts.add(context);
        console.error(`Message rendering module unavailable for ${context}`);
    }
    if (!messageRenderingModuleMissingNotified) {
        messageRenderingModuleMissingNotified = true;
        showSlashHint('Message rendering module failed to load - refresh required');
    }
}

function getMessageRenderingMethod(name, context) {
    if (!window.MessageRendering) {
        reportMessageRenderingModuleUnavailable(context);
        return null;
    }
    if (typeof window.MessageRendering[name] !== 'function') {
        reportMessageRenderingModuleUnavailable(`${context}: ${name} missing`);
        return null;
    }
    return window.MessageRendering[name];
}

function installHelpTourFallbacks() {
    if (typeof window.toggleHelp === 'function') return;
    window.toggleHelp = function() {
        reportHelpTourModuleUnavailable('help button click');
    };
}

// Settings UI and notification sound preferences live in settings.js.

// Real brand logo SVGs from Bootstrap Icons (MIT licensed)
const BRAND_AVATARS = {
    claude: `<svg viewBox="0 0 16 16" fill="white"><path d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z"/></svg>`,
    codex: `<svg viewBox="0 0 16 16" fill="white"><path d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z"/></svg>`,
    gemini: `<svg viewBox="0 0 65 65" fill="white"><path d="M32.447 0c.68 0 1.273.465 1.439 1.125a38.904 38.904 0 001.999 5.905c2.152 5 5.105 9.376 8.854 13.125 3.751 3.75 8.126 6.703 13.125 8.855a38.98 38.98 0 005.906 1.999c.66.166 1.124.758 1.124 1.438 0 .68-.464 1.273-1.125 1.439a38.902 38.902 0 00-5.905 1.999c-5 2.152-9.375 5.105-13.125 8.854-3.749 3.751-6.702 8.126-8.854 13.125a38.973 38.973 0 00-2 5.906 1.485 1.485 0 01-1.438 1.124c-.68 0-1.272-.464-1.438-1.125a38.913 38.913 0 00-2-5.905c-2.151-5-5.103-9.375-8.854-13.125-3.75-3.749-8.125-6.702-13.125-8.854a38.973 38.973 0 00-5.905-2A1.485 1.485 0 010 32.448c0-.68.465-1.272 1.125-1.438a38.903 38.903 0 005.905-2c5-2.151 9.376-5.104 13.125-8.854 3.75-3.749 6.703-8.125 8.855-13.125a38.972 38.972 0 001.999-5.905A1.485 1.485 0 0132.447 0z"/></svg>`,
    kimi: `<svg viewBox="0 0 16 16" fill="white"><path d="M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277q.792-.001 1.533-.16a.79.79 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278"/></svg>`,
    qwen: `<svg viewBox="0 0 331 328" fill="white"><path d="M120 8l23 39-23 39h180l-23 39H102L77 82l43-74z"/><path d="M30 86h45l88 152-25 43H53l22-39h45L30 86z"/><path d="M143 280l22 39 90-156 22 39h45l-43-74-49 0-87 152z"/></svg>`,
    kilo: `<svg viewBox="48 48 129 132" fill="black"><path d="M66.44 63.01Q64.87 65.23 65.5 68.28A2.33 2.33 0 0 0 67.78 70.13L86.53 70.13A2.43 2.41 67.4 0 1 88.24 70.84L102.02 84.62A3.21 3.21 0 0 1 102.96 86.89L102.96 102.05A.81.81 0 0 1 102.15 102.86L89.67 102.86A.78.77 0 0 1 88.89 102.09L88.89 86.2A2.04 2.04 0 0 0 86.86 84.16Q74.44 84.1 69.34 83.99Q68.24 83.97 67.5 84.16Q65.99 84.54 66.64 85.33L66.35 87.63L65.35 102.17A.65.64 2.3 0 1 64.69 102.77L50.01 102.57L49.99 50.57A.6.59-90 0 1 50.58 49.97L66.18 49.97A.31.31 0 0 1 66.49 50.29L66.44 63.01Z"/><rect x="88.81" y="51" width="14.18" height="16.62" rx="1.08"/><path d="M122.05 63.79L122.05 51.91A1.15 1.14 90 0 1 123.19 50.76L142.37 50.76A4.57 4.56 67.6 0 1 145.61 52.11L153.94 60.44A3.97 3.94 23 0 1 155.1 63.28Q154.92 74.65 155.02 86.25C155.04 88.43 156.32 88.89 158.37 88.92Q166.52 89.04 173.16 88.88A.91.91 0 0 1 174.09 89.79L174.09 102.07A.79.79 0 0 1 173.3 102.86L123.01 102.86A.89.88-90 0 1 122.13 101.97L122.13 89.71A.8.79-89 0 1 122.95 88.91Q130.98 89.21 138 88.78Q140.89 88.61 140.89 85.47Q140.89 75.62 140.52 67.56A2.12 2.11-1.3 0 0 138.4 65.54L123.8 65.54A1.75 1.75 0 0 1 122.05 63.79Z"/><rect x="-6.95" y="-6.95" transform="translate(95.98,129.08) rotate(-0.3)" width="13.9" height="13.9" rx=".88"/><path d="M66.82 158.21Q67.07 158.47 68.12 158.47Q103 158.42 103.5 158.44A.63.62-.5 0 1 104.14 159.06L104.19 174.48A.5.5 0 0 1 103.69 174.98Q94.92 174.96 64.49 175.1C60.2 175.12 58.29 172.24 55.55 169.5C52.81 166.76 49.92 164.85 49.94 160.56Q50.03 130.13 50 121.36A.5.5 0 0 1 50.5 120.86L65.92 120.89A.63.62-89.6 0 1 66.54 121.53Q66.56 122.03 66.56 156.91Q66.56 157.96 66.82 158.21Z"/><path d="M151.27 140.92Q151.82 140.86 151.98 140.39A.33.33 0 0 0 151.67 139.95L139.26 139.95A.32.31 0 0 1 138.94 139.64L138.94 126.18A.55.55 0 0 1 139.5 125.63Q145.94 125.66 153.44 125.56Q156.57 125.51 159.56 124.49L163.35 124.52A1.49 1.48-22.2 0 1 164.36 124.94L173.85 134.44A4.03 4.02-67.7 0 1 175.04 137.3L175.04 161.14A.63.63 0 0 1 174.41 161.77L158.82 161.77A.4.39-90 0 1 158.43 161.37L158.43 141.62A.55.55 0 0 0 157.89 141.07L151.27 140.92Z"/><path d="M136.83 162.31Q137.51 162.99 138.52 163.02Q147.16 163.23 155.66 162.98A1.29 1.29 0 0 1 156.98 164.27L156.98 176.37A.7.69-.4 0 1 156.29 177.06L133.55 177.06A2.39 2.38-21.8 0 1 131.83 176.32Q131.43 175.93 127.32 171.82Q123.2 167.7 122.81 167.3A2.39 2.38-68.1 0 1 122.08 165.58L122.11 142.84A.7.69-89.5 0 1 122.8 142.15L134.9 142.16A1.29 1.29 0 0 1 136.18 143.48Q135.92 151.98 136.13 160.62Q136.15 161.63 136.83 162.31Z"/></svg>`,
    codebuddy: `<svg viewBox="0 0 52 52" fill="white"><path d="M30.5918 3.12856C30.984 2.77679 31.0078 2.7632 31.2955 2.74593C31.7615 2.71193 32.1882 2.93586 32.9147 3.59728C34.6119 5.13959 36.9755 8.30995 38.4449 11.0177L39.0125 12.0691L39.8143 12.4677C40.5885 12.8589 41.8587 13.6611 42.389 14.0913C42.6286 14.2894 42.6626 14.2934 42.912 14.1964C44.0375 13.7583 45.6494 14.3393 47.0714 15.7033C48.3516 16.9303 49.5781 19.0269 50.0478 20.7767C50.1164 21.0582 50.2074 21.6636 50.2405 22.1144C50.3477 23.6973 49.84 24.9617 48.8624 25.5341C48.6628 25.6493 48.6492 25.6807 48.6548 26.1783C48.6998 28.5492 48.0606 30.9165 46.7768 33.2244C45.3276 35.8156 42.7467 38.496 39.2544 41.0214C37.3789 42.3862 32.9421 44.9717 30.9361 45.8792C26.1304 48.0428 22.278 48.8718 18.9316 48.4618C16.9356 48.22 14.6761 47.4417 13.3392 46.5373C12.9873 46.294 12.9318 46.2791 12.6629 46.3561C11.2318 46.7671 9.35752 45.9219 7.76528 44.1544C7.13027 43.448 6.10508 41.7136 5.77273 40.7853C5.00409 38.6128 5.15721 36.6516 6.18105 35.4808C6.44522 35.1797 6.4538 35.1667 6.39603 34.6598C6.30065 33.8298 6.25703 32.6017 6.30061 31.809L6.33535 31.0683L5.22371 29.1019C3.50212 26.0386 2.40857 23.4663 1.98661 21.501C1.76389 20.4233 1.77734 19.9446 2.05091 19.5908C2.21741 19.3773 2.76347 19.1568 3.42155 19.0352C5.07869 18.7442 8.69327 19.0065 12.7142 19.7165L13.1316 19.789L14.0497 18.977C15.5733 17.6274 16.5858 16.8705 18.4518 15.707C20.3967 14.4901 22.5922 13.4895 25.064 12.6968L25.8564 12.4423L26.2926 11.2974C27.8535 7.17701 29.452 4.13917 30.5918 3.12856ZM17.5169 24.2439C15.7528 25.2625 14.8705 25.7716 14.2223 26.3423C11.5975 28.6536 10.6172 32.3151 11.7346 35.6292C12.0106 36.4475 12.5193 37.3301 13.5378 39.0941C14.5563 40.8582 15.0662 41.7401 15.637 42.3882C17.9483 45.0128 21.6091 45.9938 24.923 44.8764C25.7414 44.6004 26.6233 44.0909 28.3875 43.0724L38.5362 37.213C40.3004 36.1945 41.1826 35.6854 41.8308 35.1147C44.4555 32.8034 45.4363 29.1426 44.319 25.8286C44.043 25.0103 43.5343 24.1277 42.5158 22.3637C41.4974 20.5997 40.9873 19.7177 40.4166 19.0696C38.1053 16.4448 34.4441 15.4631 31.1301 16.5806C30.3118 16.8565 29.4297 17.3661 27.6656 18.3846L17.5169 24.2439Z"/></svg>`,
    copilot: `<svg viewBox="0 0 16 16" fill="white"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>`,
};
const USER_AVATAR = `<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="12" r="5" fill="white" opacity="0.85"/><path d="M7 27C7 21.5 11 18 16 18C21 18 25 21.5 25 27" fill="white" opacity="0.85"/></svg>`;

function getAvatarSvg(sender) {
    const s = sender.toLowerCase();
    const resolved = resolveAgent(s);
    if (resolved) {
        if (BRAND_AVATARS[resolved]) return BRAND_AVATARS[resolved];
        // Use base field from agent config (handles custom names like "claudeypops" → claude)
        const cfg = agentConfig[resolved];
        if (cfg && cfg.base && BRAND_AVATARS[cfg.base]) return BRAND_AVATARS[cfg.base];
        // Fallback: parse base-N pattern (claude-2 → claude)
        const base = resolved.replace(/-\d+$/, '');
        if (base !== resolved && BRAND_AVATARS[base]) return BRAND_AVATARS[base];
    }
    // Fall back for offline agents: check config base, then parse pattern
    const cfg = agentConfig[s];
    if (cfg && cfg.base && BRAND_AVATARS[cfg.base]) return BRAND_AVATARS[cfg.base];
    const base = s.replace(/-\d+$/, '');
    if (BRAND_AVATARS[base]) return BRAND_AVATARS[base];
    return USER_AVATAR;
}
window.getAvatarSvg = getAvatarSvg;

// --- Update check ---

async function checkForUpdate() {
    try {
        const resp = await fetch('/api/version_check', {
            headers: { 'X-Session-Token': SESSION_TOKEN },
        });
        if (!resp.ok) return;
        const data = await resp.json();
        const pill = document.getElementById('update-pill');
        if (!pill) return;

        const dismissed = localStorage.getItem('agentchattr-dismissed-version');
        if (data.state === 'current' || data.state === 'unknown' || dismissed === data.latest) {
            pill.classList.add('hidden');
            return;
        }

        const label = data.state === 'upstream_update' ? 'Upstream update available' : 'Update available';
        pill.href = data.url || 'https://github.com/bcurts/agentchattr/releases';
        pill.innerHTML = `<span>${label}</span><button class="update-dismiss" onclick="dismissUpdate(event, '${data.latest}')" title="Dismiss">&times;</button>`;
        pill.classList.remove('hidden');
    } catch {
        // Silent fail -- version check should never block the UI
    }
}

function dismissUpdate(e, version) {
    e.preventDefault();
    e.stopPropagation();
    localStorage.setItem('agentchattr-dismissed-version', version);
    const pill = document.getElementById('update-pill');
    if (pill) pill.classList.add('hidden');
}

// --- Init ---

function init() {
    // Configure marked for chat-style rendering
    marked.setOptions({
        breaks: true,      // single newline → <br>
        gfm: true,         // GitHub-flavored markdown
    });

    detectPlatform();
    fetchRoles();
    connectWebSocket();
    setupInput();
    const setupDragDrop = getAttachmentsMethod('setupDragDrop', 'composer drag/drop setup');
    if (setupDragDrop) setupDragDrop();
    const setupPaste = getAttachmentsMethod('setupPaste', 'composer paste setup');
    if (setupPaste) setupPaste();
    setupScroll();
    window.setupSettingsKeys();
    setupKeyboardShortcuts();
    RulesPanel.init();
    Jobs.init();
    Sessions.init();
    Channels.init();
    checkForUpdate();

    // Dismiss channel edit controls when clicking outside channel bar
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#channel-bar')) {
            document.querySelectorAll('.channel-tab.editing').forEach(t => t.classList.remove('editing'));
        }
    });
}

function renderMarkdown(text) {
    // Protect Windows paths from escape replacement (e.g. \tests → tab, \new → newline)
    const pathSlots = [];
    text = text.replace(/[A-Z]:[\\\/][\w\-.\\ \/]+/g, (m) => {
        pathSlots.push(m);
        return `\x00P${pathSlots.length - 1}\x00`;
    });
    // Unescape literal \n and \t that agents sometimes send as escaped text
    text = text.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    // Escape < and > outside of code blocks/inline code so raw HTML
    // can't break layout or cause XSS, while preserving angle brackets
    // inside backtick-delimited code where users expect them to render.
    // Protect fenced code blocks and inline code by replacing them with placeholders
    var codeSlots = [];
    text = text.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, function(match) {
        codeSlots.push(match);
        return '\x00C' + (codeSlots.length - 1) + '\x00';
    });
    // Escape angle brackets in non-code text only
    text = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Restore code blocks (angle brackets inside them stay unescaped)
    text = text.replace(/\x00C(\d+)\x00/g, function(_, i) { return codeSlots[parseInt(i)]; });
    // Restore paths
    text = text.replace(/\x00P(\d+)\x00/g, (_, i) => pathSlots[parseInt(i)]);
    // Parse markdown, then color @mentions, URLs, and file paths in the output
    let html = marked.parse(text);
    // Remove wrapping <p> tags for single-line messages to keep them inline
    const trimmed = html.trim();
    if (trimmed.startsWith('<p>') && trimmed.endsWith('</p>') && trimmed.indexOf('<p>', 1) === -1) {
        html = trimmed.slice(3, -4);
    }
    html = colorMentions(html);
    html = linkifyUrls(html);
    html = linkifyPaths(html);
    return html;
}
window.renderMarkdown = renderMarkdown;

function linkifyUrls(html) {
    // Match http/https URLs not already inside an <a> tag.
    // We match tags first to skip them, then capture URLs in the same pass.
    return html.replace(/<a\b[^>]*>.*?<\/a>|(?<!["=])(https?:\/\/[^\s<>"')\]]+)/gs, (match, url) => {
        if (url) {
            return `<a href="${url}" target="_blank" rel="noopener">${url}</a>`;
        }
        return match;
    });
}

let serverPlatform = 'win32';  // default, updated on connect
async function detectPlatform() {
    try {
        const r = await fetch('/api/platform', { headers: { 'X-Session-Token': SESSION_TOKEN } });
        const data = await r.json();
        serverPlatform = data.platform || 'win32';
    } catch (e) { /* fallback to win32 */ }
}

function linkifyPaths(html) {
    // Windows paths: E:\foo\bar or E:/foo/bar
    html = html.replace(/(?<!["=\/])([A-Z]):[\\\/][\w\-.\\ \/]+/g, (match) => {
        const escaped = match.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return `<a class="file-link" href="#" onclick="openPath('${escaped}'); return false;" title="Open in file manager">${match}</a>`;
    });
    // Unix paths: /Users/..., /home/..., /tmp/..., /opt/..., /var/..., /etc/...
    if (serverPlatform !== 'win32') {
        html = html.replace(/(?<!["=\w])(\/(?:Users|home|tmp|opt|var|etc|usr)\/[\w\-.\/ ]+)/g, (match) => {
            const escaped = match.replace(/'/g, "\\'");
            return `<a class="file-link" href="#" onclick="openPath('${escaped}'); return false;" title="Open in file manager">${match}</a>`;
        });
    }
    return html;
}

async function openPath(path) {
    try {
        await fetch('/api/open-path', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Session-Token': SESSION_TOKEN },
            body: JSON.stringify({ path: path }),
        });
    } catch (err) {
        console.error('Failed to open path:', err);
    }
}

function addCodeCopyButtons(container) {
    const blocks = container.querySelectorAll('pre');
    for (const pre of blocks) {
        if (pre.querySelector('.code-copy-btn')) continue;
        const btn = document.createElement('button');
        btn.className = 'code-copy-btn';
        btn.textContent = 'copy';
        btn.onclick = async (e) => {
            e.stopPropagation();
            const code = pre.querySelector('code')?.textContent || pre.textContent;
            try {
                await navigator.clipboard.writeText(code);
                btn.textContent = 'copied!';
                setTimeout(() => { btn.textContent = 'copy'; }, 1500);
            } catch (err) {
                btn.textContent = 'failed';
                setTimeout(() => { btn.textContent = 'copy'; }, 1500);
            }
        };
        pre.style.position = 'relative';
        pre.appendChild(btn);
    }
}
window.addCodeCopyButtons = addCodeCopyButtons;

// --- WebSocket ---

function connectWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(SESSION_TOKEN)}`);

    ws.onopen = () => {
        console.log('WebSocket connected');
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    };

    ws.onmessage = (e) => {
        const event = JSON.parse(e.data);
        // Emit through Hub for modules to subscribe (PR 1 seam)
        Hub.emit(event.type, event);
        if (event.type === 'message_update') {
            // Re-render an updated message in-place (e.g. decision card resolved)
            const updated = event.message;
            if (updated && updated.id) {
                const existing = document.querySelector(`.message[data-id="${updated.id}"]`);
                if (existing && updated.type === 'decision') {
                    // Update just the choices area within the bubble
                    const choicesEl = existing.querySelector('.decision-choices');
                    const meta = updated.metadata || {};
                    if (choicesEl && meta.resolved) {
                        choicesEl.innerHTML = `<div class="decision-resolved">You chose: <strong>${escapeHtml(meta.chosen || '')}</strong></div>`;
                    }
                }
            }
        } else if (event.type === 'message') {
            // Play notification sound for new messages from others (not joins, not when focused)
            if (soundEnabled && !document.hasFocus() && event.data.type !== 'join' && event.data.type !== 'leave' && event.data.type !== 'summary' && event.data.sender && !isSelfSender(event.data.sender)) {
                window.playNotificationSound(event.data.sender);
            }
            const appendMessage = getMessageRenderingMethod('appendMessage', 'message event');
            if (appendMessage) appendMessage(event.data);
        } else if (event.type === 'agent_renamed') {
            // Migrate active mentions before the agents config rebuild
            if (activeMentions.has(event.old_name)) {
                activeMentions.delete(event.old_name);
                activeMentions.add(event.new_name);
            }
            // Update sender name, color, and avatar on all existing messages in the DOM
            const newColor = getColor(event.new_name);
            const newAvatar = getAvatarSvg(event.new_name);
            const newAgentKey = (resolveAgent(event.new_name.toLowerCase()) || event.new_name).toLowerCase();
            const newHat = agentHats[newAgentKey] || '';
            document.querySelectorAll('#messages .message').forEach(el => {
                // Regular chat messages
                const senderEl = el.querySelector('.msg-sender');
                if (senderEl && senderEl.textContent === event.old_name) {

                    senderEl.textContent = event.new_name;
                    senderEl.style.color = newColor;
                    // Update bubble accent color
                    const bubble = el.querySelector('.chat-bubble');
                    if (bubble) bubble.style.setProperty('--bubble-color', newColor);
                    // Update avatar
                    const avatarWrap = el.querySelector('.avatar-wrap');
                    if (avatarWrap) {
                        avatarWrap.dataset.agent = newAgentKey;
                        const avatar = avatarWrap.querySelector('.avatar');
                        if (avatar) {
                            avatar.style.backgroundColor = newColor;
                            avatar.innerHTML = newAvatar;
                        }
                        // Update hat
                        let hatEl = avatarWrap.querySelector('.hat-overlay');
                        if (newHat) {
                            if (!hatEl) {
                                hatEl = document.createElement('div');
                                hatEl.className = 'hat-overlay';
                                avatarWrap.appendChild(hatEl);
                            }
                            hatEl.dataset.agent = newAgentKey;
                            hatEl.innerHTML = newHat;
                        } else if (hatEl) {
                            hatEl.remove();
                        }
                    }
                }
                // Join/leave messages (separate structure, no .msg-sender)
                const joinText = el.querySelector('.join-text strong');
                if (joinText && joinText.textContent === event.old_name) {

                    joinText.textContent = event.new_name;
                    joinText.style.color = newColor;
                    const joinDot = el.querySelector('.join-dot');
                    if (joinDot) joinDot.style.background = newColor;
                }
            });
        } else if (event.type === 'agents') {
            applyAgentConfig(event.data);
        } else if (event.type === 'base_colors') {
            baseColors = event.data || {};
        } else if (event.type === 'todos') {
            todos = {};
            for (const [id, status] of Object.entries(event.data)) {
                todos[parseInt(id)] = status;
            }
        } else if (event.type === 'todo_update') {
            const d = event.data;
            if (d.status === null) {
                delete todos[d.id];
            } else {
                todos[d.id] = d.status;
            }
            updateTodoState(d.id, d.status);
        } else if (event.type === 'status') {
            updateStatus(event.data);
            // Status is the last event sent on connect — enable sounds after history
            if (!soundEnabled) {
                soundEnabled = true;
                const loader = document.getElementById('loading-indicator');
                if (loader) loader.classList.add('hidden');
                filterMessagesByChannel();
                renderChannelTabs();
                // Ensure refresh/reconnect lands on the latest visible message.
                requestAnimationFrame(() => {
                    autoScroll = true;
                    scrollToBottom();
                });
            }
        } else if (event.type === 'typing') {
            updateTyping(event.agent, event.active);
        } else if (event.type === 'settings') {
            window.applySettings(event.data);
        } else if (event.type === 'delete') {
            handleDeleteBroadcast(event.ids);
        } else if (event.type === 'rules' || event.type === 'decisions') {
            rules = event.data || [];
            renderRulesPanel();
            updateRulesBadge();
        } else if (event.type === 'rule' || event.type === 'decision') {
            handleRuleEvent(event.action, event.data);
        } else if (event.type === 'hats') {
            agentHats = event.data || {};
            updateAllHats();
        } else if (event.type === 'schedules') {
            if (window.Schedules && typeof window.Schedules.setSchedules === 'function') {
                window.Schedules.setSchedules(event.data);
            } else {
                reportSchedulesModuleUnavailable('schedules event');
            }
        } else if (event.type === 'schedule') {
            if (window.Schedules && typeof window.Schedules.handleScheduleEvent === 'function') {
                window.Schedules.handleScheduleEvent(event.action, event.data);
            } else {
                reportSchedulesModuleUnavailable('schedule event');
            }
        } else if (event.type === 'pending_instance') {
            // A new 2nd+ instance registered — queue naming lightbox
            _pendingNameQueue.push({
                name: event.name,
                label: event.label || event.name,
                color: event.color || '#888',
                base: event.base || '',
            });
            _showNextPendingName();
        } else if (event.type === 'channel_renamed') {
            // Migrate data-channel on existing DOM elements
            const container = document.getElementById('messages');
            for (const el of container.children) {
                if ((el.dataset.channel || 'general') === event.old_name) {
                    el.dataset.channel = event.new_name;
                }
            }
            // Update per-channel date tracking
            const renameChannelDateState = getMessageRenderingMethod('renameChannelDateState', 'channel rename date state');
            if (renameChannelDateState) renameChannelDateState(event.old_name, event.new_name);
            // Update active channel if we were on the renamed one
            if (activeChannel === event.old_name) {
                activeChannel = event.new_name;
                localStorage.setItem('agentchattr-channel', event.new_name);
                Store.set('activeChannel', event.new_name);
            }
        } else if (event.type === 'edit') {
            // A message was edited/demoted — re-render it in place
            const updatedMsg = event.message;
            if (updatedMsg && updatedMsg.id != null) {
                const el = document.querySelector(`.message[data-id="${updatedMsg.id}"]`);
                if (el) {
                    // Insert a fresh message after the old one, then remove the old
                    const placeholder = document.createElement('div');
                    el.after(placeholder);
                    el.remove();
                    // Temporarily hijack container to insert at the right spot
                    const container = document.getElementById('messages');
                    const appendMessage = getMessageRenderingMethod('appendMessage', 'edited message render');
                    if (appendMessage) appendMessage(updatedMsg);
                    // Move the newly appended message to where the old one was
                    const newEl = container.lastElementChild;
                    if (newEl && newEl.dataset.id == updatedMsg.id) {
                        placeholder.replaceWith(newEl);
                    } else {
                        placeholder.remove();
                    }
                }
            }
        } else if (event.type === 'clear') {
            const _clearDbgList = document.getElementById('jobs-list');
            const _clearDbgBefore = _clearDbgList ? _clearDbgList.children.length : -1;
            console.log('CLEAR_DEBUG clear event received, channel=' + (event.channel || 'ALL'), 'jobs-panel-children-before=' + _clearDbgBefore);
            const clearChannel = event.channel || null;
            if (clearChannel) {
                // Per-channel clear: remove only messages from that channel
                const container = document.getElementById('messages');
                const toRemove = [];
                for (const el of container.children) {
                    if (el.dataset.id && (el.dataset.channel || 'general') === clearChannel) {
                        toRemove.push(el);
                    }
                }
                toRemove.forEach(el => el.remove());
                // Clean up orphaned date dividers and reset tracking
                const clearChannelDateState = getMessageRenderingMethod('clearChannelDateState', 'channel clear date state');
                if (clearChannelDateState) clearChannelDateState(clearChannel);
                filterMessagesByChannel();
            } else {
                // Full clear (all channels)
                document.getElementById('messages').innerHTML = '';
                const resetDateState = getMessageRenderingMethod('resetDateState', 'full clear date state');
                if (resetDateState) resetDateState();
            }
            requestAnimationFrame(() => {
                const _clearDbgAfter = _clearDbgList ? _clearDbgList.children.length : -1;
                console.log('CLEAR_DEBUG after clear (next frame), jobs-panel-children=' + _clearDbgAfter);
            });
        } else if (event.type === 'reload') {
            // Server requests full page reload (e.g. after import)
            location.reload();
        }
    };

    ws.onclose = (e) => {
        // Server sends 4003 when session token is invalid (server restarted).
        // Auto-reload to pick up the fresh token from the new HTML page.
        if (e.code === 4003) {
            console.warn('Session token rejected (server restarted?) — reloading page...');
            location.reload();
            return;
        }
        console.log('Disconnected, reconnecting in 2s...');
        soundEnabled = false;  // suppress sounds during reconnect history replay
        const loader = document.getElementById('loading-indicator');
        if (loader) loader.classList.remove('hidden');
        reconnectTimer = setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        ws.close();
    };
}

// Timeline message rendering and date dividers live in message-rendering.js.

function getSenderClass(sender) {
    const s = sender.toLowerCase();
    if (s === 'system') return 'system';
    if (resolveAgent(s)) return 'agent';
    // Check base colors for offline agents
    const base = s.replace(/-\d+$/, '');
    if (base in baseColors) return 'agent';
    return 'user';
}

function resolveAgent(name) {
    const s = name.toLowerCase();
    if (s in agentConfig) return s;
    // Try prefix match: "gemini-cli" → "gemini"
    for (const key of Object.keys(agentConfig)) {
        if (s.startsWith(key)) return key;
    }
    return null;
}
window.resolveAgent = resolveAgent;

function getColor(sender) {
    const s = sender.toLowerCase();
    if (s === 'system') return 'var(--system-color)';
    const resolved = resolveAgent(s);
    if (resolved) {
        if (colorOverrides[resolved]) return colorOverrides[resolved];
        return agentConfig[resolved].color;
    }
    // Check overrides for unresolved names too
    if (colorOverrides[s]) return colorOverrides[s];
    // Fall back to base agent colors (for historical messages from offline agents)
    const base = s.replace(/-\d+$/, '');
    if (colorOverrides[base]) return colorOverrides[base];
    if (base in baseColors) return baseColors[base].color;
    return 'var(--user-color)';
}
window.getColor = getColor;

function colorMentions(textHtml) {
    // Match any @word — we'll resolve color per match
    return textHtml.replace(/@(\w[\w-]*)/gi, (match, name) => {
        const lower = name.toLowerCase();
        if (lower === 'both' || lower === 'all') {
            return `<span class="mention" style="color: var(--accent)">@${name}</span>`;
        }
        const resolved = resolveAgent(lower);
        if (resolved) {
            const color = getColor(resolved);
            return `<span class="mention" style="color: ${color}">@${name}</span>`;
        }
        // Non-agent mention (e.g. @ben, @user) — use user color
        return `<span class="mention" style="color: var(--user-color)">@${name}</span>`;
    });
}

function scrollToBottom() {
    const timeline = document.getElementById('timeline');
    timeline.scrollTop = timeline.scrollHeight;
    unreadCount = 0;
    updateScrollAnchor();
}
window.scrollToBottom = scrollToBottom;

function updateScrollAnchor() {
    const anchor = document.getElementById('scroll-anchor');
    if (autoScroll) {
        anchor.classList.add('hidden');
    } else {
        anchor.classList.remove('hidden');
        const badge = anchor.querySelector('.unread-badge');
        if (badge) {
            badge.textContent = unreadCount;
            badge.style.display = unreadCount > 0 ? 'flex' : 'none';
        }
    }
    repositionScrollAnchor();
}
window.updateScrollAnchor = updateScrollAnchor;

function repositionScrollAnchor() {
    const anchor = document.getElementById('scroll-anchor');
    if (!anchor) return;
    const footer = document.querySelector('footer');
    if (footer) {
        anchor.style.bottom = (footer.offsetHeight + 12) + 'px';
    }
    const timeline = document.getElementById('timeline');
    if (timeline) {
        const rect = timeline.getBoundingClientRect();
        anchor.style.left = (rect.left + rect.width / 2) + 'px';
    }
}
window.repositionScrollAnchor = repositionScrollAnchor;

// --- Agents ---

function applyAgentConfig(data) {
    agentConfig = {};
    for (const [name, cfg] of Object.entries(data)) {
        agentConfig[name.toLowerCase()] = cfg;
    }
    buildStatusPills();
    buildMentionToggles();
    window.buildSoundSettings();
    // Re-color any messages already rendered (e.g. from a reconnect)
    recolorMessages();
    updateJobReplyTargetUI();
}

function recolorMessages() {
    const msgs = document.querySelectorAll('.message[data-id]');
    for (const el of msgs) {
        const sender = el.querySelector('.msg-sender');
        if (!sender) continue;
        const name = sender.textContent.trim();
        const color = getColor(name);
        sender.style.color = color;
        // Update bubble color
        const bubble = el.querySelector('.chat-bubble');
        if (bubble) bubble.style.setProperty('--bubble-color', color);
        // Update avatar color
        const avatar = el.querySelector('.avatar');
        if (avatar) avatar.style.backgroundColor = color;
        // Re-render markdown with updated mention colors and hashtags
        const textEl = el.querySelector('.msg-text');
        if (textEl && el.dataset.rawText) {
            textEl.innerHTML = styleHashtags(renderMarkdown(el.dataset.rawText));
            addCodeCopyButtons(el);
        }
    }
}

// --- Hats ---

function updateAllHats() {
    // Update hat overlays on all message avatars
    document.querySelectorAll('.avatar-wrap[data-agent]').forEach(wrap => {
        const agent = wrap.dataset.agent;
        const svg = agentHats[agent] || '';
        let overlay = wrap.querySelector('.hat-overlay');

        if (svg) {
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'hat-overlay';
                overlay.dataset.agent = agent;
                wrap.appendChild(overlay);
            }
            overlay.innerHTML = svg;
        } else {
            if (overlay) overlay.remove();
        }
    });
}

// --- Hat drag-to-trash ---

const TRASH_SVG = `<svg viewBox="0 0 20 20" fill="none" width="20" height="20"><rect x="4" y="6" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M3 6h14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M8 3h4v3H8z" stroke="currentColor" stroke-width="1.2"/><rect class="trash-lid" x="3" y="4.5" width="14" height="2" rx="0.5" fill="currentColor" style="transform-origin: 10px 5.5px"/></svg>`;

let hatDragState = null;  // { agent, ghostEl, originRect, trashEl, wrapEl }

document.addEventListener('mousedown', (e) => {
    const overlay = e.target.closest('.hat-overlay');
    if (!overlay || hatDragState) return;
    e.preventDefault();

    const agent = overlay.dataset.agent;
    const wrap = overlay.closest('.avatar-wrap');
    if (!wrap) return;

    const rect = overlay.getBoundingClientRect();

    // Create drag ghost (fixed position, follows cursor)
    const ghost = document.createElement('div');
    ghost.className = 'hat-drag-ghost';
    ghost.innerHTML = overlay.innerHTML;
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    document.body.appendChild(ghost);

    // Hide original overlay
    overlay.style.visibility = 'hidden';

    // Create trash can to the left of the avatar-wrap
    const trash = document.createElement('div');
    trash.className = 'hat-trash';
    trash.innerHTML = TRASH_SVG;
    wrap.appendChild(trash);
    // Force reflow then show
    trash.offsetHeight;
    trash.classList.add('visible');

    hatDragState = { agent, ghostEl: ghost, originRect: rect, trashEl: trash, wrapEl: wrap, overlayEl: overlay };
});

document.addEventListener('mousemove', (e) => {
    if (!hatDragState) return;
    const { ghostEl, trashEl } = hatDragState;

    // Move ghost to follow cursor (centered on cursor)
    ghostEl.style.left = (e.clientX - ghostEl.offsetWidth / 2) + 'px';
    ghostEl.style.top = (e.clientY - ghostEl.offsetHeight / 2) + 'px';

    // Check proximity to trash for highlight
    const trashRect = trashEl.getBoundingClientRect();
    const ghostCX = e.clientX;
    const ghostCY = e.clientY;
    const overTrash = ghostCX >= trashRect.left - 12 && ghostCX <= trashRect.right + 12 &&
                      ghostCY >= trashRect.top - 12 && ghostCY <= trashRect.bottom + 12;
    trashEl.classList.toggle('hover', overTrash);
});

document.addEventListener('mouseup', (e) => {
    if (!hatDragState) return;
    const { agent, ghostEl, originRect, trashEl, wrapEl, overlayEl } = hatDragState;

    // Check if dropped on trash
    const trashRect = trashEl.getBoundingClientRect();
    const overTrash = e.clientX >= trashRect.left - 12 && e.clientX <= trashRect.right + 12 &&
                      e.clientY >= trashRect.top - 12 && e.clientY <= trashRect.bottom + 12;

    if (overTrash) {
        // Snap ghost to trash center, shrink, fade out
        ghostEl.style.transition = 'all 0.25s ease-in';
        ghostEl.style.left = (trashRect.left + trashRect.width / 2 - ghostEl.offsetWidth / 2) + 'px';
        ghostEl.style.top = (trashRect.top + trashRect.height / 2 - ghostEl.offsetHeight / 2) + 'px';
        ghostEl.style.transform = 'scale(0.2)';
        ghostEl.style.opacity = '0';

        // Chomp animation on trash
        trashEl.classList.remove('hover');
        trashEl.classList.add('chomping');

        // Send DELETE to server
        fetch(`/api/hat/${agent}`, {
            method: 'DELETE',
            headers: { 'X-Session-Token': SESSION_TOKEN },
        }).catch(err => console.error('Hat delete failed:', err));

        // Cleanup after animation
        setTimeout(() => {
            ghostEl.remove();
            trashEl.remove();
            if (overlayEl) overlayEl.remove();
        }, 600);
    } else {
        // Return ghost to original position
        ghostEl.style.transition = 'all 0.3s ease';
        ghostEl.style.left = originRect.left + 'px';
        ghostEl.style.top = originRect.top + 'px';

        // Fade out trash
        trashEl.classList.remove('hover', 'visible');

        setTimeout(() => {
            ghostEl.remove();
            trashEl.remove();
            overlayEl.style.visibility = '';
        }, 300);
    }

    hatDragState = null;
});

// Cancel hat drag on Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && hatDragState) {
        const { ghostEl, originRect, trashEl, overlayEl } = hatDragState;
        ghostEl.style.transition = 'all 0.3s ease';
        ghostEl.style.left = originRect.left + 'px';
        ghostEl.style.top = originRect.top + 'px';
        trashEl.classList.remove('hover', 'visible');
        setTimeout(() => {
            ghostEl.remove();
            trashEl.remove();
            overlayEl.style.visibility = '';
        }, 300);
        hatDragState = null;
    }
});

function buildStatusPills() {
    const container = document.getElementById('agent-status');
    container.innerHTML = '';
    for (const [name, cfg] of Object.entries(agentConfig)) {
        const pill = document.createElement('div');
        pill.className = 'status-pill';
        if (cfg.state === 'pending') pill.classList.add('pending');
        pill.id = `status-${name}`;
        pill.title = `@${name}`;  // Tooltip: canonical name for manual @-typing
        pill.style.setProperty('--agent-color', colorOverrides[name] || cfg.color || '#4ade80');
        pill.innerHTML = `<span class="status-dot"></span><span class="status-label">${escapeHtml(cfg.label || name)}</span>`;
        // Left-click to toggle pill popover (rename + role + color)
        pill.addEventListener('click', (e) => {
            e.stopPropagation();
            // Toggle: close if this pill's popover is already open
            const existing = document.querySelector(`.pill-popover[data-agent="${name}"]`);
            if (existing) { existing.remove(); return; }
            const mode = cfg.state === 'pending' ? 'pending' : 'rename';
            showPillPopover(pill, {
                name, label: cfg.label || name, color: cfg.color || '#888',
                base: cfg.base || '', mode,
            });
        });
        container.appendChild(pill);
    }
    enableDragScroll(container);
}

// --- Role presets (shared by pill popover + bubble picker) ---

const ROLE_PRESETS = [
    { label: 'Planner', emoji: '📋' },
    { label: 'Designer', emoji: '✨' },
    { label: 'Architect', emoji: '🏛️' },
    { label: 'Builder', emoji: '🔨' },
    { label: 'Reviewer', emoji: '🔍' },
    { label: 'Researcher', emoji: '🔬' },
    { label: 'Red Team', emoji: '🛡️' },
    { label: 'Wry', emoji: '🍸' },
    { label: 'Unhinged', emoji: '🤪' },
    { label: 'Hype', emoji: '🎉' },
];

let agentOpsAttachCache = null;
let agentOpsAttachCacheAt = 0;
const AGENT_OPS_ATTACH_CACHE_MS = 5000;

async function getAgentOpsPayloadForPopover() {
    const now = Date.now();
    if (agentOpsAttachCache && now - agentOpsAttachCacheAt < AGENT_OPS_ATTACH_CACHE_MS) {
        return agentOpsAttachCache;
    }
    const resp = await fetch('/api/agent-ops', {
        headers: { 'X-Session-Token': SESSION_TOKEN },
    });
    if (!resp.ok) throw new Error(`agent ops request failed: ${resp.status}`);
    agentOpsAttachCache = await resp.json();
    agentOpsAttachCacheAt = now;
    return agentOpsAttachCache;
}

function findPillAttachRows(payload, opts) {
    const configured = Array.isArray(payload.configured_agents) ? payload.configured_agents : [];
    const registered = Array.isArray(payload.registered_agents) ? payload.registered_agents : [];
    const name = opts.name || '';
    const base = opts.base || name;
    const registeredRow = registered.find(row => row.name === name)
        || registered.find(row => row.base === name)
        || registered.find(row => row.base === base);
    const configuredRow = configured.find(row => row.name === base)
        || configured.find(row => row.name === name)
        || configured.find(row => Array.isArray(row.registered_names) && row.registered_names.includes(name));
    return { configuredRow, registeredRow };
}

function renderPillAttachCommandRow(label, command) {
    return `<div class="pill-popover-copy-row">
        <span class="pill-popover-copy-label">${escapeHtml(label)}</span>
        <code class="pill-popover-command" title="${escapeAttr(command)}">${escapeHtml(command)}</code>
        <button type="button" class="pill-popover-copy-btn" data-copy-command="${escapeAttr(command)}">copy</button>
    </div>`;
}

async function copyPillAttachCommand(button, command) {
    try {
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
            throw new Error('clipboard API unavailable');
        }
        await navigator.clipboard.writeText(command);
        button.textContent = 'copied';
        button.classList.add('copied');
    } catch (err) {
        console.error('Failed to copy tmux command:', err);
        button.textContent = 'failed';
    }
    setTimeout(() => {
        button.textContent = 'copy';
        button.classList.remove('copied');
    }, 1400);
}

async function loadPillAttachCommands(opts, target) {
    if (!target) return;
    try {
        const payload = await getAgentOpsPayloadForPopover();
        const { configuredRow, registeredRow } = findPillAttachRows(payload, opts);
        const liveCommand = registeredRow?.attach?.live || configuredRow?.attach?.live || '';
        const wrapperCommand = configuredRow?.tmux?.wrapper_running ? (configuredRow?.attach?.wrapper || '') : '';
        const rows = [];
        if (liveCommand) rows.push(renderPillAttachCommandRow('live', liveCommand));
        if (wrapperCommand) rows.push(renderPillAttachCommandRow('wrapper', wrapperCommand));
        target.innerHTML = rows.length
            ? rows.join('')
            : '<div class="pill-popover-command-empty">No tmux command available</div>';
        target.querySelectorAll('.pill-popover-copy-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                copyPillAttachCommand(button, button.dataset.copyCommand || '');
            });
        });
    } catch (err) {
        console.error('Failed to load agent tmux commands:', err);
        target.innerHTML = '<div class="pill-popover-command-empty">Tmux commands unavailable</div>';
    }
}

// --- Agent naming lightbox ---

const _pendingNameQueue = [];
let _nameModalActive = false;

function _showNextPendingName() {
    if (_nameModalActive || _pendingNameQueue.length === 0) return;
    const next = _pendingNameQueue.shift();
    // Only show if still pending in agentConfig
    const cfg = agentConfig[next.name];
    if (cfg && cfg.state === 'pending') {
        const pillEl = document.getElementById(`status-${next.name}`);
        showPillPopover(pillEl || null, { ...next, mode: 'pending' });
    } else {
        _showNextPendingName(); // skip stale entries
    }
}

function showAgentNameModal(opts) {
    // opts: { name, label, color, base, mode: 'pending' | 'rename' }
    _nameModalActive = true;
    let modal = document.getElementById('agent-name-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'agent-name-modal';
        modal.className = 'agent-name-modal hidden';
        modal.innerHTML = `
            <div class="agent-name-dialog">
                <div class="agent-name-header">
                    <div class="agent-name-avatar"></div>
                    <h3 class="agent-name-title"></h3>
                </div>
                <p class="agent-name-subtitle"></p>
                <input type="text" class="agent-name-input" maxlength="24" spellcheck="false" autocomplete="off" />
                <div class="agent-name-actions">
                    <button class="agent-name-cancel">Cancel</button>
                    <button class="agent-name-confirm">Confirm</button>
                </div>
            </div>`;
        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) _closeAgentNameModal();
        });
        document.body.appendChild(modal);
    }

    const avatarEl = modal.querySelector('.agent-name-avatar');
    const titleEl = modal.querySelector('.agent-name-title');
    const subtitleEl = modal.querySelector('.agent-name-subtitle');
    const inputEl = modal.querySelector('.agent-name-input');
    const cancelBtn = modal.querySelector('.agent-name-cancel');
    const confirmBtn = modal.querySelector('.agent-name-confirm');

    // Set agent color accent
    modal.style.setProperty('--agent-color', opts.color);

    // Avatar from brand
    const brandKey = opts.base || opts.name.replace(/-\d+$/, '');
    avatarEl.innerHTML = BRAND_AVATARS[brandKey] || USER_AVATAR;
    avatarEl.style.background = opts.color;

    if (opts.mode === 'pending') {
        const familyLabel = (baseColors[opts.base] || {}).label || opts.base || 'agent';
        titleEl.textContent = 'Name this agent';
        subtitleEl.textContent = `A new ${familyLabel} instance connected`;
    } else {
        titleEl.textContent = 'Rename agent';
        subtitleEl.textContent = `Current ID: @${opts.name}`;
    }

    inputEl.value = opts.label;
    inputEl.placeholder = opts.label;

    // Remove old listeners by cloning
    const newCancel = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
    const newConfirm = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);

    newCancel.addEventListener('click', () => _closeAgentNameModal());
    newConfirm.addEventListener('click', () => {
        const label = inputEl.value.trim();
        if (!label) return;
        if (ws && ws.readyState === WebSocket.OPEN) {
            if (opts.mode === 'pending') {
                ws.send(JSON.stringify({ type: 'name_pending', name: opts.name, label }));
            } else {
                ws.send(JSON.stringify({ type: 'rename_agent', name: opts.name, label }));
            }
        }
        _closeAgentNameModal();
    });

    // Enter key confirms
    inputEl.onkeydown = (e) => {
        if (e.key === 'Enter') { newConfirm.click(); e.preventDefault(); }
        if (e.key === 'Escape') { _closeAgentNameModal(); e.preventDefault(); }
    };

    modal.classList.remove('hidden');
    // Focus and select input text after animation frame
    requestAnimationFrame(() => { inputEl.focus(); inputEl.select(); });
}

function _closeAgentNameModal() {
    const modal = document.getElementById('agent-name-modal');
    if (modal) modal.classList.add('hidden');
    _nameModalActive = false;
    // Show next pending if queued
    setTimeout(_showNextPendingName, 200);
}

// --- Pill popover (rename + role) ---

function showPillPopover(pillEl, opts) {
    if (opts.mode === 'pending') _nameModalActive = true;

    document.querySelectorAll('.pill-popover').forEach(p => p.remove());

    const popover = document.createElement('div');
    popover.className = 'pill-popover';
    popover.dataset.agent = opts.name;
    popover.style.setProperty('--agent-color', colorOverrides[opts.name] || opts.color);

    const currentRole = (_agentRoles[opts.name] || '').toLowerCase();
    const roleChipsHtml = ROLE_PRESETS.map(p =>
        `<button class="role-preset-chip pill-role-chip ${currentRole === p.label.toLowerCase() ? 'active' : ''}" data-role="${escapeHtml(p.label)}">${p.emoji} ${escapeHtml(p.label)}</button>`
    ).join('');
    const customChipsHtml = (window.customRoles || [])
        .filter(r => r && !ROLE_PRESETS.some(p => p.label.toLowerCase() === r.toLowerCase()))
        .map(r =>
            `<button class="role-preset-chip pill-role-chip pill-custom-chip ${currentRole === r.toLowerCase() ? 'active' : ''}" data-role="${escapeHtml(r)}"><span class="pill-custom-label">${escapeHtml(r)}</span><span class="pill-custom-trash"><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V3h4v1M5 4v8.5h6V4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="pill-custom-confirm"><span class="pill-confirm-yes">&#10003;</span><span class="pill-confirm-no">&#10005;</span></span></button>`
        ).join('');

    popover.innerHTML = `
        <div class="pill-popover-section">
            <label class="pill-popover-label">${opts.mode === 'pending' ? 'Name this agent' : 'Rename'}</label>
            <div class="pill-popover-rename-row">
                <input type="text" class="pill-popover-input" value="${escapeHtml(opts.label)}" maxlength="24" spellcheck="false" />
                <button class="pill-popover-confirm">${opts.mode === 'pending' ? 'Confirm' : 'Rename'}</button>
            </div>
        </div>
        <div class="pill-popover-section">
            <label class="pill-popover-label">Role</label>
            <div class="pill-popover-roles">
                <button class="role-preset-chip pill-role-chip ${!currentRole ? 'active' : ''}" data-role="">None</button>
                ${roleChipsHtml}
                ${customChipsHtml}
            </div>
            <div class="pill-popover-custom-row">
                <input type="text" class="pill-popover-custom-input" placeholder="Custom role..." maxlength="20" />
            </div>
        </div>
        ${(() => {
            // Resolve the actual current color: override → pill CSS var → config → fallback
            let current = colorOverrides[opts.name] || '';
            if (!current && pillEl) {
                const computed = getComputedStyle(pillEl).getPropertyValue('--agent-color').trim();
                if (computed && !computed.startsWith('var(')) current = computed;
            }
            if (!current) current = opts.color || '';
            current = current.toLowerCase();
            const swatches = ['#ef4444','#da7756','#f97316','#f59e0b','#84cc16','#10a37f','#14b8a6','#06b6d4','#1783ff','#4285f4','#6366f1','#8b5cf6','#ec4899','#ff6b35'];
            const matchesSwatch = swatches.some(c => current === c.toLowerCase());
            const colorInputVal = (current && !current.startsWith('var(')) ? current : (opts.color || '#888888');
            return `<div class="pill-popover-section">
                <label class="pill-popover-label">Color</label>
                <div class="pill-popover-colors">
                    ${swatches.map(c =>
                        `<button class="color-swatch ${current === c.toLowerCase() ? 'active' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`
                    ).join('')}
                </div>
                <div class="pill-popover-color-custom">
                    <input type="color" class="pill-popover-color-input ${!matchesSwatch ? 'active' : ''}" value="${colorInputVal}" title="Pick custom color" />
                    <button class="pill-popover-color-reset" title="Reset to default">Reset</button>
                </div>
            </div>`;
        })()}
        <div class="pill-popover-section pill-popover-tmux">
            <label class="pill-popover-label">Tmux</label>
            <div class="pill-popover-copy-list" data-agent-tmux-commands>
                <div class="pill-popover-command-empty">Loading...</div>
            </div>
        </div>
    `;

    const inputEl = popover.querySelector('.pill-popover-input');
    const confirmBtn = popover.querySelector('.pill-popover-confirm');
    const customInput = popover.querySelector('.pill-popover-custom-input');

    const closePopover = () => {
        popover.remove();
        document.removeEventListener('click', outsideClickHandler, true);
        if (opts.mode === 'pending') {
            _nameModalActive = false;
            setTimeout(_showNextPendingName, 200);
        }
    };

    const outsideClickHandler = (e) => {
        if (!popover.contains(e.target) && !(pillEl && pillEl.contains(e.target))) {
            closePopover();
        }
    };

    confirmBtn.addEventListener('click', () => {
        const label = inputEl.value.trim();
        if (!label) return;
        if (ws && ws.readyState === WebSocket.OPEN) {
            if (opts.mode === 'pending') {
                ws.send(JSON.stringify({ type: 'name_pending', name: opts.name, label }));
            } else {
                ws.send(JSON.stringify({ type: 'rename_agent', name: opts.name, label }));
            }
        }
        closePopover();
    });

    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { confirmBtn.click(); e.preventDefault(); }
        if (e.key === 'Escape') { closePopover(); e.preventDefault(); }
    });

    popover.querySelectorAll('.pill-role-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const role = chip.dataset.role || '';
            _setRole(opts.name, role);
            closePopover();
        });
    });

    // Custom chip: trash icon → confirm mode (red chip with tick/cross)
    popover.querySelectorAll('.pill-custom-chip').forEach(chip => {
        const trash = chip.querySelector('.pill-custom-trash');
        const confirmEl = chip.querySelector('.pill-custom-confirm');
        const yesBtn = chip.querySelector('.pill-confirm-yes');
        const noBtn = chip.querySelector('.pill-confirm-no');

        if (trash) trash.addEventListener('click', (e) => {
            e.stopPropagation();
            chip.classList.add('confirm-delete');
        });
        if (yesBtn) yesBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            _deleteCustomRole(chip.dataset.role);
            chip.remove();
        });
        if (noBtn) noBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            chip.classList.remove('confirm-delete');
        });
    });

    customInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const val = customInput.value.trim();
            if (val) { _setRole(opts.name, val); closePopover(); }
            e.preventDefault();
        }
        if (e.key === 'Escape') { closePopover(); e.preventDefault(); }
    });

    // --- Color picker handlers ---
    const applyColorOverride = (color) => {
        colorOverrides[opts.name] = color;
        localStorage.setItem('agentchattr-color-overrides', JSON.stringify(colorOverrides));
        // Update pill color
        const pillToUpdate = document.getElementById(`status-${opts.name}`);
        if (pillToUpdate) pillToUpdate.style.setProperty('--agent-color', color);
        popover.style.setProperty('--agent-color', color);
        // Recolor all messages
        recolorMessages();
        // Rebuild mention toggles with new colors
        buildMentionToggles();
        // Update active swatch + color input highlight
        const swatchColors = [];
        popover.querySelectorAll('.color-swatch').forEach(s => {
            const match = s.dataset.color.toLowerCase() === color.toLowerCase();
            s.classList.toggle('active', match);
            swatchColors.push(s.dataset.color.toLowerCase());
        });
        const colorInput = popover.querySelector('.pill-popover-color-input');
        if (colorInput) {
            colorInput.value = color;
            // Highlight color input if color doesn't match any swatch
            colorInput.classList.toggle('active', !swatchColors.includes(color.toLowerCase()));
        }
    };

    popover.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', (e) => {
            e.stopPropagation();
            applyColorOverride(swatch.dataset.color);
        });
    });

    const colorInput = popover.querySelector('.pill-popover-color-input');
    if (colorInput) {
        colorInput.addEventListener('input', (e) => {
            applyColorOverride(e.target.value);
        });
    }

    const resetBtn = popover.querySelector('.pill-popover-color-reset');
    if (resetBtn) {
        resetBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            delete colorOverrides[opts.name];
            localStorage.setItem('agentchattr-color-overrides', JSON.stringify(colorOverrides));
            const defaultColor = opts.color || '#888';
            const pillToUpdate = document.getElementById(`status-${opts.name}`);
            if (pillToUpdate) pillToUpdate.style.setProperty('--agent-color', defaultColor);
            popover.style.setProperty('--agent-color', defaultColor);
            recolorMessages();
            buildMentionToggles();
            popover.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
            if (colorInput) colorInput.value = defaultColor;
        });
    }

    document.body.appendChild(popover);
    loadPillAttachCommands(opts, popover.querySelector('[data-agent-tmux-commands]'));

    if (pillEl) {
        const rect = pillEl.getBoundingClientRect();
        const popoverWidth = 280;
        let left;
        // If pill is in the right half of the screen, align popover's right edge to pill's right edge
        if (rect.right + popoverWidth - rect.width > window.innerWidth - 12) {
            left = rect.right - popoverWidth;
        } else {
            left = rect.left;
        }
        // Final clamp to keep on screen
        left = Math.max(12, Math.min(left, window.innerWidth - popoverWidth - 12));
        popover.style.top = `${rect.bottom + 8}px`;
        popover.style.left = `${left}px`;
    } else {
        popover.style.top = '50%';
        popover.style.left = '50%';
        popover.style.transform = 'translate(-50%, -50%)';
    }

    setTimeout(() => document.addEventListener('click', outsideClickHandler, true), 0);
    inputEl.focus();
}

// --- Bubble role picker ---

function showBubbleRolePicker(btn, agentName) {
    // Close any existing picker and reset z-index on its parent message
    document.querySelectorAll('.bubble-role-picker').forEach(p => {
        const msg = p.closest('.message');
        if (msg) msg.style.zIndex = '';
        p.remove();
    });

    const currentRole = (_agentRoles[agentName] || '').toLowerCase();
    const picker = document.createElement('div');
    picker.className = 'bubble-role-picker';
    const closePicker = () => { if (msgEl) msgEl.style.zIndex = ''; picker.remove(); };

    // None chip
    const noneChip = document.createElement('button');
    noneChip.className = 'role-preset-chip' + (!currentRole ? ' active' : '');
    noneChip.textContent = 'None';
    noneChip.addEventListener('click', () => { _setRole(agentName, ''); closePicker(); });
    picker.appendChild(noneChip);

    for (const preset of ROLE_PRESETS) {
        const chip = document.createElement('button');
        chip.className = 'role-preset-chip' + (currentRole === preset.label.toLowerCase() ? ' active' : '');
        chip.textContent = `${preset.emoji} ${preset.label}`;
        chip.addEventListener('click', () => { _setRole(agentName, preset.label); closePicker(); });
        picker.appendChild(chip);
    }

    // Saved custom roles
    for (const r of (window.customRoles || [])) {
        if (!r || ROLE_PRESETS.some(p => p.label.toLowerCase() === r.toLowerCase())) continue;
        const chip = document.createElement('button');
        chip.className = 'role-preset-chip' + (currentRole === r.toLowerCase() ? ' active' : '');
        chip.textContent = r;
        chip.addEventListener('click', () => { _setRole(agentName, r); closePicker(); });
        picker.appendChild(chip);
    }

    // Custom text input
    const customRow = document.createElement('div');
    customRow.className = 'bubble-role-custom';
    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.className = 'bubble-role-input';
    customInput.placeholder = 'Custom...';
    customInput.maxLength = 20;
    customInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const val = customInput.value.trim();
            if (val) { _setRole(agentName, val); closePicker(); }
            e.preventDefault();
        }
        if (e.key === 'Escape') { closePicker(); }
    });
    customRow.appendChild(customInput);
    picker.appendChild(customRow);

    // Place inside the chat-bubble, positioned below the clicked button
    const bubble = btn.closest('.chat-bubble');
    const msgEl = btn.closest('.message');
    if (msgEl) msgEl.style.zIndex = '50';
    bubble.appendChild(picker);

    // Position picker below the button that was clicked
    requestAnimationFrame(() => {
        const btnRect = btn.getBoundingClientRect();
        const bubbleRect = bubble.getBoundingClientRect();
        picker.style.top = (btnRect.bottom - bubbleRect.top + 4) + 'px';
        picker.style.left = (btnRect.left - bubbleRect.left) + 'px';
        picker.style.right = 'auto';

        // Flip upward if picker would overflow below the footer/viewport
        const pickerRect = picker.getBoundingClientRect();
        const footerEl = document.querySelector('footer');
        const maxBottom = footerEl ? footerEl.getBoundingClientRect().top : window.innerHeight - 20;
        if (pickerRect.bottom > maxBottom) {
            picker.style.top = 'auto';
            picker.style.bottom = (bubbleRect.bottom - btnRect.top + 4) + 'px';
        }
        // Nudge left if overflowing right edge
        if (pickerRect.right > window.innerWidth - 10) {
            picker.style.left = 'auto';
            picker.style.right = '0';
        }
    });

    // Close on outside click (next tick to avoid catching the current click)
    setTimeout(() => {
        const closeHandler = (e) => {
            if (!picker.contains(e.target)) {
                closePicker();
                document.removeEventListener('click', closeHandler, true);
            }
        };
        document.addEventListener('click', closeHandler, true);
    }, 0);
}

function _syncBubbleRolePills(agentName) {
    const role = String(_agentRoles[agentName] || '').trim();
    const pillText = role || 'choose a role';
    document.querySelectorAll('.message').forEach(msg => {
        const senderEl = msg.querySelector('.msg-sender');
        const btn = msg.querySelector('.bubble-role');
        if (!btn || !senderEl || senderEl.textContent !== agentName) return;
        btn.textContent = pillText;
        btn.title = role || 'Set role';
        btn.classList.toggle('has-role', !!role);
    });
}

function _setRole(agentName, role) {
    fetch(`/api/roles/${agentName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': SESSION_TOKEN },
        body: JSON.stringify({ role }),
    });
    // Optimistic update
    _agentRoles[agentName] = role;
    _syncBubbleRolePills(agentName);
    // If custom role (not in presets), auto-save it
    if (role && !ROLE_PRESETS.some(p => p.label.toLowerCase() === role.toLowerCase())) {
        _addCustomRole(role);
    }
}

function _addCustomRole(role) {
    const list = window.customRoles || [];
    const lower = role.trim().toLowerCase();
    if (list.some(r => r.toLowerCase() === lower)) return;
    const updated = [...list, role.trim()].slice(-20);
    window.customRoles = updated;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'update_settings', data: { custom_roles: updated } }));
    }
}

function _deleteCustomRole(role) {
    const lower = role.trim().toLowerCase();
    const updated = (window.customRoles || []).filter(r => r.toLowerCase() !== lower);
    window.customRoles = updated;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'update_settings', data: { custom_roles: updated } }));
    }
    // Unassign from any agents currently using this role
    for (const [agentName, agentRole] of Object.entries(_agentRoles)) {
        if (agentRole && agentRole.toLowerCase() === lower) {
            _setRole(agentName, '');
        }
    }
}

// --- Status ---

const _agentRoles = {};  // name → role string
window.getAgentRole = function(agentName) {
    return _agentRoles[agentName] || '';
};

function fetchRoles() {
    fetch('/api/roles').then(r => r.json()).then(roles => {
        Object.assign(_agentRoles, roles);
        for (const name of Object.keys(roles || {})) {
            _syncBubbleRolePills(name);
        }
    }).catch(() => {});
}

const _ROLE_EMOJI = {
    'planner': '📋', 'builder': '🔨', 'reviewer': '🔍', 'researcher': '🔬',
    'chaos gremlin': '😈', 'red team': '🛡️', 'roast': '🔥', 'hype': '🎉',
};

function updateStatus(data) {
    for (const [name, info] of Object.entries(data)) {
        if (name === 'paused') continue;
        const pill = document.getElementById(`status-${name}`);
        if (!pill) continue;

        pill.classList.remove('available', 'working', 'offline');
        // Pending pills keep their pending animation (set in buildStatusPills)
        if (!pill.classList.contains('pending')) {
            if (info.busy && info.available) {
                pill.classList.add('working');
            } else if (info.available) {
                pill.classList.add('available');
            } else {
                pill.classList.add('offline');
            }
        }

        // Keep agent color in sync
        if (info.color) pill.style.setProperty('--agent-color', info.color);

        // Track role (displayed on bubbles, not on pill)
        if (info.role !== undefined) {
            _agentRoles[name] = info.role;
            _syncBubbleRolePills(name);
        }
    }
}

function updateTyping(agent, active) {
    const indicator = document.getElementById('typing-indicator');
    if (active) {
        indicator.querySelector('.typing-name').textContent = agent;
        indicator.classList.remove('hidden');
        if (autoScroll) scrollToBottom();
    } else {
        indicator.classList.add('hidden');
    }
}

// Settings UI and persistence live in settings.js.

function _clearClearChatConfirm() {
    const btn = document.getElementById('clear-chat-btn');
    const confirmEl = document.getElementById('clear-chat-confirm');
    if (confirmEl) confirmEl.remove();
    if (btn) {
        btn.textContent = 'Clear Chat';
        btn.classList.remove('confirming');
    }
    document.removeEventListener('click', _clearChatOutsideClick, true);
}

function _clearChatOutsideClick(e) {
    const btn = document.getElementById('clear-chat-btn');
    const confirmEl = document.getElementById('clear-chat-confirm');
    if (!btn || !confirmEl) return;
    if (!btn.contains(e.target) && !confirmEl.contains(e.target)) {
        _clearClearChatConfirm();
    }
}

function clearChat() {
    const btn = document.getElementById('clear-chat-btn');
    if (!btn) return;

    // Second click -> execute. First click -> inline confirm, matching the
    // End Session pattern elsewhere.
    if (btn.classList.contains('confirming')) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'message', text: '/clear', sender: username, channel: activeChannel }));
        }
        _clearClearChatConfirm();
        document.getElementById('settings-bar').classList.add('hidden');
        return;
    }

    btn.textContent = 'Clear Chat?';
    btn.classList.add('confirming');

    const confirmWrap = document.createElement('span');
    confirmWrap.id = 'clear-chat-confirm';
    confirmWrap.className = 'session-inline-confirm';
    confirmWrap.innerHTML = `
        <button class="session-inline-confirm-yes ch-confirm-yes" title="Confirm clear chat">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5 6.5-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="session-inline-confirm-no ch-confirm-no" title="Cancel">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
    `;
    btn.parentElement.insertBefore(confirmWrap, btn);

    confirmWrap.querySelector('.ch-confirm-yes').onclick = (e) => {
        e.stopPropagation();
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'message', text: '/clear', sender: username, channel: activeChannel }));
        }
        _clearClearChatConfirm();
        document.getElementById('settings-bar').classList.add('hidden');
    };
    confirmWrap.querySelector('.ch-confirm-no').onclick = (e) => {
        e.stopPropagation();
        _clearClearChatConfirm();
    };

    setTimeout(() => document.addEventListener('click', _clearChatOutsideClick, true), 0);
}

// --- Toast notifications ---

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast--visible'));
    setTimeout(() => {
        toast.classList.remove('toast--visible');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// --- Export / Import ---

async function exportHistory() {
    try {
        const resp = await fetch('/api/export', {
            headers: { 'X-Session-Token': SESSION_TOKEN },
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            showToast(err.error || 'Export failed', 'error');
            return;
        }
        const blob = await resp.blob();
        const disposition = resp.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="(.+?)"/);
        const filename = match ? match[1] : 'agentchattr-export.zip';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
        const counts = [];
        // Parse counts from manifest if possible, or just show success
        showToast('History exported', 'success');
    } catch (e) {
        showToast('Export failed: ' + e.message, 'error');
    }
}

async function importHistory(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = ''; // Reset so same file can be picked again
    const btn = document.getElementById('import-history-btn');
    const origText = btn.textContent;
    btn.textContent = 'Importing...';
    btn.disabled = true;
    try {
        const formData = new FormData();
        formData.append('file', file);
        const resp = await fetch('/api/import', {
            method: 'POST',
            headers: { 'X-Session-Token': SESSION_TOKEN },
            body: formData,
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
            showToast(data.error || 'Import failed', 'error');
            return;
        }
        // Build result message
        const parts = [];
        const s = data.sections || {};
        if (s.messages) parts.push(`${s.messages.created} messages`);
        if (s.jobs) parts.push(`${s.jobs.created} jobs`);
        if (s.rules) parts.push(`${s.rules.created} rules`);
        if (s.summaries) parts.push(`${s.summaries.created + (s.summaries.updated || 0)} summaries`);
        const dupes = (s.messages?.duplicates || 0) + (s.jobs?.duplicates || 0) + (s.rules?.duplicates || 0);
        let msg = 'Imported ' + parts.join(', ');
        if (dupes > 0) msg += ` (${dupes} duplicates skipped)`;
        if (data.warnings && data.warnings.length > 0) {
            msg += `. ${data.warnings.length} warning(s)`;
        }
        showToast(msg, 'success');
    } catch (e) {
        showToast('Import failed: ' + e.message, 'error');
    } finally {
        btn.textContent = origText;
        btn.disabled = false;
    }
}

// --- Keyboard shortcuts ---

function focusMessageInput() {
    const input = document.getElementById('input');
    if (!input) return;
    window.closeSearchNav?.();
    input.focus({ preventScroll: true });
    const pos = input.value.length;
    input.setSelectionRange(pos, pos);
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('image-modal');
        const modalOpen = modal && !modal.classList.contains('hidden');

        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === '.') {
            if (!modalOpen) {
                e.preventDefault();
                focusMessageInput();
            }
            return;
        }

        if (e.key === 'Escape') {
            const nameModal = document.getElementById('agent-name-modal');
            if (nameModal && !nameModal.classList.contains('hidden')) { _closeAgentNameModal(); return; }
            const convertModal = document.getElementById('convert-job-modal');
            if (convertModal && !convertModal.classList.contains('hidden')) { closeConvertJobModal(); return; }
            const deleteJobModal = document.getElementById('delete-job-modal');
            if (deleteJobModal && !deleteJobModal.classList.contains('hidden')) { closeDeleteJobModal(); return; }
            if (modalOpen) {
                const closeImageModal = getAttachmentsMethod('closeImageModal', 'image modal close');
                if (closeImageModal) closeImageModal();
                return;
            }
            if (replyingTo) { cancelReply(); }
        }
        if (modalOpen && e.key === 'ArrowLeft') {
            e.preventDefault();
            const modalPrev = getAttachmentsMethod('modalPrev', 'image modal previous');
            if (modalPrev) modalPrev(e);
        }
        if (modalOpen && e.key === 'ArrowRight') {
            e.preventDefault();
            const modalNext = getAttachmentsMethod('modalNext', 'image modal next');
            if (modalNext) modalNext(e);
        }

    });
}

// --- Slash command menu ---

function showSlashHint(text) {
    const input = document.getElementById('input');
    if (!input) return;
    const original = input.placeholder;
    input.placeholder = text;
    input.classList.add('slash-hint-active');
    setTimeout(() => {
        input.placeholder = original;
        input.classList.remove('slash-hint-active');
    }, 3000);
}
window.showSlashHint = showSlashHint;

const SLASH_COMMANDS = [
    { cmd: '/roastreview', desc: 'Get all agents to review and roast each other\'s work', broadcast: true },
    { cmd: '/summary', desc: 'Summarize recent messages — tag an agent (e.g. /summary @claude)', broadcast: false, needsMention: true },
    { cmd: '/summarise', desc: 'Summarize recent messages — tag an agent (e.g. /summarise @claude)', broadcast: false, needsMention: true, hidden: true },
    { cmd: '/continue', desc: 'Resume after loop guard pauses', broadcast: false },
    { cmd: '/clear', desc: 'Clear messages in current channel', broadcast: false },
];

let slashMenuIndex = 0;
let slashMenuVisible = false;
let mentionMenuIndex = 0;
let mentionMenuVisible = false;
let mentionMenuStart = -1;  // cursor position of the '@'

function updateSlashMenu(text) {
    const menu = document.getElementById('slash-menu');
    if (!text.startsWith('/') || text.includes(' ')) {
        menu.classList.add('hidden');
        slashMenuVisible = false;
        return;
    }

    const query = text.toLowerCase();
    const matches = SLASH_COMMANDS.filter(c => !c.hidden && c.cmd.startsWith(query));

    if (matches.length === 0 || (matches.length === 1 && matches[0].cmd === query)) {
        menu.classList.add('hidden');
        slashMenuVisible = false;
        return;
    }

    menu.innerHTML = '';
    slashMenuIndex = Math.min(slashMenuIndex, matches.length - 1);

    matches.forEach((item, i) => {
        const row = document.createElement('div');
        row.className = 'slash-item' + (i === slashMenuIndex ? ' active' : '');
        row.innerHTML = `<span class="slash-cmd">${escapeHtml(item.cmd)}</span><span class="slash-desc">${escapeHtml(item.desc)}</span>`;
        row.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectSlashCommand(item.cmd);
        });
        row.addEventListener('mouseenter', () => {
            slashMenuIndex = i;
            menu.querySelectorAll('.slash-item').forEach((el, j) => el.classList.toggle('active', j === i));
        });
        menu.appendChild(row);
    });

    menu.classList.remove('hidden');
    slashMenuVisible = true;
}

function selectSlashCommand(cmd) {
    const input = document.getElementById('input');
    input.value = cmd;
    input.focus();
    document.getElementById('slash-menu').classList.add('hidden');
    slashMenuVisible = false;
}

// --- Mention autocomplete ---

function getMentionCandidates() {
    // Build list: registered agents + @all broadcast.
    const candidates = [];
    for (const [name, cfg] of Object.entries(agentConfig)) {
        if (cfg.state === 'pending') continue;
        candidates.push({ name, label: cfg.label || name, color: cfg.color });
    }
    candidates.push({ name: 'all', label: 'all', color: 'var(--accent)' });
    return candidates;
}

function updateMentionMenu() {
    const menu = document.getElementById('mention-menu');
    const input = document.getElementById('input');
    const text = input.value;
    const cursor = input.selectionStart;

    // Don't show if slash menu is active
    if (slashMenuVisible) {
        menu.classList.add('hidden');
        mentionMenuVisible = false;
        return;
    }

    // Find the '@' before cursor that starts this mention
    let atPos = -1;
    for (let i = cursor - 1; i >= 0; i--) {
        if (text[i] === '@') { atPos = i; break; }
        if (!/[\w\-]/.test(text[i])) break;
        // Optimization: don't look back more than 30 chars
        if (cursor - i > 30) break;
    }

    if (atPos < 0 || (atPos > 0 && /\w/.test(text[atPos - 1]))) {
        // No @ found, or @ is mid-word (e.g. email)
        menu.classList.add('hidden');
        mentionMenuVisible = false;
        return;
    }

    const query = text.slice(atPos + 1, cursor).toLowerCase();
    mentionMenuStart = atPos;

    const candidates = getMentionCandidates();
    const matches = candidates.filter(c =>
        c.name.toLowerCase().includes(query) || c.label.toLowerCase().includes(query)
    );

    if (matches.length === 0) {
        menu.classList.add('hidden');
        mentionMenuVisible = false;
        return;
    }

    menu.innerHTML = '';
    mentionMenuIndex = Math.min(mentionMenuIndex, matches.length - 1);

    matches.forEach((item, i) => {
        const row = document.createElement('div');
        row.className = 'mention-item' + (i === mentionMenuIndex ? ' active' : '');
        row.dataset.name = item.name;
        row.innerHTML = `<span class="mention-dot" style="background: ${item.color}"></span><span class="mention-name">${escapeHtml(item.label)}</span>`;
        row.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectMention(item.name);
        });
        row.addEventListener('mouseenter', () => {
            mentionMenuIndex = i;
            menu.querySelectorAll('.mention-item').forEach((el, j) => el.classList.toggle('active', j === i));
        });
        menu.appendChild(row);
    });

    menu.classList.remove('hidden');
    mentionMenuVisible = true;
}

let _lastMentionedAgent = ''; // track most recent mention for auto-assignment

function selectMention(name) {
    const input = document.getElementById('input');
    _lastMentionedAgent = name; // remember for auto-assigning jobs
    const text = input.value;
    const cursor = input.selectionStart;
    // Replace from @ to cursor with @name + space
    const before = text.slice(0, mentionMenuStart);
    const after = text.slice(cursor);
    const mention = `@${name} `;
    input.value = before + mention + after;
    const newPos = mentionMenuStart + mention.length;
    input.setSelectionRange(newPos, newPos);
    input.focus();
    document.getElementById('mention-menu').classList.add('hidden');
    mentionMenuVisible = false;
}

// --- Input ---

function setupInput() {
    const input = document.getElementById('input');

    input.addEventListener('keydown', (e) => {
        if (mentionMenuVisible) {
            const menu = document.getElementById('mention-menu');
            const items = menu.querySelectorAll('.mention-item');
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                mentionMenuIndex = (mentionMenuIndex - 1 + items.length) % items.length;
                items.forEach((el, i) => el.classList.toggle('active', i === mentionMenuIndex));
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                mentionMenuIndex = (mentionMenuIndex + 1) % items.length;
                items.forEach((el, i) => el.classList.toggle('active', i === mentionMenuIndex));
                return;
            }
            if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                e.preventDefault();
                const active = items[mentionMenuIndex];
                if (active) {
                    selectMention(active.dataset.name);
                }
                return;
            }
            if (e.key === 'Escape') {
                menu.classList.add('hidden');
                mentionMenuVisible = false;
                return;
            }
        }
        if (slashMenuVisible) {
            const menu = document.getElementById('slash-menu');
            const items = menu.querySelectorAll('.slash-item');
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                slashMenuIndex = (slashMenuIndex - 1 + items.length) % items.length;
                items.forEach((el, i) => el.classList.toggle('active', i === slashMenuIndex));
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                slashMenuIndex = (slashMenuIndex + 1) % items.length;
                items.forEach((el, i) => el.classList.toggle('active', i === slashMenuIndex));
                return;
            }
            if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                e.preventDefault();
                const active = items[slashMenuIndex];
                if (active) selectSlashCommand(active.querySelector('.slash-cmd').textContent);
                if (e.key === 'Enter') sendMessage();
                return;
            }
            if (e.key === 'Escape') {
                menu.classList.add('hidden');
                slashMenuVisible = false;
                return;
            }
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Auto-resize + slash menu + mention menu + send button state
    function onInputChange() {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        updateSlashMenu(input.value);
        updateMentionMenu();
        updateSendButton();
    }
    input.addEventListener('input', onInputChange);
    // Voice typing doesn't always fire 'input' — catch with additional events
    input.addEventListener('compositionend', onInputChange);
    input.addEventListener('change', onInputChange);
    // Fallback poll for speech-to-text that bypasses all events
    let _lastInputVal = '';
    setInterval(() => {
        if (input.value !== _lastInputVal) {
            _lastInputVal = input.value;
            updateSendButton();
        }
    }, 300);
    updateSendButton();
}

function updateSendButton() {
    const input = document.getElementById('input');
    const group = document.querySelector('.send-group');
    if (!input || !group) return;
    const hasPendingAttachments = getAttachmentsMethod('hasPendingAttachments', 'send button state');
    const hasContent = input.value.trim().length > 0 || (hasPendingAttachments ? hasPendingAttachments() : false);
    group.classList.toggle('inactive', !hasContent);
}
window.updateSendButton = updateSendButton;

function sendMessage() {
    const input = document.getElementById('input');
    let text = input.value.trim();
    const getPendingAttachments = getAttachmentsMethod('getPendingAttachments', 'send message attachments');
    const attachments = getPendingAttachments ? getPendingAttachments() : [];

    if (!text && attachments.length === 0) return;

    // Prepend active mention toggles if the message doesn't already mention them
    // Skip for non-broadcast slash commands (e.g. /clear, /continue)
    let skipMentions = false;
    if (text.startsWith('/')) {
        const cmdWord = text.split(/\s/)[0].toLowerCase();
        const matchedCmd = SLASH_COMMANDS.find(c => c.cmd.startsWith(cmdWord) || cmdWord.startsWith(c.cmd.split(/\s/)[0]));
        if (matchedCmd && !matchedCmd.broadcast) {
            skipMentions = true;
        }
        // Commands that need an @mention — show hint and keep command in input
        if (matchedCmd && matchedCmd.needsMention && !/@\w[\w-]*/.test(text)) {
            const canonical = matchedCmd.cmd.split(/\s/)[0];  // e.g. '/summary'
            input.value = canonical + ' @';
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
            showSlashHint(`Tag an agent: ${canonical} @claude`);
            // Trigger mention autocomplete for the '@'
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }
    }
    if (activeMentions.size > 0 && text && !skipMentions) {
        const prefix = [...activeMentions].map(n => `@${n}`).join(' ');
        // Only prepend if user didn't already @mention these agents
        const lower = text.toLowerCase();
        const missing = [...activeMentions].filter(n => !lower.includes(`@${n}`));
        if (missing.length > 0) {
            text = missing.map(n => `@${n}`).join(' ') + ' ' + text;
        }
    }

    const payload = {
        type: 'message',
        text: text,
        sender: username,
        channel: activeChannel,
        attachments: attachments.map(a => ({
            path: a.path,
            name: a.name,
            url: a.url,
        })),
    };
    if (replyingTo) {
        payload.reply_to = replyingTo.id;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }

    input.value = '';
    input.style.height = 'auto';
    const clearAttachments = getAttachmentsMethod('clearAttachments', 'sent message cleanup');
    if (clearAttachments) clearAttachments();
    cancelReply();
    updateSendButton();
    input.focus();
}

// Composer image paste/drop, previews, and image modal live in attachments.js.

// --- Scroll tracking ---

function setupScroll() {
    const timeline = document.getElementById('timeline');
    const messages = document.getElementById('messages');

    timeline.addEventListener('scroll', () => {
        const distFromBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight;
        autoScroll = distFromBottom < 60;

        if (autoScroll) {
            unreadCount = 0;
        }
        updateScrollAnchor();
    });

    // Keep pinned to bottom when content changes (e.g. images load)
    const resizeObserver = new ResizeObserver(() => {
        if (autoScroll) {
            scrollToBottom();
        }
    });
    resizeObserver.observe(messages);

    // Reposition scroll-anchor when window resizes or sidebars toggle
    window.addEventListener('resize', repositionScrollAnchor);
    const contentArea = document.querySelector('.content-area');
    if (contentArea) {
        new ResizeObserver(repositionScrollAnchor).observe(contentArea);
    }

    // Support button label collapses via CSS overflow (grid column shrinks naturally).
    // No JS measurement needed.
}

// --- Reply ---

function copyMessage(msgId, event) {
    if (event) event.stopPropagation();
    const el = document.querySelector(`.message[data-id="${msgId}"]`);
    if (!el) return;
    const msgText = el.querySelector('.msg-text');
    const html = msgText?.innerHTML || '';
    const markdown = el.dataset.rawText || msgText?.innerText || '';
    const done = () => {
        const btn = el.querySelector('.bubble-copy');
        if (btn) {
            btn.classList.add('copied');
            setTimeout(() => btn.classList.remove('copied'), 1500);
        }
    };
    // Rich HTML + raw markdown — rich editors get HTML, code/markdown editors get source
    if (navigator.clipboard.write) {
        navigator.clipboard.write([new ClipboardItem({
            'text/html': new Blob([html], {type: 'text/html'}),
            'text/plain': new Blob([markdown], {type: 'text/plain'}),
        })]).then(done);
    } else {
        navigator.clipboard.writeText(markdown).then(done);
    }
}

function startReply(msgId, event) {
    if (event) event.stopPropagation();
    const el = document.querySelector(`.message[data-id="${msgId}"]`);
    if (!el) return;
    const sender = el.querySelector('.msg-sender')?.textContent?.trim() || '?';
    const text = el.dataset.rawText || el.querySelector('.msg-text')?.textContent || '';
    replyingTo = { id: msgId, sender, text };
    renderReplyPreview();

    // Auto-activate mention chip for the replied-to sender, deactivate others
    const resolved = resolveAgent(sender.toLowerCase());
    if (resolved) {
        for (const btn of document.querySelectorAll('.mention-toggle')) {
            const agent = btn.dataset.agent;
            if (agent === resolved) {
                activeMentions.add(agent);
                btn.classList.add('active');
            } else {
                activeMentions.delete(agent);
                btn.classList.remove('active');
            }
        }
    }

    document.getElementById('input').focus();
}

function renderReplyPreview() {
    let container = document.getElementById('reply-preview');
    if (!replyingTo) {
        if (container) container.remove();
        return;
    }
    if (!container) {
        container = document.createElement('div');
        container.id = 'reply-preview';
        const inputRow = document.getElementById('input-row');
        inputRow.parentNode.insertBefore(container, inputRow);
    }
    const truncated = replyingTo.text.length > 100 ? replyingTo.text.slice(0, 100) + '...' : replyingTo.text;
    const color = getColor(replyingTo.sender);
    container.innerHTML = `<span class="reply-preview-label">replying to</span><span class="reply-preview-id">#${escapeHtml(replyingTo.id)}</span> <span style="color: ${color}; font-weight: 600">${escapeHtml(replyingTo.sender)}</span>: ${escapeHtml(truncated)} <button class="dismiss-btn reply-cancel" onclick="cancelReply()">&times;</button>`;
}

function cancelReply() {
    replyingTo = null;
    const el = document.getElementById('reply-preview');
    if (el) el.remove();
}

function scrollToMessage(msgId) {
    const el = document.querySelector(`.message[data-id="${msgId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('highlight');
    setTimeout(() => el.classList.remove('highlight'), 1500);
}
window.scrollToMessage = scrollToMessage;

// Pin/todo actions and panel rendering live in pins-todos.js.

// --- Delete mode ---

let deleteMode = false;
let deleteSelected = new Set();
let deleteDragging = false;

function deleteClick(msgId, event) {
    event.stopPropagation();
    enterDeleteMode(Number(msgId));
}

function enterDeleteMode(initialId) {
    if (deleteMode) return;
    deleteMode = true;
    deleteSelected.clear();
    if (initialId != null) deleteSelected.add(initialId);

    // Add delete-mode class — children transform right (no layout reflow)
    document.getElementById('messages').classList.add('delete-mode');

    // Add radio circles to all messages (not joins)
    document.querySelectorAll('.message[data-id]').forEach(el => {
        if (el.classList.contains('join-msg') || el.classList.contains('summary-msg')) return;
        // system-msg is excluded UNLESS it's a deletable subtype (banners, breadcrumbs, drafts)
        if (el.classList.contains('system-msg')
            && !el.classList.contains('session-banner')
            && !el.classList.contains('session-draft-card')
            && !el.classList.contains('job-breadcrumb')) return;
        const id = parseInt(el.dataset.id);
        const circle = document.createElement('div');
        circle.className = 'delete-radio' + (deleteSelected.has(id) ? ' selected' : '');
        circle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            toggleDeleteSelect(id);
            deleteDragging = true;
        });
        circle.addEventListener('mouseenter', () => {
            if (deleteDragging) toggleDeleteSelect(id, true);
        });
        el.prepend(circle);
    });

    // Add radio circles to collapsed job-groups (selects all children)
    document.querySelectorAll('.job-group').forEach(group => {
        const ids = [...group.querySelectorAll('.job-breadcrumb[data-id]')].map(el => parseInt(el.dataset.id));
        if (ids.length === 0) return;
        const circle = document.createElement('div');
        circle.className = 'delete-radio';
        circle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const allSelected = ids.every(id => deleteSelected.has(id));
            ids.forEach(id => {
                if (allSelected) deleteSelected.delete(id); else deleteSelected.add(id);
                const child = group.querySelector(`.job-breadcrumb[data-id="${id}"] .delete-radio`);
                if (child) child.classList.toggle('selected', !allSelected);
            });
            circle.classList.toggle('selected', !allSelected);
            updateDeleteBar();
            deleteDragging = true;
        });
        circle.addEventListener('mouseenter', () => {
            if (deleteDragging) {
                ids.forEach(id => deleteSelected.add(id));
                circle.classList.add('selected');
                updateDeleteBar();
            }
        });
        group.prepend(circle);
    });

    // Show floating delete bar
    showDeleteBar();
    updateDeleteBar();
    repositionScrollAnchor();
}

function toggleDeleteSelect(id, dragForceSelect) {
    const el = document.querySelector(`.message[data-id="${id}"]`);
    if (!el) return;
    const circle = el.querySelector('.delete-radio');

    if (dragForceSelect) {
        deleteSelected.add(id);
        if (circle) circle.classList.add('selected');
    } else {
        if (deleteSelected.has(id)) {
            deleteSelected.delete(id);
            if (circle) circle.classList.remove('selected');
        } else {
            deleteSelected.add(id);
            if (circle) circle.classList.add('selected');
        }
    }
    updateDeleteBar();
}

function showDeleteBar() {
    let bar = document.getElementById('delete-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'delete-bar';
        bar.innerHTML = `<button class="delete-bar-cancel" onclick="exitDeleteMode()">Cancel</button><span class="delete-bar-count"></span><button class="delete-bar-confirm" onclick="confirmDelete()">Delete</button>`;
        const footer = document.querySelector('footer');
        footer.parentNode.insertBefore(bar, footer);
    }
    bar.classList.remove('hidden');
}

function updateDeleteBar() {
    const count = deleteSelected.size;
    const span = document.querySelector('.delete-bar-count');
    if (span) span.textContent = count > 0 ? `${count} selected` : 'Select messages';
    const btn = document.querySelector('.delete-bar-confirm');
    if (btn) {
        btn.textContent = count > 0 ? `Delete (${count})` : 'Delete';
        btn.disabled = count === 0;
    }
}

function confirmDelete() {
    if (!ws || deleteSelected.size === 0) return;
    ws.send(JSON.stringify({ type: 'delete', ids: [...deleteSelected] }));
    exitDeleteMode();
}

function exitDeleteMode() {
    deleteMode = false;
    deleteSelected.clear();
    deleteDragging = false;

    // Remove delete-mode — children transform back (no layout reflow)
    document.getElementById('messages').classList.remove('delete-mode');

    // Collapse bar
    const bar = document.getElementById('delete-bar');
    if (bar) {
        bar.classList.add('hidden');
    }

    // Fade out radios then remove
    document.querySelectorAll('.delete-radio').forEach(el => {
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.2s';
        setTimeout(() => el.remove(), 200);
    });

    repositionScrollAnchor();
}

// Auto-scroll while dragging near edges
let deleteScrollInterval = null;
document.addEventListener('mousemove', (e) => {
    if (!deleteDragging) return;
    const timeline = document.getElementById('timeline');
    const rect = timeline.getBoundingClientRect();
    const edgeZone = 60;

    if (e.clientY < rect.top + edgeZone) {
        // Near top — scroll up
        if (!deleteScrollInterval) {
            deleteScrollInterval = setInterval(() => timeline.scrollTop -= 8, 16);
        }
    } else if (e.clientY > rect.bottom - edgeZone) {
        // Near bottom — scroll down
        if (!deleteScrollInterval) {
            deleteScrollInterval = setInterval(() => timeline.scrollTop += 8, 16);
        }
    } else if (deleteScrollInterval) {
        clearInterval(deleteScrollInterval);
        deleteScrollInterval = null;
    }
});

// Stop drag on mouseup
document.addEventListener('mouseup', () => {
    deleteDragging = false;
    if (deleteScrollInterval) {
        clearInterval(deleteScrollInterval);
        deleteScrollInterval = null;
    }
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && deleteMode) exitDeleteMode();
});

function handleDeleteBroadcast(ids) {
    for (const id of ids) {
        const el = document.querySelector(`.message[data-id="${id}"]`);
        if (el) el.remove();
        // Clean from todos
        delete todos[id];
    }
    // Refresh todos panel if open
    const panel = document.getElementById('pins-panel');
    if (panel && !panel.classList.contains('hidden')) renderTodosPanel();
}

// togglePinsPanel() and renderTodosPanel() are provided by pins-todos.js.

// --- Mention toggles ---

function buildMentionToggles() {
    const container = document.getElementById('mention-toggles');
    container.innerHTML = '';

    // Prune stale mentions for agents no longer in config
    for (const name of activeMentions) {
        if (!(name in agentConfig)) activeMentions.delete(name);
    }

    for (const [name, cfg] of Object.entries(agentConfig)) {
        if (cfg.state === 'pending') continue;  // skip pending instances
        const btn = document.createElement('button');
        btn.className = 'mention-toggle';
        btn.dataset.agent = name;
        btn.textContent = `@${cfg.label || name}`;
        btn.title = `@${name}`;  // Tooltip: canonical name
        btn.style.setProperty('--agent-color', colorOverrides[name] || cfg.color);
        // Restore active state for mentions that survived the rebuild
        if (activeMentions.has(name)) {
            btn.classList.add('active');
        }
        btn.onclick = () => {
            if (activeMentions.has(name)) {
                activeMentions.delete(name);
                btn.classList.remove('active');
            } else {
                activeMentions.add(name);
                btn.classList.add('active');
            }
            if (typeof window.updateSchedulePopoverState === 'function') {
                window.updateSchedulePopoverState();
            } else {
                reportSchedulesModuleUnavailable('mention toggle update');
            }
        };
        container.appendChild(btn);
    }
    enableDragScroll(container);
}

// --- Voice typing ---

let recognition = null;
let isListening = false;

function focusComposerInput() {
    const input = document.getElementById('input');
    if (!input) return null;
    try {
        input.focus({ preventScroll: true });
    } catch (_) {
        input.focus();
    }
    return input;
}

function toggleVoice() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        alert('Speech recognition not supported — use Chrome or Edge.');
        return;
    }

    if (isListening) {
        stopVoice();
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'en-GB';
    recognition.continuous = true;
    recognition.interimResults = true;

    const input = focusComposerInput();
    if (!input) return;
    const baseText = input.value;
    let finalTranscript = '';
    const micButton = document.getElementById('mic');

    recognition.onstart = () => {
        isListening = true;
        micButton.classList.add('recording');
        micButton.setAttribute('aria-pressed', 'true');
        focusComposerInput();
    };

    recognition.onresult = (e) => {
        let interim = '';
        finalTranscript = '';
        for (let i = 0; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) {
                finalTranscript += t;
            } else {
                interim += t;
            }
        }
        input.value = baseText + (baseText ? ' ' : '') + finalTranscript + interim;
        focusComposerInput();
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    };

    recognition.onerror = (e) => {
        console.error('Speech error:', e.error);
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
            alert('Microphone access was blocked. Allow microphone access in Chrome and try again.');
            stopVoice();
        } else if (e.error === 'no-speech' || e.error === 'aborted') {
            // no-speech: Chrome fires after ~5s silence — keep listening
            // aborted: fires during restart cycle — safe to ignore
            console.log('Speech:', e.error, '— still listening...');
        } else {
            stopVoice();
        }
    };

    recognition.onend = () => {
        // If still supposed to be listening (e.g. after no-speech), restart
        if (isListening) {
            try { recognition.start(); } catch (_) { stopVoice(); }
        } else {
            stopVoice();
        }
    };

    try {
        recognition.start();
    } catch (e) {
        console.error('Speech start failed:', e);
        stopVoice();
    }
}

function stopVoice() {
    isListening = false;
    const micButton = document.getElementById('mic');
    if (micButton) {
        micButton.classList.remove('recording');
        micButton.setAttribute('aria-pressed', 'false');
    }
    if (recognition) {
        try { recognition.stop(); } catch (_) {}
        recognition = null;
    }
    focusComposerInput();
}

// Shared image modal helpers are provided by attachments.js.

async function _preserveScroll(fn) {
    const timeline = document.getElementById('timeline');
    if (!timeline) { await fn(); return; }

    // Check if we are at the bottom (with a small buffer)
    const wasAtBottom = autoScroll || (timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 60);
    const topId = _getTopVisibleMsgId();

    // Save the exact pixel offset of the top visible message
    let savedOffset = 0;
    if (topId) {
        const el = document.querySelector(`.message[data-id="${topId}"]`);
        if (el) {
            savedOffset = el.getBoundingClientRect().top - timeline.getBoundingClientRect().top;
        }
    }

    // Disable smooth scrolling for instant correction
    const oldSmooth = timeline.style.scrollBehavior;
    timeline.style.scrollBehavior = 'auto';

    await fn();

    // Continuously correct scroll during sidebar CSS transition
    function correctScroll() {
        if (wasAtBottom) {
            timeline.scrollTop = timeline.scrollHeight;
        } else if (topId) {
            const el = document.querySelector(`.message[data-id="${topId}"]`);
            if (el) {
                const newRect = el.getBoundingClientRect();
                const timelineRect = timeline.getBoundingClientRect();
                timeline.scrollTop += (newRect.top - timelineRect.top) - savedOffset;
            }
        }
    }

    // Correct immediately
    void timeline.scrollHeight;
    correctScroll();

    // Keep correcting each frame during the transition (~300ms)
    let frames = 0;
    function tick() {
        correctScroll();
        if (++frames < 20) requestAnimationFrame(tick); // ~333ms at 60fps
        else timeline.style.scrollBehavior = oldSmooth;
    }
    requestAnimationFrame(tick);
}
window._preserveScroll = _preserveScroll;

// Style #hashtags in rendered message text
function styleHashtags(html) {
    // "Match and skip" pattern: consume HTML tags first (to skip hex colors in
    // style attributes like color: #da7756), then match real hashtags in text.
    return html.replace(/<[^>]*>|((?:^|\s))(#([a-zA-Z][a-zA-Z0-9_-]{0,39}))\b/g,
        (match, prefix, fullHash, tag) => {
            if (tag === undefined) return match; // HTML tag — skip
            const lower = tag.toLowerCase();
            if (['clear', 'off', 'none', 'end'].includes(lower)) {
                return `${prefix}<span class="msg-hashtag" style="opacity:0.5">#${tag}</span>`;
            }
            return `${prefix}<span class="msg-hashtag">#${tag}</span>`;
        });
}
window.styleHashtags = styleHashtags;

// --- Helpers ---


function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
window.escapeHtml = escapeHtml;

function escapeAttr(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[ch]));
}
window.escapeAttr = escapeAttr;

// Schedule strip and popover are provided by schedules.js.

// --- Decision card resolve (with fade animation) ---
async function resolveDecision(msgId, choice) {
    // Fade out buttons immediately
    const msgEl = document.querySelector(`.message[data-id="${msgId}"]`);
    const buttons = msgEl ? msgEl.querySelectorAll('.decision-choice') : [];
    buttons.forEach(btn => { btn.style.opacity = '0.4'; btn.style.pointerEvents = 'none'; });
    try {
        const res = await fetch(`/api/messages/${msgId}/resolve_decision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Session-Token': SESSION_TOKEN },
            body: JSON.stringify({ choice }),
        });
        if (!res.ok) {
            const err = await res.json();
            console.error('Failed to resolve decision:', err);
            // Restore buttons on failure
            buttons.forEach(btn => { btn.style.opacity = ''; btn.style.pointerEvents = ''; });
        }
    } catch (e) {
        console.error('Decision resolve error:', e);
        buttons.forEach(btn => { btn.style.opacity = ''; btn.style.pointerEvents = ''; });
    }
}
window.resolveDecision = resolveDecision;

// Help tour is provided by help-tour.js.

// --- Start ---

document.addEventListener('DOMContentLoaded', function() {
    init();
    installHelpTourFallbacks();
    const initHelpTour = getHelpTourMethod('initHelpTour', 'first-run help tour');
    if (initHelpTour) initHelpTour();
});
