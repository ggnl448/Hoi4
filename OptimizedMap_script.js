// map/OptimizedMap.js
class OptimizedMap extends WorldMap {
    constructor(canvasId) {
       super(canvasId);
       this.visibleProvinces = new Set();
       this.lastRenderTime = 0;
       this.frameCount = 0;
       this.useWebGL = this.checkWebGLSupport();    
        if (this.useWebGL) {
            this.initWebGL();
        }
    }
    checkWebGLSupport() {
        try {
            const canvas = document.createElement('canvas');
            return !!canvas.getContext('webgl2');
        } catch(e) {
            return false;
        }
    }
    initWebGL() {
        // Инициализация WebGL для более быстрого рендеринга
        this.gl = this.canvas.getContext('webgl2');
        // Настройка шейдеров, буферов и т.д.
    }
    updateVisibility() {
        const viewport = {
            x: -this.offset.x / this.zoom,
            y: -this.offset.y / this.zoom,
            width: this.canvas.width / this.zoom,
            height: this.canvas.height / this.zoom
        };
        this.visibleProvinces.clear();
        // Используем пространственное дерево для быстрого поиска
        this.provinceQuadTree.query(viewport, (province) => {
            if (this.isProvinceVisible(province, viewport)) {
                this.visibleProvinces.add(province);
            }
        });
    }
    render(ctx) {
        const now = performance.now();
        this.frameCount++;

        // Обновление FPS раз в секунду
        if (now - this.lastRenderTime > 1000) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.lastRenderTime = now;
        }
        // Рендеринг только видимых провинций
        this.updateVisibility();
        
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.save();
        ctx.translate(this.offset.x, this.offset.y);
        ctx.scale(this.zoom, this.zoom);
        
        // Сортировка для правильного наложения (моря снизу, земля сверху)
        const sortedProvinces = Array.from(this.visibleProvinces)
            .sort((a, b) => (a.type === 'sea' ? -1 : 1));      
        // Пакетный рендеринг
        ctx.beginPath();
        sortedProvinces.forEach(province => {
            this.renderProvinceBatch(ctx, province);
        });
        ctx.fill();
        ctx.stroke();        
        ctx.restore();        
        // Отображение FPS
        this.renderFPS(ctx);
    }
    renderProvinceBatch(ctx, province) {
        province.paths.forEach(path => {
            ctx.moveTo(path[0][0], path[0][1]);
            for (let i = 1; i < path.length; i++) {
                ctx.lineTo(path[i][0], path[i][1]);
            }
        });
    }
}
