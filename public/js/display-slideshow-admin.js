// DJ UI — manage ordered display background slideshow images per event.
(function (global) {
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    function DisplaySlideshowAdmin(options) {
        this.eventId = options.eventId;
        this.listEl = options.listEl;
        this.uploadBtn = options.uploadBtn;
        this.fileInput = options.fileInput;
        this.statusEl = options.statusEl;
        this.slides = [];
        this._bind();
    }

    DisplaySlideshowAdmin.prototype.setEventId = function (eventId) {
        this.eventId = eventId;
    };

    DisplaySlideshowAdmin.prototype.setStatus = function (text, kind) {
        if (!this.statusEl) return;
        this.statusEl.textContent = text || '';
        this.statusEl.className = 'small ' + (kind === 'error' ? 'text-danger' : kind === 'success' ? 'text-success' : 'text-muted');
    };

    DisplaySlideshowAdmin.prototype.load = async function () {
        if (!this.eventId || !this.listEl) return;
        this.listEl.innerHTML = '<li class="text-muted small">Loading slideshow images…</li>';
        try {
            const res = await fetch(`/api/events/${this.eventId}/display-slideshow`);
            if (!res.ok) throw new Error('Could not load slideshow');
            this.slides = await res.json();
            this.render();
        } catch (err) {
            this.listEl.innerHTML = '<li class="text-danger small">Failed to load slideshow images.</li>';
            this.setStatus(err.message || 'Load failed', 'error');
        }
    };

    DisplaySlideshowAdmin.prototype.render = function () {
        if (!this.listEl) return;
        if (!this.slides.length) {
            this.listEl.innerHTML = '<li class="text-muted small slideshow-empty">No slideshow images yet — upload one below.</li>';
            return;
        }

        this.listEl.innerHTML = this.slides.map((slide, index) => `
            <li class="slideshow-item" data-slide-id="${slide.id}" draggable="true">
                <span class="slideshow-drag" title="Drag to reorder" aria-hidden="true"><i class="fas fa-grip-vertical"></i></span>
                <img src="${escapeHtml(slide.imageUrl)}" alt="Slide ${index + 1}">
                <span class="slideshow-order small text-muted">#${index + 1}</span>
                <div class="slideshow-actions ms-auto">
                    <button type="button" class="btn btn-sm btn-outline-secondary slideshow-up" data-slide-id="${slide.id}" ${index === 0 ? 'disabled' : ''} title="Move up">
                        <i class="fas fa-arrow-up"></i>
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-secondary slideshow-down" data-slide-id="${slide.id}" ${index === this.slides.length - 1 ? 'disabled' : ''} title="Move down">
                        <i class="fas fa-arrow-down"></i>
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-danger slideshow-delete" data-slide-id="${slide.id}" title="Remove">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </li>
        `).join('');
    };

    DisplaySlideshowAdmin.prototype._bind = function () {
        if (this.uploadBtn && this.fileInput) {
            this.uploadBtn.addEventListener('click', () => {
                if (!this.eventId) return;
                this.fileInput.click();
            });
            this.fileInput.addEventListener('change', () => this._uploadSelected());
        }

        if (this.listEl) {
            this.listEl.addEventListener('click', (e) => {
                const up = e.target.closest('.slideshow-up');
                const down = e.target.closest('.slideshow-down');
                const del = e.target.closest('.slideshow-delete');
                if (up) this.moveSlide(parseInt(up.dataset.slideId, 10), -1);
                if (down) this.moveSlide(parseInt(down.dataset.slideId, 10), 1);
                if (del) this.deleteSlide(parseInt(del.dataset.slideId, 10));
            });

            let dragId = null;
            this.listEl.addEventListener('dragstart', (e) => {
                const item = e.target.closest('.slideshow-item');
                if (!item) return;
                dragId = parseInt(item.dataset.slideId, 10);
                item.classList.add('slideshow-item--dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            this.listEl.addEventListener('dragend', (e) => {
                const item = e.target.closest('.slideshow-item');
                if (item) item.classList.remove('slideshow-item--dragging');
                dragId = null;
            });
            this.listEl.addEventListener('dragover', (e) => {
                e.preventDefault();
                const item = e.target.closest('.slideshow-item');
                if (item) e.dataTransfer.dropEffect = 'move';
            });
            this.listEl.addEventListener('drop', (e) => {
                e.preventDefault();
                const target = e.target.closest('.slideshow-item');
                if (!target || dragId == null) return;
                const targetId = parseInt(target.dataset.slideId, 10);
                if (dragId === targetId) return;
                const ids = this.slides.map((s) => s.id);
                const from = ids.indexOf(dragId);
                const to = ids.indexOf(targetId);
                if (from < 0 || to < 0) return;
                ids.splice(from, 1);
                ids.splice(to, 0, dragId);
                this.saveOrder(ids);
            });
        }
    };

    DisplaySlideshowAdmin.prototype._uploadSelected = async function () {
        const file = this.fileInput.files && this.fileInput.files[0];
        this.fileInput.value = '';
        if (!file || !this.eventId) return;

        const icon = this.uploadBtn.querySelector('i');
        if (icon) {
            icon.classList.replace('fa-upload', 'fa-spinner');
            icon.classList.add('fa-spin');
        }
        this.setStatus('Uploading…');
        try {
            const formData = new FormData();
            formData.append('image', file);
            const res = await fetch(`/api/events/${this.eventId}/display-slideshow`, {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Upload failed');
            this.slides = data.slides || [];
            this.render();
            this.setStatus('Image added to slideshow', 'success');
        } catch (err) {
            this.setStatus(err.message || 'Upload failed', 'error');
        } finally {
            if (icon) {
                icon.classList.remove('fa-spin');
                icon.classList.replace('fa-spinner', 'fa-upload');
            }
        }
    };

    DisplaySlideshowAdmin.prototype.moveSlide = function (slideId, direction) {
        const ids = this.slides.map((s) => s.id);
        const index = ids.indexOf(slideId);
        if (index < 0) return;
        const next = index + direction;
        if (next < 0 || next >= ids.length) return;
        ids.splice(index, 1);
        ids.splice(next, 0, slideId);
        this.saveOrder(ids);
    };

    DisplaySlideshowAdmin.prototype.saveOrder = async function (orderedIds) {
        if (!this.eventId) return;
        this.setStatus('Saving order…');
        try {
            const res = await fetch(`/api/events/${this.eventId}/display-slideshow/reorder`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order: orderedIds })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Reorder failed');
            this.slides = data.slides || [];
            this.render();
            this.setStatus('Order saved', 'success');
        } catch (err) {
            this.setStatus(err.message || 'Reorder failed', 'error');
        }
    };

    DisplaySlideshowAdmin.prototype.deleteSlide = async function (slideId) {
        if (!this.eventId) return;
        if (!confirm('Remove this image from the slideshow?')) return;
        this.setStatus('Removing…');
        try {
            const res = await fetch(`/api/events/${this.eventId}/display-slideshow/${slideId}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Delete failed');
            this.slides = data.slides || [];
            this.render();
            this.setStatus('Image removed', 'success');
        } catch (err) {
            this.setStatus(err.message || 'Delete failed', 'error');
        }
    };

    global.DisplaySlideshowAdmin = DisplaySlideshowAdmin;
})(window);
