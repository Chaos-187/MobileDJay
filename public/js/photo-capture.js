// MobileDJay — guest gallery upload page ("Upload from Gallery").

document.addEventListener('DOMContentLoaded', function () {
    const photoInput = document.getElementById('photoInput');
    const dropZone = document.getElementById('dropZone');
    const previewWrap = document.getElementById('previewWrap');
    const previewImg = document.getElementById('previewImg');
    const retakeBtn = document.getElementById('retakeBtn');
    const captionInput = document.getElementById('captionInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadStatus = document.getElementById('uploadStatus');
    const recentGrid = document.getElementById('recentGrid');

    const eventSlug = window.eventSlug;
    const customerName =
        window.customerName ||
        (window.MdjGuestSession
            ? window.MdjGuestSession.getGuestName(window.eventSlug)
            : sessionStorage.getItem('customerName')) ||
        '';

    /** Compressed image blob ready for upload. */
    let pendingBlob = null;

    // ── Picking a photo ──────────────────────────────────────────────
    dropZone.addEventListener('click', () => photoInput.click());
    dropZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            photoInput.click();
        }
    });

    ['dragover', 'dragenter'].forEach((evt) =>
        dropZone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        })
    );
    ['dragleave', 'drop'].forEach((evt) =>
        dropZone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
        })
    );
    dropZone.addEventListener('drop', (e) => {
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) handleFile(file);
    });

    photoInput.addEventListener('change', () => {
        const file = photoInput.files && photoInput.files[0];
        if (file) handleFile(file);
    });

    retakeBtn.addEventListener('click', () => {
        pendingBlob = null;
        photoInput.value = '';
        previewWrap.style.display = 'none';
        dropZone.style.display = '';
        uploadBtn.disabled = true;
        setStatus('');
    });

    async function handleFile(file) {
        if (!file.type.startsWith('image/')) {
            setStatus('Please choose an image file.', 'error');
            return;
        }
        setStatus('Preparing photo…');
        try {
            pendingBlob = await compressImage(file);
            previewImg.src = URL.createObjectURL(pendingBlob);
        } catch (err) {
            console.error('Compression failed, using original file:', err);
            pendingBlob = file;
            previewImg.src = URL.createObjectURL(file);
        }
        previewWrap.style.display = '';
        dropZone.style.display = 'none';
        uploadBtn.disabled = false;
        setStatus('');
    }

    // Downscale to max 2000px on the long edge and encode as JPEG (quality 0.85).
    // GIFs are passed through untouched to preserve animation.
    function compressImage(file) {
        if (file.type === 'image/gif') return Promise.resolve(file);
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                URL.revokeObjectURL(url);
                const MAX = 2000;
                let { width, height } = img;
                if (width > MAX || height > MAX) {
                    const scale = MAX / Math.max(width, height);
                    width = Math.round(width * scale);
                    height = Math.round(height * scale);
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                canvas.toBlob(
                    (blob) => (blob ? resolve(blob) : reject(new Error('Canvas encode failed'))),
                    'image/jpeg',
                    0.85
                );
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Could not read image'));
            };
            img.src = url;
        });
    }

    // ── Upload ───────────────────────────────────────────────────────
    uploadBtn.addEventListener('click', async () => {
        if (!pendingBlob) return;

        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Uploading…';
        setStatus('');

        const formData = new FormData();
        const filename = pendingBlob.type === 'image/gif' ? 'photo.gif' : 'photo.jpg';
        formData.append('photo', pendingBlob, filename);
        formData.append('customerName', customerName);
        formData.append('caption', captionInput.value.trim());

        try {
            const res = await fetch(`/api/event/${encodeURIComponent(eventSlug)}/photos`, {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Upload failed');
            }
            setStatus('Photo added to the event album! 🎉', 'success');
            captionInput.value = '';
            retakeBtn.click();
            loadRecent();
        } catch (err) {
            console.error('Upload error:', err);
            setStatus(err.message || 'Upload failed. Please try again.', 'error');
            uploadBtn.disabled = false;
        } finally {
            uploadBtn.innerHTML = '<i class="fas fa-cloud-arrow-up me-2"></i>Add to Event Album';
        }
    });

    function setStatus(text, kind) {
        uploadStatus.textContent = text;
        uploadStatus.className = 'mt-2 small text-center ' +
            (kind === 'error' ? 'text-danger' : kind === 'success' ? 'text-success' : 'text-muted');
    }

    // ── Recent photos strip ──────────────────────────────────────────
    async function loadRecent() {
        try {
            const res = await fetch(`/api/event/${encodeURIComponent(eventSlug)}/photos`);
            const photos = await res.json();
            if (!Array.isArray(photos) || photos.length === 0) {
                recentGrid.innerHTML = '<span class="text-muted small">No photos yet — be the first!</span>';
                return;
            }
            recentGrid.innerHTML = '';
            photos.slice(0, 12).forEach((p) => {
                const img = document.createElement('img');
                img.src = p.url;
                img.alt = p.caption || 'Event photo';
                img.loading = 'lazy';
                recentGrid.appendChild(img);
            });
        } catch (err) {
            recentGrid.innerHTML = '<span class="text-muted small">Could not load photos.</span>';
        }
    }

    loadRecent();
});
