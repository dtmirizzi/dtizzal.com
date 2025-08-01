const sidebar = document.getElementById('sidebar');
const canvas = document.getElementById('canvas');
const saveButton = document.getElementById('save-button');
const downloadLinks = document.getElementById('download-links');
const ctx = canvas.getContext('2d');
const uploadButton = document.getElementById('upload-button');
const fileInput = document.getElementById('file-input');
const thumbnailContainer = document.getElementById('thumbnail-container');
let img = new Image();
let rects = [];
let selectedRect = null;
let drag = {x: 0, y: 0, active: false, handle: null};

// --- Main Setup Function ---
function onOpenCvReady() {
    // Initialize event listeners
    sidebar.addEventListener('click', handleThumbnailClick);
    window.addEventListener('resize', handleResize);
    saveButton.addEventListener('click', handleSave);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUpOrOut);
    canvas.addEventListener('mouseout', handleMouseUpOrOut);
    uploadButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileUpload);

    // Initial image load
    loadImage(document.querySelector('.thumbnail.active').dataset.fullSrc);
}

// --- Event Handlers ---
function handleFileUpload(e) {
    thumbnailContainer.innerHTML = '';
    const files = e.target.files;
    if (files.length > 0) {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = document.createElement('img');
                img.src = e.target.result;
                img.dataset.fullSrc = e.target.result;
                img.classList.add('thumbnail');
                if (i === 0) {
                    img.classList.add('active');
                    loadImage(e.target.result);
                }
                thumbnailContainer.appendChild(img);
            }
            reader.readAsDataURL(file);
        }
    }
}

// --- Event Handlers ---
function handleThumbnailClick(e) {
    if (e.target.classList.contains('thumbnail')) {
        document.querySelectorAll('.thumbnail').forEach(thumb => thumb.classList.remove('active'));
        e.target.classList.add('active');
        loadImage(e.target.dataset.fullSrc);
    }
}

function handleResize() {
    if (img.src) {
        drawImageToCanvas();
        drawRects();
    }
}

function handleSave() {
    downloadLinks.innerHTML = '';
    rects.forEach((rect, i) => {
        let tempCanvas = document.createElement('canvas');
        tempCanvas.width = rect.width;
        tempCanvas.height = rect.height;
        let tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
        let link = document.createElement('a');
        link.href = tempCanvas.toDataURL();
        link.download = `sliced_${i + 1}.png`;
        link.innerText = `Download Sliced Image ${i + 1}`;
        downloadLinks.appendChild(link);
        downloadLinks.appendChild(document.createElement('br'));
    });
}

function handleMouseDown(e) {
    const { unscaledX, unscaledY } = getMousePos(e);
    const scaleX = canvas.width / img.naturalWidth;
    const scaleY = canvas.height / img.naturalHeight;

    selectedRect = null;
    drag.active = false;
    drag.handle = null;

    for (let i = rects.length - 1; i >= 0; i--) {
        const rect = rects[i];
        const handles = getHandles(rect);
        let handleFound = null;

        for (const handleName in handles) {
            const handle = handles[handleName];
            if (e.offsetX >= handle.x && e.offsetX <= handle.x + handle.w && e.offsetY >= handle.y && e.offsetY <= handle.y + handle.h) {
                handleFound = handleName;
                break;
            }
        }

        if (handleFound) {
            selectedRect = rect;
            drag.handle = handleFound;
            break;
        }

        const rectScaledX = rect.x * scaleX;
        const rectScaledY = rect.y * scaleY;
        const rectScaledWidth = rect.width * scaleX;
        const rectScaledHeight = rect.height * scaleY;
        if (e.offsetX >= rectScaledX && e.offsetX <= rectScaledX + rectScaledWidth && e.offsetY >= rectScaledY && e.offsetY <= rectScaledY + rectScaledHeight) {
            selectedRect = rect;
            break;
        }
    }

    if (selectedRect) {
        drag.active = true;
        drag.x = unscaledX;
        drag.y = unscaledY;
    }
    drawRects();
}

function handleMouseMove(e) {
    const { unscaledX, unscaledY } = getMousePos(e);

    if (drag.active && selectedRect) {
        const dx = unscaledX - drag.x;
        const dy = unscaledY - drag.y;

        if (drag.handle) {
            // Resizing logic
            switch (drag.handle) {
                case 'topLeft':
                    selectedRect.x += dx;
                    selectedRect.y += dy;
                    selectedRect.width -= dx;
                    selectedRect.height -= dy;
                    break;
                case 'top':
                    selectedRect.y += dy;
                    selectedRect.height -= dy;
                    break;
                case 'topRight':
                    selectedRect.y += dy;
                    selectedRect.width += dx;
                    selectedRect.height -= dy;
                    break;
                case 'left':
                    selectedRect.x += dx;
                    selectedRect.width -= dx;
                    break;
                case 'right':
                    selectedRect.width += dx;
                    break;
                case 'bottomLeft':
                    selectedRect.x += dx;
                    selectedRect.width -= dx;
                    selectedRect.height += dy;
                    break;
                case 'bottom':
                    selectedRect.height += dy;
                    break;
                case 'bottomRight':
                    selectedRect.width += dx;
                    selectedRect.height += dy;
                    break;
            }
        } else {
            // Moving logic
            selectedRect.x += dx;
            selectedRect.y += dy;
        }

        drag.x = unscaledX;
        drag.y = unscaledY;
        drawRects();
    } else {
        updateCursor(e);
    }
}

function handleMouseUpOrOut() {
    drag.active = false;
    drag.handle = null;
}

// --- Helper Functions ---
function getMousePos(e) {
    const scaleX = canvas.width / img.naturalWidth;
    const scaleY = canvas.height / img.naturalHeight;
    return { unscaledX: e.offsetX / scaleX, unscaledY: e.offsetY / scaleY };
}

function updateCursor(e) {
    let cursor = 'default';
    for (const rect of rects) {
        const handles = getHandles(rect);
        let handleFound = false;
        for (const handleName in handles) {
            const handle = handles[handleName];
            if (e.offsetX >= handle.x && e.offsetX <= handle.x + handle.w && e.offsetY >= handle.y && e.offsetY <= handle.y + handle.h) {
                cursor = getCursorForHandle(handleName);
                handleFound = true;
                break;
            }
        }
        if (handleFound) break;

        const scaleX = canvas.width / img.naturalWidth;
        const scaleY = canvas.height / img.naturalHeight;
        const rectScaledX = rect.x * scaleX;
        const rectScaledY = rect.y * scaleY;
        const rectScaledWidth = rect.width * scaleX;
        const rectScaledHeight = rect.height * scaleY;
        if (e.offsetX >= rectScaledX && e.offsetX <= rectScaledX + rectScaledWidth && e.offsetY >= rectScaledY && e.offsetY <= rectScaledY + rectScaledHeight) {
            cursor = 'move';
            break;
        }
    }
    canvas.style.cursor = cursor;
}

function getCursorForHandle(handleName) {
    if (handleName === 'topLeft' || handleName === 'bottomRight') return 'nwse-resize';
    if (handleName === 'topRight' || handleName === 'bottomLeft') return 'nesw-resize';
    if (handleName === 'top' || handleName === 'bottom') return 'ns-resize';
    if (handleName === 'left' || handleName === 'right') return 'ew-resize';
    return 'default';
}

function loadImage(src) {
    img.src = src;
    img.onload = () => {
        drawImageToCanvas();
        findAndDrawRects();
    };
}

function drawImageToCanvas() {
    const aspectRatio = img.width / img.height;
    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvasWidth / aspectRatio;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
}
function findAndDrawRects() {
    let src = cv.imread(img);
    const centerX = Math.floor(src.cols / 2);
    const width = src.cols;
    const height = src.rows;

    // Convert to grayscale and enhance contrast
    let gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.normalize(gray, gray, 0, 255, cv.NORM_MINMAX);
    cv.equalizeHist(gray, gray);

    // Threshold to binary image: treat "non-dark" as content
    let thresh = new cv.Mat();
    cv.threshold(gray, thresh, 45, 255, cv.THRESH_BINARY);  // 30 is good for dark separation

    // Helper: find tight bounding box in region
    function getTightRect(threshMat, roi) {
        let subMat = threshMat.roi(roi);
        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(subMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let bestRect = null;
        let maxArea = 0;
        for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            let rect = cv.boundingRect(cnt);
            let area = rect.width * rect.height;
            if (area > maxArea) {
                maxArea = area;
                bestRect = rect;
            }
            cnt.delete();
        }

        contours.delete();
        hierarchy.delete();
        subMat.delete();

        if (bestRect) {
            // Adjust x for right ROI offset
            bestRect.x += roi.x;
            bestRect.y += roi.y;
            return bestRect;
        }
        return roi; // fallback
    }

    let leftROI = new cv.Rect(0, 0, centerX, height);
    let rightROI = new cv.Rect(centerX, 0, width - centerX, height);

    let leftRect = getTightRect(thresh, leftROI);
    let rightRect = getTightRect(thresh, rightROI);

    rects = [];
    if (leftRect) rects.push(leftRect);
    if (rightRect) rects.push(rightRect);

    drawRects();

    // Cleanup
    src.delete();
    gray.delete();
    thresh.delete();
}


function drawRects() {
    const scaleX = canvas.width / img.naturalWidth;
    const scaleY = canvas.height / img.naturalHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    rects.forEach(rect => {
        ctx.strokeStyle = (rect === selectedRect) ? '#87cefa' : '#FF6A74';
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.x * scaleX, rect.y * scaleY, rect.width * scaleX, rect.height * scaleY);
        if (rect === selectedRect) {
            drawHandles(rect);
        }
    });
}

function getHandles(rect) {
    const scaleX = canvas.width / img.naturalWidth;
    const scaleY = canvas.height / img.naturalHeight;
    const handleSize = 10;
    const x = rect.x * scaleX;
    const y = rect.y * scaleY;
    const width = rect.width * scaleX;
    const height = rect.height * scaleY;

    return {
        topLeft: { x: x - handleSize / 2, y: y - handleSize / 2, w: handleSize, h: handleSize },
        top: { x: x + width / 2 - handleSize / 2, y: y - handleSize / 2, w: handleSize, h: handleSize },
        topRight: { x: x + width - handleSize / 2, y: y - handleSize / 2, w: handleSize, h: handleSize },
        left: { x: x - handleSize / 2, y: y + height / 2 - handleSize / 2, w: handleSize, h: handleSize },
        right: { x: x + width - handleSize / 2, y: y + height / 2 - handleSize / 2, w: handleSize, h: handleSize },
        bottomLeft: { x: x - handleSize / 2, y: y + height - handleSize / 2, w: handleSize, h: handleSize },
        bottom: { x: x + width / 2 - handleSize / 2, y: y + height - handleSize / 2, w: handleSize, h: handleSize },
        bottomRight: { x: x + width - handleSize / 2, y: y + height - handleSize / 2, w: handleSize, h: handleSize },
    };
}

function drawHandles(rect) {
    const handles = getHandles(rect);
    ctx.fillStyle = '#87cefa';
    for (const handle in handles) {
        const h = handles[handle];
        ctx.fillRect(h.x, h.y, h.w, h.h);
    }
}
