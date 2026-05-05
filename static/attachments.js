// attachments.js -- composer image uploads, previews, and shared image modal
// Extracted from chat.js. Shared chat state is reached through window.* bridges.

(function() {
    'use strict';

    let pendingAttachments = [];
    let modalImages = [];
    let modalIndex = 0;
    const missingBridges = new Set();

    function reportMissingBridge(name) {
        if (missingBridges.has(name)) return;
        missingBridges.add(name);
        console.error(`Attachments: ${name} bridge not registered`);
    }

    function getSessionToken() {
        const token = window.__SESSION_TOKEN__ || window.SESSION_TOKEN || '';
        if (!token) reportMissingBridge('window.__SESSION_TOKEN__');
        return token;
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

    function repositionScrollAnchor() {
        if (typeof window.repositionScrollAnchor === 'function') {
            window.repositionScrollAnchor();
        } else {
            reportMissingBridge('window.repositionScrollAnchor');
        }
    }

    function refreshSendButton() {
        if (typeof window.updateSendButton === 'function') {
            window.updateSendButton();
        } else {
            reportMissingBridge('window.updateSendButton');
        }
    }

    function getPendingAttachments() {
        return pendingAttachments.slice();
    }

    function hasPendingAttachments() {
        return pendingAttachments.length > 0;
    }

    function setPendingAttachments(items) {
        if (!Array.isArray(items)) {
            console.error('Attachments: setPendingAttachments received non-array payload', items);
            pendingAttachments = [];
        } else {
            pendingAttachments = items.slice();
        }
        renderAttachments();
        refreshSendButton();
    }

    function setupPaste() {
        document.addEventListener('paste', async (e) => {
            const items = e.clipboardData?.items;
            if (!items) return;

            // Route to job upload if job input is focused
            const jobInput = document.getElementById('jobs-conv-input-text');
            const isJobFocused = jobInput && document.activeElement === jobInput;

            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    const file = item.getAsFile();
                    if (!file) continue;
                    if (isJobFocused) {
                        if (typeof window.uploadJobImage === 'function') {
                            await window.uploadJobImage(file);
                        } else {
                            reportMissingBridge('window.uploadJobImage');
                        }
                    } else {
                        await uploadImage(file);
                    }
                }
            }
        });
    }

    function setupDragDrop() {
        const dropzone = document.getElementById('dropzone');
        let dragCount = 0;
        if (!dropzone) console.error('Attachments: #dropzone element not found');

        document.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCount++;
            if (dropzone && e.dataTransfer?.types?.includes('Files')) {
                dropzone.classList.remove('hidden');
            }
        });

        document.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCount--;
            if (dragCount <= 0) {
                dragCount = 0;
                if (dropzone) dropzone.classList.add('hidden');
            }
        });

        document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        document.addEventListener('drop', async (e) => {
            e.preventDefault();
            dragCount = 0;
            if (dropzone) dropzone.classList.add('hidden');

            const files = e.dataTransfer?.files;
            if (!files) return;

            for (const file of files) {
                if (file.type.startsWith('image/')) {
                    await uploadImage(file);
                }
            }
        });
    }

    async function uploadImage(file) {
        const form = new FormData();
        form.append('file', file);

        try {
            const resp = await fetch('/api/upload', {
                method: 'POST',
                headers: { 'X-Session-Token': getSessionToken() },
                body: form,
            });
            const data = await resp.json();

            pendingAttachments.push({
                path: data.path,
                name: data.name,
                url: data.url,
            });

            renderAttachments();
            refreshSendButton();
        } catch (err) {
            console.error('Upload failed:', err);
        }
    }

    function renderAttachments() {
        const container = document.getElementById('attachments');
        if (!container) {
            console.error('Attachments: #attachments element not found');
            return;
        }
        container.innerHTML = '';

        pendingAttachments.forEach((att, i) => {
            const wrap = document.createElement('div');
            wrap.className = 'attachment-preview';
            wrap.innerHTML = `
                <img src="${htmlAttr(att.url)}" alt="${htmlAttr(att.name)}" data-image-modal-url="${htmlAttr(att.url)}" title="Click to preview">
                <button class="remove-btn" onclick="removeAttachment(${i})">x</button>
            `;
            container.appendChild(wrap);
        });
        repositionScrollAnchor();
    }

    function removeAttachment(index) {
        pendingAttachments.splice(index, 1);
        renderAttachments();
        refreshSendButton();
    }

    function clearAttachments() {
        pendingAttachments = [];
        const container = document.getElementById('attachments');
        if (container) {
            container.innerHTML = '';
        } else {
            console.error('Attachments: #attachments element not found');
        }
        repositionScrollAnchor();
        refreshSendButton();
    }

    function getAllChatImages() {
        const imgs = document.querySelectorAll('.msg-attachments img, .job-msg-attachments img');
        return [...imgs].map(img => img.dataset.imageModalUrl || img.getAttribute('src') || img.src).filter(Boolean);
    }

    function handleImageModalClick(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const img = target.closest('img[data-image-modal-url]');
        if (!img) return;
        const url = img.dataset.imageModalUrl;
        if (!url) {
            console.error('Attachments: image modal URL missing', img);
            return;
        }
        openImageModal(url);
    }

    function openImageModal(url) {
        modalImages = getAllChatImages();
        // Match by endsWith for older callers that pass relative URLs while img.src is absolute.
        modalIndex = modalImages.findIndex(src => src.endsWith(url) || src === url);
        if (modalIndex === -1) {
            // Image not in chat gallery (e.g. composer preview); show it standalone.
            modalImages = [url];
            modalIndex = 0;
        }

        let modal = document.getElementById('image-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'image-modal';
            modal.className = 'hidden';
            modal.innerHTML = `<button class="modal-nav modal-prev" onclick="modalPrev(event)">&lsaquo;</button><img onclick="event.stopPropagation()"><button class="modal-nav modal-next" onclick="modalNext(event)">&rsaquo;</button><span class="modal-counter"></span>`;
            modal.addEventListener('click', closeImageModal);
            document.body.appendChild(modal);
        }
        updateModalImage(modal);
        modal.classList.remove('hidden');
    }

    function updateModalImage(modal) {
        if (!modal) modal = document.getElementById('image-modal');
        if (!modal || modalImages.length === 0) return;
        modal.querySelector('img').src = modalImages[modalIndex];
        const counter = modal.querySelector('.modal-counter');
        if (counter) {
            counter.textContent = `${modalIndex + 1} / ${modalImages.length}`;
        }
        // Hide arrows at beginning/end, or if only one image
        const prev = modal.querySelector('.modal-prev');
        const next = modal.querySelector('.modal-next');
        if (prev) prev.style.display = modalIndex > 0 ? 'flex' : 'none';
        if (next) next.style.display = modalIndex < modalImages.length - 1 ? 'flex' : 'none';
    }

    function modalPrev(event) {
        event.stopPropagation();
        if (modalIndex <= 0) return;
        modalIndex--;
        updateModalImage();
    }

    function modalNext(event) {
        event.stopPropagation();
        if (modalIndex >= modalImages.length - 1) return;
        modalIndex++;
        updateModalImage();
    }

    function closeImageModal() {
        const modal = document.getElementById('image-modal');
        if (modal) modal.classList.add('hidden');
    }

    window.Attachments = {
        clearAttachments,
        closeImageModal,
        getAllChatImages,
        getPendingAttachments,
        hasPendingAttachments,
        modalNext,
        modalPrev,
        openImageModal,
        removeAttachment,
        renderAttachments,
        setPendingAttachments,
        setupDragDrop,
        setupPaste,
        updateModalImage,
        uploadImage,
    };

    Object.defineProperty(window, 'pendingAttachments', {
        get() { return pendingAttachments; },
        set(value) { setPendingAttachments(value); },
    });

    window.clearAttachments = clearAttachments;
    window.closeImageModal = closeImageModal;
    window.getAllChatImages = getAllChatImages;
    window.getPendingAttachments = getPendingAttachments;
    window.hasPendingAttachments = hasPendingAttachments;
    window.modalNext = modalNext;
    window.modalPrev = modalPrev;
    window.openImageModal = openImageModal;
    window.removeAttachment = removeAttachment;
    window.renderAttachments = renderAttachments;
    window.setupDragDrop = setupDragDrop;
    window.setupPaste = setupPaste;
    window.updateModalImage = updateModalImage;
    window.uploadImage = uploadImage;

    document.addEventListener('click', handleImageModalClick);
})();
