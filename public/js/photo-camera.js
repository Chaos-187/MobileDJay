// MobileDJay — dedicated full-screen live camera page ("Just Take a Pic").
// Opens the camera immediately, captures a frame, and uploads it to the
// event album (POST /api/event/:slug/photos).

(function () {
    const cameraVideo = document.getElementById('cameraVideo');
    const reviewImg = document.getElementById('reviewImg');
    const cameraFlash = document.getElementById('cameraFlash');
    const captureControls = document.getElementById('captureControls');
    const reviewBar = document.getElementById('reviewBar');
    const shutterBtn = document.getElementById('shutterBtn');
    const flipBtn = document.getElementById('flipBtn');
    const closeBtn = document.getElementById('closeBtn');
    const retakeBtn = document.getElementById('retakeBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const captionInput = document.getElementById('captionInput');
    const statusMsg = document.getElementById('statusMsg');

    const eventSlug = window.eventSlug;
    const customerName = window.customerName || sessionStorage.getItem('customerName') || '';
    const eventUrl = '/event/' + encodeURIComponent(eventSlug);
    const photoPageUrl = eventUrl + '/photo' + (customerName ? '?customerName=' + encodeURIComponent(customerName) : '');

    let cameraStream = null;
    let facingMode = 'environment';
    let capturedBlob = null;

    // ── Filters ──────────────────────────────────────────────────────
    // CSS filter strings: previewed live on the video, then baked into the
    // captured JPEG via canvas ctx.filter.
    const FILTERS = [
        { name: 'Normal', css: '' },
        { name: 'Vivid', css: 'saturate(1.55) contrast(1.1)' },
        { name: 'Warm', css: 'sepia(0.25) saturate(1.35) brightness(1.05)' },
        { name: 'Cool', css: 'saturate(1.15) hue-rotate(-12deg) brightness(1.03)' },
        { name: 'Vintage', css: 'sepia(0.45) contrast(1.08) brightness(0.95) saturate(1.2)' },
        { name: 'B&W', css: 'grayscale(1) contrast(1.08)' },
        { name: 'Sepia', css: 'sepia(0.85)' },
        { name: 'Faded', css: 'contrast(0.85) brightness(1.12) saturate(0.8)' },
        { name: 'Noir', css: 'grayscale(1) contrast(1.35) brightness(0.9)' }
    ];
    let currentFilter = FILTERS[0];

    // Canvas filter support (needed to bake the filter into the photo).
    // Old browsers without it just don't get the filter strip.
    const filtersSupported = (() => {
        try {
            return 'filter' in document.createElement('canvas').getContext('2d');
        } catch (e) {
            return false;
        }
    })();

    const filterStrip = document.getElementById('filterStrip');
    if (filtersSupported) {
        FILTERS.forEach((filter, i) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'filter-chip' + (i === 0 ? ' active' : '');
            chip.setAttribute('aria-label', filter.name + ' filter');
            const swatch = document.createElement('span');
            swatch.className = 'swatch';
            swatch.style.filter = filter.css;
            chip.appendChild(swatch);
            chip.appendChild(document.createTextNode(filter.name));
            chip.addEventListener('click', () => {
                currentFilter = filter;
                cameraVideo.style.filter = filter.css;
                filterStrip.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
            });
            filterStrip.appendChild(chip);
        });
    } else {
        filterStrip.style.display = 'none';
    }

    function showStatus(html) {
        statusMsg.innerHTML = html;
        statusMsg.classList.add('active');
    }

    function hideStatus() {
        statusMsg.classList.remove('active');
    }

    function stopCamera() {
        if (cameraStream) {
            cameraStream.getTracks().forEach((t) => t.stop());
            cameraStream = null;
        }
        cameraVideo.srcObject = null;
    }

    async function startCamera() {
        stopCamera();
        hideStatus();
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: facingMode },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: false
            });
        } catch (err) {
            console.warn('Camera constraints rejected, retrying with defaults:', err);
            try {
                cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            } catch (err2) {
                console.error('Camera error:', err2);
                showStatus(
                    (err2 && err2.name === 'NotAllowedError'
                        ? 'Camera access was blocked.<br>Allow camera permission and reload.'
                        : 'Could not start the camera on this device.') +
                    '<div class="actions"><a href="' + photoPageUrl + '">Upload a photo instead</a>' +
                    '<a class="secondary" href="' + eventUrl + '">Back</a></div>'
                );
                return;
            }
        }
        cameraVideo.srcObject = cameraStream;
        try {
            await cameraVideo.play();
        } catch (err) {
            console.warn('Video play() rejected:', err);
        }
        cameraVideo.classList.toggle('mirrored', facingMode === 'user');
    }

    function showReview() {
        captureControls.style.display = 'none';
        filterStrip.style.display = 'none';
        reviewBar.classList.add('active');
        cameraVideo.style.display = 'none';
        reviewImg.style.display = '';
    }

    function backToCamera() {
        capturedBlob = null;
        reviewImg.style.display = 'none';
        reviewImg.src = '';
        cameraVideo.style.display = '';
        reviewBar.classList.remove('active');
        captureControls.style.display = '';
        if (filtersSupported) filterStrip.style.display = '';
        hideStatus();
        if (!cameraStream) startCamera();
    }

    // ── Capture ──────────────────────────────────────────────────────
    shutterBtn.addEventListener('click', () => {
        if (!cameraStream || !cameraVideo.videoWidth) return;

        cameraFlash.classList.remove('flashing');
        void cameraFlash.offsetWidth;
        cameraFlash.classList.add('flashing');

        const canvas = document.createElement('canvas');
        canvas.width = cameraVideo.videoWidth;
        canvas.height = cameraVideo.videoHeight;
        const ctx = canvas.getContext('2d');
        if (filtersSupported && currentFilter.css) {
            ctx.filter = currentFilter.css;
        }
        if (facingMode === 'user') {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
        }
        ctx.drawImage(cameraVideo, 0, 0);
        canvas.toBlob((blob) => {
            if (!blob) return;
            capturedBlob = blob;
            reviewImg.src = URL.createObjectURL(blob);
            stopCamera();
            showReview();
        }, 'image/jpeg', 0.92);
    });

    flipBtn.addEventListener('click', () => {
        facingMode = facingMode === 'environment' ? 'user' : 'environment';
        startCamera();
    });

    closeBtn.addEventListener('click', () => {
        stopCamera();
        window.location.href = eventUrl;
    });

    retakeBtn.addEventListener('click', backToCamera);

    // ── Upload ───────────────────────────────────────────────────────
    uploadBtn.addEventListener('click', async () => {
        if (!capturedBlob) return;

        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Uploading…';

        const formData = new FormData();
        formData.append('photo', capturedBlob, 'photo.jpg');
        formData.append('customerName', customerName);
        formData.append('caption', captionInput.value.trim());

        try {
            const res = await fetch('/api/event/' + encodeURIComponent(eventSlug) + '/photos', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Upload failed');
            }
            captionInput.value = '';
            showStatus(
                '<i class="fas fa-circle-check" style="color:#4ade80; font-size:1.6rem;"></i><br>' +
                'Added to the event album!' +
                '<div class="actions"><button type="button" class="linkish" id="anotherBtn">Take Another</button>' +
                '<a class="secondary" href="' + eventUrl + '">Done</a></div>'
            );
            document.getElementById('anotherBtn').addEventListener('click', backToCamera);
        } catch (err) {
            console.error('Upload error:', err);
            showStatus(
                '<i class="fas fa-triangle-exclamation" style="color:#fbbf24; font-size:1.6rem;"></i><br>' +
                (err.message || 'Upload failed. Please try again.') +
                '<div class="actions"><button type="button" class="linkish" id="dismissBtn">OK</button></div>'
            );
            document.getElementById('dismissBtn').addEventListener('click', hideStatus);
        } finally {
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = '<i class="fas fa-cloud-arrow-up me-1"></i> Add to Album';
        }
    });

    // Free the camera when leaving or backgrounding the page.
    window.addEventListener('pagehide', stopCamera);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopCamera();
        } else if (!capturedBlob) {
            startCamera();
        }
    });

    // ── Boot ─────────────────────────────────────────────────────────
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        startCamera();
    } else {
        showStatus(
            'The live camera needs a secure (HTTPS) connection.' +
            '<div class="actions"><a href="' + photoPageUrl + '">Upload a photo instead</a>' +
            '<a class="secondary" href="' + eventUrl + '">Back</a></div>'
        );
    }
})();
