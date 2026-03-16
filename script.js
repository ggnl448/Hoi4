// ==================== ULTRA OPTIMIZED MAP SYSTEM ====================

class OptimizedMap extends WorldMap {
    constructor(canvasId) {
        super(canvasId);
        
        // Кэширование и оптимизация
        this.visibleProvinces = new Set();
        this.provinceCache = new Map(); // Кэш отрисованных провинций
        this.borderCache = null; // Кэш границ
        this.lastZoomLevel = 1;
        this.lastOffset = { x: 0, y: 0 };
        
        // Производительность
        this.lastRenderTime = 0;
        this.frameCount = 0;
        this.fps = 60;
        this.renderMode = 'auto'; // 'canvas', 'webgl', 'auto'
        this.useWebGL = this.checkWebGLSupport();
        this.useOffscreenCanvas = !!window.OffscreenCanvas;
        
        // Оптимизация памяти
        this.provinceQuadTree = null;
        this.debouncedRender = this.debounce(this.render.bind(this), 16); // 60fps
        
        // Инициализация
        if (this.useWebGL) this.initWebGL();
        if (this.useOffscreenCanvas) this.initOffscreenCanvas();
        
        // Рабочие потоки для фоновых задач
        this.worker = this.initWorker();
    }

    initWorker() {
        if (window.Worker) {
            const worker = new Worker('map-worker.js');
            worker.onmessage = (e) => {
                if (e.data.type === 'visibility') {
                    this.visibleProvinces = new Set(e.data.provinces.map(id => this.provinces.get(id)));
                    this.requestRender();
                }
            };
            return worker;
        }
        return null;
    }

    checkWebGLSupport() {
        try {
            const canvas = document.createElement('canvas');
            return !!(canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
        } catch(e) { 
            return false; 
        }
    }

    initWebGL() {
        try {
            this.gl = this.canvas.getContext('webgl2') || 
                     this.canvas.getContext('webgl') || 
                     this.canvas.getContext('experimental-webgl');
            
            if (!this.gl) return;
            
            // Настройка WebGL для максимальной производительности
            this.gl.enable(this.gl.BLEND);
            this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
            
            // Создание шейдеров
            this.initShaders();
            
            // Буферы для геометрии
            this.initBuffers();
            
            console.log('WebGL initialized successfully');
        } catch(e) {
            console.warn('WebGL initialization failed, falling back to Canvas2D');
            this.useWebGL = false;
        }
    }

    initShaders() {
        // Вершинный шейдер
        const vsSource = `
            attribute vec2 aPosition;
            attribute vec4 aColor;
            uniform vec2 uTranslation;
            uniform float uScale;
            varying vec4 vColor;
            
            void main() {
                gl_Position = vec4((aPosition * uScale + uTranslation) / 1000.0, 0.0, 1.0);
                vColor = aColor;
            }
        `;
        
        // Фрагментный шейдер
        const fsSource = `
            precision mediump float;
            varying vec4 vColor;
            
            void main() {
                gl_FragColor = vColor;
            }
        `;
        
        // Компиляция шейдеров
        const vertexShader = this.compileShader(this.gl.VERTEX_SHADER, vsSource);
        const fragmentShader = this.compileShader(this.gl.FRAGMENT_SHADER, fsSource);
        
        // Создание программы
        this.program = this.gl.createProgram();
        this.gl.attachShader(this.program, vertexShader);
        this.gl.attachShader(this.program, fragmentShader);
        this.gl.linkProgram(this.program);
        
        // Получение атрибутов
        this.attribLocations = {
            position: this.gl.getAttribLocation(this.program, 'aPosition'),
            color: this.gl.getAttribLocation(this.program, 'aColor')
        };
        
        // Получение uniform-ов
        this.uniformLocations = {
            translation: this.gl.getUniformLocation(this.program, 'uTranslation'),
            scale: this.gl.getUniformLocation(this.program, 'uScale')
        };
    }

    compileShader(type, source) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('Shader compilation error:', this.gl.getShaderInfoLog(shader));
            this.gl.deleteShader(shader);
            return null;
        }
        
