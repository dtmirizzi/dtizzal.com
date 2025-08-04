const sidebar = document.getElementById('sidebar');
const canvas = document.getElementById('canvas');
const downloadLinks = document.getElementById('download-links');
const ctx = canvas.getContext('2d');
const uploadButton = document.getElementById('upload-button');
const fileInput = document.getElementById('file-input');
const thumbnailContainer = document.getElementById('thumbnail-container');

let imageRects = new Map(); // Stores { src: [rects] }

let img = new Image();
let rects = []; // Rects for the CURRENTLY active image
let selectedRect = null;
let drag = {x: 0, y: 0, active: false, handle: null};

// --- Main Setup Function ---
function startApp() {
    // Initialize event listeners
    sidebar.addEventListener('click', handleThumbnailClick);
    window.addEventListener('resize', handleResize);
    document.getElementById('save-current-button').addEventListener('click', handleSave);
    document.getElementById('save-all-button').addEventListener('click', handleSaveAll);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUpOrOut);
    canvas.addEventListener('mouseout', handleMouseUpOrOut);
    uploadButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileUpload);

    // Initial image load
    loadImage(document.querySelector('.thumbnail.active').dataset.fullSrc);
}

function onOpenCvReady() {
    // Poll until cv.Mat is defined
    const interval = setInterval(() => {
        if (typeof cv !== 'undefined' && cv.Mat) {
            clearInterval(interval);
            startApp();
        }
    }, 100);
}

// --- Event Handlers ---
async function handleFileUpload(e) {
    thumbnailContainer.innerHTML = '';
    const files = e.target.files;
    if (files.length > 0) {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const reader = new FileReader();
            // Use a promise to wait for file reading and rotation
            const processedSrc = await new Promise((resolve) => {
                reader.onload = async (e) => {
                    const tempImg = new Image();
                    tempImg.src = e.target.result;
                    tempImg.onload = async () => {
                        // Check orientation and rotate if portrait
                        if (tempImg.naturalWidth < tempImg.naturalHeight) {
                            const rotatedSrc = rotateImage(tempImg);
                            resolve(rotatedSrc);
                        } else {
                            resolve(tempImg.src);
                        }
                    };
                };
                reader.readAsDataURL(file);
            });

            const img = document.createElement('img');
            img.src = processedSrc;
            img.dataset.fullSrc = processedSrc;
            img.classList.add('thumbnail');
            if (i === 0) {
                img.classList.add('active');
                loadImage(processedSrc);
            }
            thumbnailContainer.appendChild(img);
        }
    }
}

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
    const originalFilename = img.src.split('/').pop().replace(/\.[^/.]+$/, "");
    rects.forEach((rect, i) => {
        let tempCanvas = document.createElement('canvas');
        tempCanvas.width = rect.width;
        tempCanvas.height = rect.height;
        let tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
        let link = document.createElement('a');
        link.href = tempCanvas.toDataURL();
        link.download = `sliced_${originalFilename}_${i + 1}.png`;
        link.innerText = `Download Sliced Image ${i + 1}`;
        downloadLinks.appendChild(link);
        downloadLinks.appendChild(document.createElement('br'));
    });
}

async function handleSaveAll() {
    downloadLinks.innerHTML = 'Preparing all sliced images for download... This may take a moment.';
    const thumbnails = Array.from(document.querySelectorAll('.thumbnail'));
    const zip = new JSZip();

    for (const thumb of thumbnails) {
        const src = thumb.dataset.fullSrc;
        let imageRectangles = imageRects.get(src);

        const tempImg = new Image();
        tempImg.crossOrigin = "Anonymous";
        tempImg.src = src;

        await new Promise((resolve) => {
            tempImg.onload = resolve;
            tempImg.onerror = (err) => {
                console.error("Failed to load image for bulk save:", src, err);
                resolve(); // Resolve anyway to not block the whole process
            };
        });

        if (!tempImg.complete || tempImg.naturalWidth === 0) {
            console.warn("Skipping image because it could not be loaded:", src);
            continue; // Skip to next image if this one failed to load
        }
        
        // Check orientation and rotate if portrait for bulk save
        let finalImageElement = tempImg;
        if (tempImg.naturalWidth < tempImg.naturalHeight) {
            const rotatedSrc = rotateImage(tempImg);
            finalImageElement = new Image();
            finalImageElement.src = rotatedSrc;
            await new Promise((resolve) => finalImageElement.onload = resolve);
        }

        if (!imageRectangles) {
            try {
                imageRectangles = findRects(finalImageElement);
                imageRects.set(src, imageRectangles);
            } catch (e) {
                console.error("Could not process image to find rectangles:", src, e);
                continue; // Skip if opencv fails
            }
        }

        const originalFilename = src.split('/').pop().replace(/\.[^/.]+$/, "");
        for (let i = 0; i < imageRectangles.length; i++) {
            const rect = imageRectangles[i];
            let tempCanvas = document.createElement('canvas');
            tempCanvas.width = rect.width;
            tempCanvas.height = rect.height;
            let tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(finalImageElement, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
            const blob = await new Promise(resolve => tempCanvas.toBlob(resolve, 'image/png'));
            zip.file(`sliced_${originalFilename}_${i + 1}.png`, blob);
        }
    }

    zip.generateAsync({type:"blob"}).then(function(content) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = "sliced_images.zip";
        link.innerText = "Download All Sliced Images as ZIP";
        downloadLinks.innerHTML = '';
        downloadLinks.appendChild(link);
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
    if (drag.active && selectedRect) {
        imageRects.set(img.originalSrc, rects);
    }
    drag.active = false;
    drag.handle = null;
}

// --- Helper Functions ---

// New function to rotate an image and return a new data URL
function rotateImage(imageElement) {
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    
    // Set canvas dimensions to the rotated dimensions
    tempCanvas.width = imageElement.naturalHeight;
    tempCanvas.height = imageElement.naturalWidth;

    // Perform the rotation
    tempCtx.translate(tempCanvas.width / 2, tempCanvas.height / 2);
    tempCtx.rotate(90 * Math.PI / 180);
    tempCtx.drawImage(imageElement, -imageElement.naturalWidth / 2, -imageElement.naturalHeight / 2);
    
    return tempCanvas.toDataURL();
}

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
    img.originalSrc = src; // Store the original, consistent src
    img.src = src;
    img.onload = () => {
        drawImageToCanvas();
        if (imageRects.has(src)) {
            rects = imageRects.get(src).map(r => ({...r})); // Deep copy
            drawRects();
        } else {
            findAndDrawRects();
        }
    };
    img.onerror = () => {
        console.error("Failed to load image:", src);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText("Error loading image. Check console for details.", canvas.width / 2, canvas.height / 2);
    }
}

function drawImageToCanvas() {
    const aspectRatio = img.width / img.height;
    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvasWidth / aspectRatio;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
}

function findRects(imageElement) {
    let src = cv.imread(imageElement);
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

    let foundRects = [];
    if (leftRect) foundRects.push(leftRect);
    if (rightRect) foundRects.push(rightRect);

    // Cleanup
    src.delete();
    gray.delete();
    thresh.delete();

    return foundRects;
}

function findAndDrawRects() {
    try {
        const cvRects = findRects(img);
        rects = cvRects.map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
        imageRects.set(img.originalSrc, rects);
        drawRects();
    } catch (e) {
        console.error("OpenCV error in findAndDrawRects:", e);
        drawImageToCanvas();
    }
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