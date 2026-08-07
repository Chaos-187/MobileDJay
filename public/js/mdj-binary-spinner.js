/**
 * Shared two-option wheel animation for coin / yes-no spinners.
 */
(function (global) {
    const ITEM_HEIGHT = 300;

    function prepareBinaryList(options, resultKey, listEl, renderItemHtml) {
        const resultOpt =
            options.find(function (o) {
                return o.key === resultKey;
            }) || options[0];
        const pool = options.slice().sort(function () {
            return Math.random() - 0.5;
        });
        let display = [];
        while (display.length < 40) {
            display = display.concat(pool);
        }
        display = display.slice(0, 40);
        const targetIndex = Math.max(display.length - 4, 0);
        display.splice(targetIndex, 0, resultOpt);
        listEl.innerHTML = display
            .map(function (opt, i) {
                return renderItemHtml(opt, i);
            })
            .join('');
        listEl.style.transform = 'translateY(0)';
        return targetIndex;
    }

    function animateBinarySpin(params) {
        const listEl = params.listEl;
        const slotEl = params.slotEl;
        const targetIndex = params.targetIndex;
        const spinDuration = params.spinDuration;
        const onComplete = params.onComplete;

        const items = listEl.querySelectorAll('.binary-item');
        const targetElement = items[targetIndex];
        if (!targetElement) {
            if (onComplete) onComplete();
            return;
        }
        const targetOffset = targetElement.offsetTop;
        const centerOffset = (slotEl.offsetHeight - ITEM_HEIGHT) / 2;
        const finalPosition = -(targetOffset - centerOffset);
        const startTime = Date.now();

        function frame() {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / spinDuration, 1);
            if (progress >= 1) {
                listEl.style.transform = 'translateY(' + finalPosition + 'px)';
                if (onComplete) onComplete();
                return;
            }
            const easeOutCubic = 1 - Math.pow(1 - progress, 3);
            listEl.style.transform =
                'translateY(' + finalPosition * easeOutCubic + 'px)';
            requestAnimationFrame(frame);
        }

        listEl.style.transition = 'none';
        requestAnimationFrame(frame);
    }

    global.MdjBinarySpinner = {
        ITEM_HEIGHT: ITEM_HEIGHT,
        prepareBinaryList: prepareBinaryList,
        animateBinarySpin: animateBinarySpin
    };
})(window);