        return shader;
    }

    initBuffers() {
        this.buffers = {
            provinces: new Map(),
            borders: null
        };
    }

    initOffscreenCanvas() {
        this.offscreenCanvas = new OffscreenCanvas(1, 1);
        this.offscreenCtx = this.offscreenCanvas.getContext('2d');
    }

    // Построение квадродерева для пространственного индексирования
    buildQuadTree() {
        const bounds = this.getMapBounds();
        this.provinceQuadTree = new QuadTree(bounds, 16); // Макс 16 объектов на узел
        
        this.provinces.forEach(province => {
            const provinceBounds = this.getProvinceBounds(province);
            this.provinceQuadTree.insert({
                x: provinceBounds.x,
                y: provinceBounds.y,
                width: provinceBounds.width,
                height: provinceBounds.height,
                province: province
            });
        });
    }

    getMapBounds() {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        this.provinces.forEach(province => {
            province.paths.forEach(path => {
                path.forEach(([x, y]) => {
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                });
            });
        });
        
        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    getProvinceBounds(province) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        province.paths.forEach(path => {
            path.forEach(([x, y]) => {
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            });
        });
        
        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2
        };
    }

    // Оптимизированное обновление видимости
    updateVisibility() {
        const viewport = {
            x: -this.offset.x / this.zoom,
            y: -this.offset.y / this.zoom,
            width: this.canvas.width / this.zoom,
            height: this.canvas.height / this.zoom
        };

        // Расширяем вьюпорт для плавного скролла
        const expandedViewport = {
            x: viewport.x - viewport.width * 0.2,
            y: viewport.y - viewport.height * 0.2,
            width: viewport.width * 1.4,
            height: viewport.height * 1.4
        };

        // Используем воркер для тяжелых вычислений если доступно
        if (this.worker) {
            this.worker.postMessage({
                type: 'calculateVisibility',
                viewport: expandedViewport,
                provinceIds: Array.from(this.provinces.keys())
            });
            return;
        }

        // Иначе вычисляем в основном потоке
        this.visibleProvinces.clear();
        
        if (this.provinceQuadTree) {
            // Быстрый поиск через квадродерево
            this.provinceQuadTree.query(expandedViewport, (item) => {
                if (this.isProvinceVisible(item.province, viewport)) {
                    this.visibleProvinces.add(item.province);
                }
            });
        } else {
            // Fallback: линейный поиск
            this.provinces.forEach(province => {
                if (this.isProvinceVisible(province, viewport)) {
                    this.visibleProvinces.add(province);
                }
            });
        }
    }

    isProvinceVisible(province, viewport) {
        // Быстрая проверка через bounding box
        const bounds = this.getProvinceBounds(province);
        
        if (bounds.x + bounds.width < viewport.x) return false;
        if (bounds.x > viewport.x + viewport.width) return false;
        if (bounds.y + bounds.height < viewport.y) return false;
        if (bounds.y > viewport.y + viewport.height) return false;
        
        return true;
    }

    // Рендеринг с выбором оптимального метода
    render(ctx) {
        const now = performance.now();
        this.frameCount++;
        
        // Обновление FPS
        if (now - this.lastRenderTime > 1000) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.lastRenderTime = now;
        }

        // Определяем, нужно ли перестраивать кэш
        const zoomChanged = Math.abs(this.zoom - this.lastZoomLevel) > 0.1;
        const offsetChanged = Math.abs(this.offset.x - this.lastOffset.x) > 10 || 
                              Math.abs(this.offset.y - this.lastOffset.y) > 10;

        if (zoomChanged || offsetChanged) {
            this.updateVisibility();
            this.lastZoomLevel = this.zoom;
            this.lastOffset = { ...this.offset };
        }

        // Выбор метода рендеринга
        if (this.useWebGL && this.zoom > 0.5) {
            this.renderWebGL();
        } else {
            this.renderCanvas2D(ctx);
        }

        // Отображение FPS
        this.renderFPS(ctx);
    }

    // WebGL рендеринг (самый быстрый)
    renderWebGL() {
        if (!this.gl) return;
        
        const gl = this.gl;
        
        // Очистка
        gl.clearColor(0.1, 0.1, 0.15, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        // Использование программы
        gl.useProgram(this.program);
        
        // Установка uniform-ов
        gl.uniform2f(this.uniformLocations.translation, this.offset.x, this.offset.y);
        gl.uniform1f(this.uniformLocations.scale, this.zoom);
        
        // Рендеринг видимых провинций
        this.visibleProvinces.forEach(province => {
            this.renderProvinceWebGL(province);
        });
        
        gl.flush();
    }

    renderProvinceWebGL(province) {
        const gl = this.gl;
        
        // Получение или создание буфера для провинции
        let bufferData = this.buffers.provinces.get(province.id);
        
        if (!bufferData) {
            // Создание геометрии для провинции
            const vertices = [];
            const colors = [];
            
            // Цвет провинции
            const color = this.getProvinceColor(province);
            const r = parseInt(color.slice(1, 3), 16) / 255;
            const g = parseInt(color.slice(3, 5), 16) / 255;
            const b = parseInt(color.slice(5, 7), 16) / 255;
            
            province.paths.forEach(path => {
                for (let i = 0; i < path.length - 1; i++) {
                    // Треугольники для каждого сегмента
                    vertices.push(
                        path[i][0], path[i][1],
                        path[i+1][0], path[i+1][1],
                        path[i][0], path[i][1]
                    );
                    
                    for (let j = 0; j < 3; j++) {
                        colors.push(r, g, b, 0.7);
                    }
                }
            });
            
            // Создание буферов
            const vertexBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
            
            const colorBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
            
            bufferData = {
                vertexBuffer,
                colorBuffer,
                vertexCount: vertices.length / 2
            };
            
            this.buffers.provinces.set(province.id, bufferData);
        }
        
        // Рендеринг буфера
        gl.bindBuffer(gl.ARRAY_BUFFER, bufferData.vertexBuffer);
        gl.vertexAttribPointer(this.attribLocations.position, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.attribLocations.position);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, bufferData.colorBuffer);
        gl.vertexAttribPointer(this.attribLocations.color, 4, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.attribLocations.color);
        
        gl.drawArrays(gl.TRIANGLES, 0, bufferData.vertexCount);
    }

    // Canvas2D рендеринг с кэшированием
    renderCanvas2D(ctx) {
        // Очистка
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.save();
        ctx.translate(this.offset.x, this.offset.y);
        ctx.scale(this.zoom, this.zoom);
        
        // Используем offscreen canvas для кэширования если доступно
        if (this.useOffscreenCanvas && this.zoom > 0.8) {
            this.renderWithCache(ctx);
        } else {
            this.renderDirect(ctx);
        }
        
        // Рендеринг границ
        this.renderBordersOptimized(ctx);
        
        ctx.restore();
    }

    // Рендеринг с использованием кэша
    renderWithCache(ctx) {
        const cacheKey = `${Math.round(this.zoom * 10)}`;
        
        if (!this.provinceCache.has(cacheKey)) {
            // Создание кэша для этого уровня зума
            const cacheCanvas = new OffscreenCanvas(
                this.canvas.width / this.zoom,
                this.canvas.height / this.zoom
            );
            const cacheCtx = cacheCanvas.getContext('2d');
            
            // Рендеринг всех провинций в кэш
            this.provinces.forEach(province => {
                cacheCtx.beginPath();
                this.renderProvinceBatch(cacheCtx, province);
                cacheCtx.fillStyle = this.getProvinceColor(province);
                cacheCtx.fill();
            });
            
            this.provinceCache.set(cacheKey, cacheCanvas);
        }
        
        // Использование кэша
        const cached = this.provinceCache.get(cacheKey);
        ctx.drawImage(cached, 0, 0);
    }

    // Прямой рендеринг (без кэша)
    renderDirect(ctx) {
        // Сортировка для правильного наложения
        const sortedProvinces = Array.from(this.visibleProvinces)
            .sort((a, b) => {
                if (a.type === 'sea' && b.type !== 'sea') return -1;
                if (a.type !== 'sea' && b.type === 'sea') return 1;
                return 0;
            });
        
        // Пакетный рендеринг
        ctx.beginPath();
        sortedProvinces.forEach(province => {
            this.renderProvinceBatch(ctx, province);
        });
        
        // Заливка
        sortedProvinces.forEach(province => {
            ctx.fillStyle = this.getProvinceColor(province);
            ctx.fill();
        });
        
        // Обводка
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 0.5;
        ctx.stroke();
    }

    renderProvinceBatch(ctx, province) {
        province.paths.forEach(path => {
            ctx.moveTo(path[0][0], path[0][1]);
            for (let i = 1; i < path.length; i++) {
                ctx.lineTo(path[i][0], path[i][1]);
            }
            ctx.closePath();
        });
    }

    // Оптимизированный рендеринг границ
    renderBordersOptimized(ctx) {
        // Кэширование границ
        if (!this.borderCache || this.zoom !== this.lastZoomLevel) {
            this.borderCache = this.generateBorderCache();
        }
        
        // Использование кэша
        ctx.save();
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 / this.zoom;
        ctx.stroke(this.borderCache);
    }

    generateBorderCache() {
        const path2D = new Path2D();
        const processed = new Set();
        
        this.provinces.forEach(province => {
            if (!province.controller) return;
            
            province.connections.forEach(neighbor => {
                if (neighbor.controller !== province.controller) {
                    const borderKey = [province.id, neighbor.id].sort().join('-');
                    if (!processed.has(borderKey)) {
                        processed.add(borderKey);
                        this.addBorderToPath(path2D, province, neighbor);
                    }
                }
            });
        });
        
        return path2D;
    }

    addBorderToPath(path2D, p1, p2) {
        const bounds1 = this.getProvinceBounds(p1);
        const bounds2 = this.getProvinceBounds(p2);
        
        path2D.moveTo(bounds1.centerX, bounds1.centerY);
        path2D.lineTo(bounds2.centerX, bounds2.centerY);
    }

    // Оптимизированное получение цвета провинции
    getProvinceColor(province) {
        if (province.controller === this.gameEngine?.playerCountry) return '#4CAF50';
        if (province.controller) return province.controller.color;
        return '#808080';
    }

    // Отрисовка FPS
    renderFPS(ctx) {
        ctx.save();
        ctx.restore();
        
        // Восстанавливаем контекст для UI
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.font = '12px monospace';
        ctx.fillStyle = '#fff';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;
        ctx.fillText(`FPS: ${this.fps}`, 10, 20);
        ctx.shadowBlur = 0;
    }

    // Дебаунс для оптимизации рендеринга
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Запрос на рендеринг
    requestRender() {
        this.debouncedRender(this.ctx);
    }

    // Обработка изменения размера
    resize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.provinceCache.clear(); // Инвалидация кэша
        this.requestRender();
    }
}

// ==================== QUADTREE FOR SPATIAL INDEXING ====================

class QuadTree {
    constructor(bounds, maxObjects = 10) {
        this.bounds = bounds;
        this.maxObjects = maxObjects;
        this.objects = [];
        this.children = null;
    }

    insert(item) {
        // Если есть дети, вставляем в соответствующего ребенка
        if (this.children) {
            const index = this.getChildIndex(item);
            if (index !== -1) {
                this.children[index].insert(item);
                return;
            }
        }

        // Иначе добавляем в текущий узел
        this.objects.push(item);

        // Проверяем необходимость разделения
        if (!this.children && this.objects.length > this.maxObjects) {
            this.split();
        }
    }

    split() {
        const x = this.bounds.x;
        const y = this.bounds.y;
        const w = this.bounds.width / 2;
        const h = this.bounds.height / 2;

        // Создание 4 детей
        this.children = [
            new QuadTree({ x: x, y: y, width: w, height: h }, this.maxObjects),
            new QuadTree({ x: x + w, y: y, width: w, height: h }, this.maxObjects),
            new QuadTree({ x: x, y:
