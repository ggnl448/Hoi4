                class OptimizedMap extends WorldMap {
constructor(canvasId) {
super(canvasId);
this.visibleProvinces = new Set();
this.lastRenderTime = 0;
this.frameCount = 0;
this.useWebGL = this.checkWebGLSupport();
if (this.useWebGL) { this.initWebGL(); }
}
checkWebGLSupport() {
try {
const canvas = document.createElement('canvas');
return !!canvas.getContext('webgl2');
} catch(e) { return false; }
}
initWebGL() {
this.gl = this.canvas.getContext('webgl2');
}
updateVisibility() {
const viewport = {
x: -this.offset.x / this.zoom,
y: -this.offset.y / this.zoom,
width: this.canvas.width / this.zoom,
height: this.canvas.height / this.zoom
};
this.visibleProvinces.clear();
this.provinceQuadTree.query(viewport, (province) => {
if (this.isProvinceVisible(province, viewport)) {
this.visibleProvinces.add(province);
}
});
}
render(ctx) {
const now = performance.now();
this.frameCount++;
if (now - this.lastRenderTime > 1000) {
this.fps = this.frameCount;
this.frameCount = 0;
this.lastRenderTime = now;
}
this.updateVisibility();
ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
ctx.save();
ctx.translate(this.offset.x, this.offset.y);
ctx.scale(this.zoom, this.zoom);
const sortedProvinces = Array.from(this.visibleProvinces).sort((a, b) => (a.type === 'sea' ? -1 : 1));
ctx.beginPath();
sortedProvinces.forEach(province => { this.renderProvinceBatch(ctx, province); });
ctx.fill();
ctx.stroke();
ctx.restore();
this.renderFPS(ctx);
}
renderProvinceBatch(ctx, province) {
province.paths.forEach(path => {
ctx.moveTo(path[0][0], path[0][1]);
for (let i = 1; i < path.length; i++) { ctx.lineTo(path[i][0], path[i][1]); }
});
}
}
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
this.divisionManager.update(hoursPassed);
this.resourceManager.update(hoursPassed);
this.diplomacyManager.update(hoursPassed);
this.productionManager.update(hoursPassed);
this.researchManager.update(hoursPassed);
this.combatManager.update(hoursPassed);
this.clock.advance(hoursPassed);
if (this.clock.isNewDay()) { this.onNewDay(); }
if (this.clock.isNewMonth()) { this.onNewMonth(); }
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
class EventBus {
constructor() { this.events = new Map(); }
on(event, callback) {
if (!this.events.has(event)) { this.events.set(event, []); }
this.events.get(event).push(callback);
}
emit(event, data) {
if (this.events.has(event)) { this.events.get(event).forEach(callback => callback(data)); }
}
off(event, callback) {
if (this.events.has(event)) { this.events.get(event).filter(cb => cb !== callback); }
}
}
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
if (currentDay !== this.lastDay) { this.lastDay = currentDay; return true; }
return false;
}
isNewMonth() {
const currentMonth = this.date.getMonth();
if (currentMonth !== this.lastMonth) { this.lastMonth = currentMonth; return true; }
return false;
}
getFormattedDate() {
return this.date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit' });
}
}
class Country {
constructor(id, data, gameEngine) {
this.id = id;
this.name = data.name;
this.color = data.color;
this.ideology = data.ideology;
this.capital = data.capital;
this.gameEngine = gameEngine;
this.manpower = 1000000;
this.maxManpower = 5000000;
this.manpowerGrowth = 1000;
this.politicalPower = 100;
this.stability = 70;
this.warSupport = 60;
this.relations = new Map();
this.alliances = [];
this.wars = [];
this.provinces = [];
this.divisions = [];
}
    }    
