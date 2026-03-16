```javascript
// ==================== CORE ENGINE ====================
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
// core/GameEngine.js
class GameEngine {
    constructor() {
        this.map = new WorldMap('game-canvas');
        this.resourceManager = new ResourceManager(this);
        this.divisionManager = new DivisionManager(this);
        this.diplomacyManager = new DiplomacyManager(this);
        this.productionManager = new ProductionManager(this);
        this.researchManager = new ResearchManager(this);
        this.combatManager = new CombatManager(this);
        this.saveManager = new SaveManager(this);
        this.clock = new GameClock();
        
        this.isRunning = false;
        this.speed = 1;
        this.countries = new Map();
        this.playerCountry = null;
        this.events = new EventBus();
    }

    async initialize(countryId = 'GER') {
        await this.loadCountries();
        this.playerCountry = this.countries.get(countryId);
        await this.map.loadMapData(this.countries);
        this.setupEventListeners();
        this.startGameLoop();
    }

    loadCountries() {
        // Загрузка стран из конфига
        const countriesData = {
            'GER': { name: 'Germany', color: '#3a3a3a', ideology: 'fascism', capital: 1 },
            'FRA': { name: 'France', color: '#2c3e8f', ideology: 'democracy', capital: 2 },
            'GBR': { name: 'United Kingdom', color: '#c27e3d', ideology: 'democracy', capital: 3 },
            'USA': { name: 'United States', color: '#3d6ea8', ideology: 'democracy', capital: 4 },
            'SOV': { name: 'Soviet Union', color: '#a83d3d', ideology: 'communism', capital: 5 }
        };

        Object.entries(countriesData).forEach(([id, data]) => {
            this.countries.set(id, new Country(id, data, this));
        });
    }

    setupEventListeners() {
        this.events.on('provinceSelected', (province) => this.onProvinceSelected(province));
        this.events.on('divisionSelected', (division) => this.onDivisionSelected(division));
        this.events.on('declaredWar', (attacker, defender) => this.onWarDeclared(attacker, defender));
    }

    update(deltaTime) {
        const hoursPassed = deltaTime / (1000 * 60 * 60) * this.speed;
        
        // Обновление всех менеджеров
        this.divisionManager.update(hoursPassed);
        this.resourceManager.update(hoursPassed);
        this.diplomacyManager.update(hoursPassed);
        this.productionManager.update(hoursPassed);
        this.researchManager.update(hoursPassed);
        this.combatManager.update(hoursPassed);
        this.clock.advance(hoursPassed);
        
        // Ежедневные события
        if (this.clock.isNewDay()) {
            this.onNewDay();
        }
        
        // Ежемесячные события
        if (this.clock.isNewMonth()) {
            this.onNewMonth();
        }
    }

    onNewDay() {
        this.resourceManager.dailyTick();
        this.productionManager.dailyTick();
        this.diplomacyManager.dailyTick();
    }

    onNewMonth() {
        this.researchManager.monthlyTick();
        this.manpowerUpdate();
    }

    manpowerUpdate() {
        this.countries.forEach(country => {
            country.manpower += country.manpowerGrowth;
            country.manpower = Math.min(country.manpower, country.maxManpower);
        });
    }

    render(ctx) {
        this.map.render(ctx);
        this.divisionManager.render(ctx);
        this.combatManager.render(ctx);
        this.renderUI();
    }
}

// core/EventBus.js
class EventBus {
    constructor() {
        this.events = new Map();
    }

    on(event, callback) {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }
        this.events.get(event).push(callback);
    }

    emit(event, data) {
        if (this.events.has(event)) {
            this.events.get(event).forEach(callback => callback(data));
        }
    }

    off(event, callback) {
        if (this.events.has(event)) {
            this.events.set(event, this.events.get(event).filter(cb => cb !== callback));
        }
    }
}

// core/GameClock.js
class GameClock {
    constructor(startDate = new Date(1936, 0, 1)) {
        this.date = startDate;
        this.totalHours = 0;
        this.lastDay = startDate.getDate();
        this.lastMonth = startDate.getMonth();
    }

    advance(hours) {
        this.totalHours += hours;
        this.date.setHours(this.date.getHours() + Math.floor(hours));
    }

    isNewDay() {
        const currentDay = this.date.getDate();
        if (currentDay !== this.lastDay) {
            this.lastDay = currentDay;
            return true;
        }
        return false;
    }

    isNewMonth() {
        const currentMonth = this.date.getMonth();
        if (currentMonth !== this.lastMonth) {
            this.lastMonth = currentMonth;
            return true;
        }
        return false;
    }

    getFormattedDate() {
        return this.date.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit'
        });
    }
}

// ==================== COUNTRY SYSTEM ====================

// models/Country.js
class Country {
    constructor(id, data, gameEngine) {
        this.id = id;
        this.name = data.name;
        this.color = data.color;
        this.ideology = data.ideology;
        this.capital = data.capital;
        this.gameEngine = gameEngine;
        
        // Ресурсы и экономика
        this.manpower = 1000000;
        this.maxManpower = 5000000;
        this.manpowerGrowth = 1000; // в день
        
        this.politicalPower = 100;
        this.stability = 70;
        this.warSupport = 60;
        
        // Дипломатия
        this.relations = new Map();
        this.alliances = [];
        this.wars = [];
        this.guarantees = [];
        this.tradeAgreements = [];
        
        // Провинции и войска
        this.provinces = [];
        this.divisions = [];
        
        // Модификаторы
        modifiers: {
            researchSpeed: 1.0,
            productionEfficiency: 1.0,
            divisionAttack: 1.0,
            divisionDefense: 1.0
        }
    }

    addProvince(province) {
        this.provinces.push(province);
        province.controller = this.id;
        this.calculateManpower();
    }

    removeProvince(province) {
        const index = this.provinces.indexOf(province);
        if (index > -1) {
            this.provinces.splice(index, 1);
        }
        this.calculateManpower();
    }

    calculateManpower() {
        let total = 0;
        this.provinces.forEach(province => {
            total += province.manpower || 10000;
        });
        this.maxManpower = total;
        this.manpower = Math.min(this.manpower, this.maxManpower);
    }

    canDeclareWar(target) {
        // Проверка возможности объявления войны
        if (this.wars.includes(target.id)) return false;
        if (this.ideology === target.ideology && this.ideology !== 'democracy') return false;
        if (this.guarantees.includes(target.id)) return false;
        return this.warSupport > 40;
    }

    addRelation(countryId, value) {
        this.relations.set(countryId, Math.min(200, Math.max(-200, value)));
    }

    modifyRelation(countryId, delta) {
        const current = this.relations.get(countryId) || 0;
        this.addRelation(countryId, current + delta);
    }
}

// ==================== MAP SYSTEM ====================

// map/WorldMap.js
class WorldMap {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.provinces = new Map();
        this.strategicRegions = new Map();
        this.zoom = 1;
        this.offset = { x: 0, y: 0 };
        this.selectedProvince = null;
    }

    async loadMapData(countries) {
        const response = await fetch('/data/provinces.json');
        const data = await response.json();
        
        data.provinces.forEach(provinceData => {
            const province = new Province(provinceData, countries);
            this.provinces.set(province.id, province);
            
            if (provinceData.controller) {
                const country = countries.get(provinceData.controller);
                if (country) country.addProvince(province);
            }
        });

        data.strategicRegions.forEach(regionData => {
            this.strategicRegions.set(regionData.id, new StrategicRegion(regionData));
        });

        this.setupProvinceConnections(data.connections);
    }

    setupProvinceConnections(connections) {
        connections.forEach(([fromId, toId]) => {
            const from = this.provinces.get(fromId);
            const to = this.provinces.get(toId);
            if (from && to) {
                from.connections.push(to);
                to.connections.push(from);
            }
        });
    }

    getProvinceAt(x, y) {
        // Преобразование координат с учетом зума и оффсета
        const mapX = (x - this.offset.x) / this.zoom;
        const mapY = (y - this.offset.y) / this.zoom;
        
        // Поиск провинции по пикселю (упрощенно - в реальности нужно использовать quadtree)
        for (const province of this.provinces.values()) {
            if (this.isPointInProvince(mapX, mapY, province)) {
                return province;
            }
        }
        return null;
    }

    isPointInProvince(x, y, province) {
        // Ray casting algorithm для определения принадлежности точки полигону
        let inside = false;
        for (const path of province.paths) {
            for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
                const xi = path[i][0], yi = path[i][1];
                const xj = path[j][0], yj = path[j][1];
                
                const intersect = ((yi > y) !== (yj > y)) &&
                    (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
        }
        return inside;
    }

    render(ctx) {
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.save();
        ctx.translate(this.offset.x, this.offset.y);
        ctx.scale(this.zoom, this.zoom);
        
        // Рендеринг провинций
        this.provinces.forEach(province => {
            this.renderProvince(ctx, province);
        });
        
        // Рендеринг границ
        this.renderBorders(ctx);
        
        // Рендеринг названий
        this.renderLabels(ctx);
        
        ctx.restore();
    }

    renderProvince(ctx, province) {
        ctx.beginPath();
        
        // Определение цвета провинции
        if (province.controller) {
            const country = province.controller;
            ctx.fillStyle = country.color;
            ctx.globalAlpha = 0.7;
        } else {
            ctx.fillStyle = '#808080';
            ctx.globalAlpha = 1;
        }
        
        // Отрисовка полигонов
        province.paths.forEach(path => {
            ctx.moveTo(path[0][0], path[0][1]);
            for (let i = 1; i < path.length; i++) {
                ctx.lineTo(path[i][0], path[i][1]);
            }
        });
        
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 0.5;
        ctx.stroke();
    }

    renderBorders(ctx) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        
        // Группировка провинций по странам для отрисовки границ
        const countryBorders = new Map();
        
        this.provinces.forEach(province => {
            if (!province.controller) return;
            
            province.connections.forEach(neighbor => {
                if (neighbor.controller !== province.controller) {
                    const borderKey = [province.id, neighbor.id].sort().join('-');
                    if (!countryBorders.has(borderKey)) {
                        countryBorders.set(borderKey, {
                            from: province,
                            to: neighbor
                        });
                    }
                }
            });
        });
        
        ctx.beginPath();
        countryBorders.forEach(border => {
            const fromCenter = this.getProvinceCenter(border.from);
            const toCenter = this.getProvinceCenter(border.to);
            ctx.moveTo(fromCenter.x, fromCenter.y);
            ctx.lineTo(toCenter.x, toCenter.y);
        });
        ctx.stroke();
    }
}

// map/Province.js
class Province {
    constructor(data, countries) {
        this.id = data.id;
        this.name = data.name;
        this.type = data.type; // land, sea, lake
        this.terrain = data.terrain;
        this.controller = countries.get(data.controller) || null;
        this.owner = countries.get(data.owner) || this.controller;
        this.core = data.core ? countries.get(data.core) : null;
        
        this.resources = {
            steel: data.steel || 0,
            aluminum: data.aluminum || 0,
            rubber: data.rubber || 0,
            tungsten: data.tungsten || 0,
            chromium: data.chromium || 0,
            oil: data.oil || 0
        };
        
        this.infrastructure = data.infrastructure || 50;
        this.industry = data.industry || 0;
        this.manpower = data.manpower || 10000;
        this.victoryPoints = data.victoryPoints || 0;
        this.weather = 'clear';
        
        this.paths = data.paths;
        this.connections = [];
        this.units = [];
        
        this.buildings = {
            airBase: data.airBase || 0,
            navalBase: data.navalBase || 0,
            radar: data.radar || 0,
            antiAir: data.antiAir || 0,
            fort: data.fort || 0,
            coastalFort: data.coastalFort || 0
        };
    }

    getLocalModifier(type) {
        let modifier = 1.0;
        
        // Террейн модификаторы
        const terrainModifiers = {
            'plains': { attack: 1.0, defense: 1.0, movement: 1.0 },
            'forest': { attack: 0.9, defense: 1.2, movement: 0.7 },
            'hill': { attack: 0.8, defense: 1.3, movement: 0.6 },
            'mountain': { attack: 0.6, defense: 1.5, movement: 0.4 },
            'urban': { attack: 1.1, defense: 1.4, movement: 0.8 },
            'marsh': { attack: 0.7, defense: 1.1, movement: 0.3 }
        };
        
        if (terrainModifiers[this.terrain]) {
            modifier *= terrainModifiers[this.terrain][type] || 1.0;
        }
        
        // Укрепления
        if (type === 'defense' && this.buildings.fort > 0) {
            modifier *= 1 + (this.buildings.fort * 0.1);
        }
        
        return modifier;
    }
}

// ==================== DIVISION SYSTEM ====================

// military/Division.js
class Division {
    constructor(template, country, position) {
        this.id = crypto.randomUUID();
        this.name = `${template.name} ${Math.floor(Math.random() * 100)}`;
        this.template = template;
        this.country = country;
        this.position = position;
        
        // Состояние
        this.organization = template.baseOrganization;
        this.maxOrganization = template.baseOrganization;
        this.strength = 100;
        this.experience = 0;
        this.fuel = 100;
        this.maxFuel = 100;
        this.supply = 100;
        this.status = 'idle'; // idle, moving, fighting, retreating
        
        // Боевые характеристики (будут пересчитаны)
        this.stats = this.calculateStats();
        
        // Текущие приказы
        this.order = null;
        this.combat = null;
        this.path = [];
        this.movementProgress = 0;
        
        // История
        this.kills = 0;
        this.losses = 0;
        this.battlesFought = 0;
    }

    calculateStats() {
        const stats = {
            softAttack: 0,
            hardAttack: 0,
            breakthrough: 0,
            defense: 0,
            armor: 0,
            piercing: 0,
            speed: 4,
            supplyConsumption: 1,
            fuelConsumption: 0.1,
            reliability: 1.0
        };

        // Суммирование характеристик батальонов
        this.template.battalions.forEach(battalion => {
            stats.softAttack += battalion.softAttack;
            stats.hardAttack += battalion.hardAttack;
            stats.breakthrough += battalion.breakthrough;
            stats.defense += battalion.defense;
            stats.armor += battalion.armor || 0;
            stats.piercing += battalion.piercing || 0;
            stats.supplyConsumption += battalion.supplyConsumption;
        });

        // Модификаторы от поддержки
        this.template.supportCompanies.forEach(company => {
            this.applySupportModifiers(stats, company);
        });

        // Модификаторы от страны
        stats.softAttack *= this.country.modifiers.divisionAttack;
        stats.defense *= this.country.modifiers.divisionDefense;

        return stats;
    }

    applySupportModifiers(stats, company) {
        switch(company.type) {
            case 'engineer':
                stats.defense *= 1.2;
                stats.speed *= 0.9;
                break;
            case 'recon':
                // Бонус к инициативе
                break;
            case 'maintenance':
                stats.reliability *= 1.2;
                break;
            case 'militaryPolice':
                // Бонус к контролю партизан
                break;
            case 'fieldHospital':
                // Снижение потерь
                break;
        }
    }

    moveTo(targetProvince, map) {
        if (this.status === 'fighting') return false;
        
        const path = this.findPath(targetProvince, map);
        if (path.length === 0) return false;

        this.order = {
            type: 'move',
            target: targetProvince,
            path: path,
            currentStep: 0
        };
        this.status = 'moving';
        
        return true;
    }

    findPath(targetProvince, map) {
        // A* алгоритм поиска пути
        const openSet = new Set([this.position]);
        const closedSet = new Set();
        const cameFrom = new Map();
        const gScore = new Map();
        const fScore = new Map();
        
        gScore.set(this.position, 0);
        fScore.set(this.position, this.heuristic(this.position, targetProvince));

        while (openSet.size > 0) {
            const current = this.getLowestFScore(openSet, fScore);
            
            if (current === targetProvince) {
                return this.reconstructPath(cameFrom, current);
            }

            openSet.delete(current);
            closedSet.add(current);

            for (const neighbor of current.connections) {
                if (closedSet.has(neighbor)) continue;
                
                // Проверка можно ли войти
                if (neighbor.controller !== this.country && 
                    neighbor.units.some(u => u.country !== this.country)) {
                    continue; // Враждебная провинция с войсками
                }

                const tentativeGScore = gScore.get(current) + 
                    this.getMovementCost(current, neighbor);

                if (!openSet.has(neighbor)) {
                    openSet.add(neighbor);
                } else if (tentativeGScore >= gScore.get(neighbor)) {
                    continue;
                }

                cameFrom.set(neighbor, current);
                gScore.set(neighbor, tentativeGScore);
                fScore.set(neighbor, tentativeGScore + this.heuristic(neighbor, targetProvince));
            }
        }

        return [];
    }

    getMovementCost(from, to) {
        let cost = 10; // базовое значение
        
        // Модификаторы террейна
        const terrainCost = {
 
