import { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";

// ====== CONFIG ======
const TILE_SIZE = 64;
const GRID_SIZE = 10; // поле NxN
const MARGIN = 1;    // обочина вокруг пути для башен
const BOTTOM_BAR_HEIGHT = 186; // фиксированная высота нижней панели

// ====== UTIL ======
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toRoman(num){
  const map = [
    [1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']
  ];
  let n=num, out='';
  for (const [v,s] of map){ while(n>=v){ out+=s; n-=v; } }
  return out || 'I';
}

// Генерация пути: старт сверху-слева (внутри отступа), база = последняя клетка;
// ограничения: не более 2 вертикалей подряд, горизонтали ограничены (<=4),
// минимальная длина ~50% всех клеток.
function buildRandomPath(seed = Date.now(), opts = {}) {
  const N = GRID_SIZE;
  const rnd = mulberry32(seed);
  const maxVert = opts.maxVert ?? 2;
  const maxHoriz = opts.maxHoriz ?? 4;
  const minLen = opts.minLen ?? Math.floor(N * N * 0.5);

  const path = [];
  const used = new Set();
  const push = (x, y) => {
    const k = `${x},${y}`;
    if (!used.has(k)) {
      used.add(k);
      path.push([x, y]);
      return true;
    }
    return false;
  };

  let y = MARGIN;
  let goRight = true;
  let vStreak = 0;
  push(MARGIN, y); // гарантируем не пустой путь

  while (y < N - 1 - MARGIN) {
    const xStart = goRight ? MARGIN : N - 1 - MARGIN;
    const xEnd = goRight ? N - 1 - MARGIN : MARGIN;
    const xStep = goRight ? 1 : -1;

    let x = xStart;
    let hStreak = 0;
    while (goRight ? x <= xEnd : x >= xEnd) {
      push(x, y);
      hStreak++;
      if (hStreak >= maxHoriz && y < N - 1 - MARGIN) {
        // мини-спуск
        push(x, y + 1);
        y += 1;
        vStreak = Math.min(vStreak + 1, maxVert);
        hStreak = 0;
        if (vStreak >= maxVert) {
          const side = goRight ? -1 : 1;
          const sx = x + side;
          if (sx >= MARGIN && sx <= N - 1 - MARGIN) push(sx, y);
          vStreak = 0;
        }
      }
      x += xStep;
    }

    if (y < N - 1 - MARGIN) {
      const drop = rnd() < 0.5 ? 1 : 2;
      const edgeX = xEnd; // последний реальный x
      for (let k = 1; k <= drop && y + k <= N - 1 - MARGIN; k++) {
        push(edgeX, y + k);
        vStreak++;
        if (vStreak >= maxVert && y + k < N - 1 - MARGIN) {
          const side = edgeX === MARGIN ? 1 : -1;
          const sx = edgeX + side;
          if (sx >= MARGIN && sx <= N - 1 - MARGIN) push(sx, y + k);
          vStreak = 0;
        }
      }
      y += drop;
    }

    goRight = !goRight;
  }

  // доберём до низа, если нужно
  let [cx, cy] = path[path.length - 1];
  const bottom = N - 1 - MARGIN;
  vStreak = 0;
  while (cy < bottom) {
    cy += 1; push(cx, cy); vStreak++;
    if (vStreak >= maxVert && cy < bottom) {
      const side = cx > MARGIN + 1 ? -1 : 1;
      const nx = cx + side;
      if (nx >= MARGIN && nx <= N - 1 - MARGIN) { cx = nx; push(cx, cy); }
      vStreak = 0;
    }
  }

  // добор длины по низу змейкой, с предохранителем
  let dir = (path.length % 2 === 0) ? 1 : -1;
  let hStreak2 = 0;
  let safety = 0;
  while (path.length < minLen && safety++ < N * N * 4) {
    const nx = cx + dir;
    if (nx >= MARGIN && nx <= N - 1 - MARGIN) {
      if (push(cx = nx, cy)) hStreak2++;
      if (hStreak2 >= maxHoriz) {
        if (cy - 1 >= MARGIN) { push(cx, cy - 1); push(cx, cy); }
        hStreak2 = 0;
      }
    } else {
      dir *= -1; hStreak2 = 0;
      if (cy - 1 >= MARGIN) { push(cx, cy - 1); push(cx, cy); }
      else break;
    }
  }

  return path; // последняя клетка — база
}

// ====== WAVES (infinite) ======
function getWaveConf(idx) {
  const enemies = 6 + Math.floor(idx * 1.5);
  const speed = 0.8 + Math.min(0.9, idx * 0.03);
  const hp = 1 + Math.floor(idx / 2);
  return { enemies, speed, hp };
}

// ====== ENEMIES ======
const ENEMY_TYPES = {
  grunt:  { name: 'Гоблин',  color: 0xff3b30, speedMul: 1.0, hpMul: 1.0 },   // базовый
  runner: { name: 'Скаут',   color: 0x00c853, speedMul: 1.4, hpMul: 0.8 },   // быстрый, хрупкий
  tank:   { name: 'Танк',    color: 0x7e57c2, speedMul: 0.7, hpMul: 3.0 },   // медленный, толстый
};

function pickEnemyType(idx) {
  if (idx < 2) return 'grunt';
  const r = Math.random();
  if (r < 0.55) return 'grunt';
  if (r < 0.85) return 'runner';
  return 'tank';
}

// ====== SPRITE TOWERS (drawn) ======
const TOWER_SVGS = {
  archer: `<?xml version='1.0'?><svg xmlns='http://www.w3.org/2000/svg' width='128' height='128' viewBox='0 0 128 128'>
    <defs>
      <linearGradient id='g1' x1='0' x2='0' y1='0' y2='1'>
        <stop offset='0%' stop-color='#9ac1ff'/>
        <stop offset='100%' stop-color='#467bff'/>
      </linearGradient>
    </defs>
    <rect x='24' y='80' width='80' height='20' rx='10' fill='#5b6d7a' opacity='0.25'/>
    <circle cx='64' cy='64' r='30' fill='url(#g1)' stroke='#0c2a66' stroke-width='4'/>
    <rect x='58' y='28' width='12' height='20' rx='3' fill='#0c2a66'/>
    <circle cx='64' cy='54' r='6' fill='#ffe082' stroke='#0c2a66' stroke-width='3'/>
    <path d='M92 70c-10 12-36 12-56 0' fill='none' stroke='#0c2a66' stroke-width='4' stroke-linecap='round'/>
  </svg>`,
  cannon: `<?xml version='1.0'?><svg xmlns='http://www.w3.org/2000/svg' width='128' height='128' viewBox='0 0 128 128'>
    <defs>
      <linearGradient id='g2' x1='0' x2='0' y1='0' y2='1'>
        <stop offset='0%' stop-color='#ffd08a'/>
        <stop offset='100%' stop-color='#ff8a00'/>
      </linearGradient>
    </defs>
    <rect x='22' y='82' width='84' height='20' rx='10' fill='#5b6d7a' opacity='0.25'/>
    <circle cx='64' cy='64' r='30' fill='url(#g2)' stroke='#7a3b00' stroke-width='4'/>
    <rect x='64' y='40' width='28' height='10' rx='5' fill='#7a3b00'/>
    <circle cx='64' cy='64' r='10' fill='#3e1d00'/>
  </svg>`,
  mage: `<?xml version='1.0'?><svg xmlns='http://www.w3.org/2000/svg' width='128' height='128' viewBox='0 0 128 128'>
    <defs>
      <radialGradient id='g3' cx='0.5' cy='0.4' r='0.7'>
        <stop offset='0%' stop-color='#cfa8ff'/>
        <stop offset='100%' stop-color='#7a00ff'/>
      </radialGradient>
    </defs>
    <rect x='24' y='82' width='80' height='20' rx='10' fill='#5b6d7a' opacity='0.25'/>
    <circle cx='64' cy='64' r='30' fill='url(#g3)' stroke='#2b0052' stroke-width='4'/>
    <path d='M52 44l24 0l-12 22z' fill='#fff' opacity='0.8'/>
    <circle cx='64' cy='52' r='6' fill='#fff'/>
  </svg>`
};
function svgToURI(svg){ return 'data:image/svg+xml;base64,' + btoa(svg); }

// ====== TOWERS ======
const TOWER_TYPES = {
  archer: { name: "Лучник", cost: 50, range: TILE_SIZE * 2.2, cooldownSec: 0.75, bulletSpeed: 220, color: 0x1e90ff, damage: 1, upgradeCost: 40, dmgType: 'physical' },
  cannon: { name: "Пушка",  cost: 80, range: TILE_SIZE * 2.6, cooldownSec: 1.20, bulletSpeed: 180, color: 0xffa500, damage: 2, upgradeCost: 60, dmgType: 'explosive' },
  mage:   { name: "Маг",    cost: 100,range: TILE_SIZE * 3.0, cooldownSec: 0.90, bulletSpeed: 240, color: 0x7a00ff, damage: 1.5, upgradeCost: 70, dmgType: 'arcane' },
};

// Прогресс апгрейдов: 10 уровней с подуровнями
const SUBLEVELS_PER_LEVEL = [3,5,8,11,13,15,17,19,22,25];

export default function App() {
  // DOM
  const mountRef = useRef(null);

  // PIXI и слои
  const appRef = useRef(null);
  const cameraRef = useRef(null);
  const gridLayerRef   = useRef(null);
  const towerLayerRef  = useRef(null);
  const enemyLayerRef  = useRef(null);
  const bulletLayerRef = useRef(null);
  const uiLayerRef     = useRef(null);
  const texturesRef    = useRef({});

  // Состояние (refs)
  const goldRef  = useRef(150);
  const livesRef = useRef(5);
  const waveRef  = useRef(0);
  const breakRef = useRef(0);
  const isWaveActiveRef = useRef(false);

  const selectedTypeRef = useRef(null);
  const towersRef  = useRef([]);
  const enemiesRef = useRef([]);
  const bulletsRef = useRef([]);
  const occupiedRef = useRef(new Set());
  const spawnRef = useRef({ toSpawn: 0, timerSec: 0 });

  // UI стейты
  const [gold, setGold]       = useState(goldRef.current);
  const [lives, setLives]     = useState(livesRef.current);
  const [wave, setWave]       = useState(waveRef.current);
  const [breakTime, setBreak] = useState(Math.ceil(breakRef.current));
  const [selectedType, setSelectedType] = useState(null);
  const [selectedTower, setSelectedTower] = useState(null);

  const radiusPreviewRef = useRef(null);
  const selectedRadiusRef = useRef(null);

  // Зум/пан
  const isDraggingRef = useRef(false);
  const lastPosRef = useRef({x:0,y:0});
  const scaleRef = useRef(1);

  // Путь
  const enemyPathRef = useRef([]);
  const pathSetRef   = useRef(new Set());
  const STARTRef     = useRef([MARGIN, MARGIN]);
  const BASERef      = useRef([MARGIN, GRID_SIZE - 1 - MARGIN]);

  // Инициализация PIXI
  useEffect(() => {
    try {
      const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
      tg?.ready?.();
      tg?.expand?.();

      // генерим путь
      const enemyPath = buildRandomPath(Date.now());
      const pathSet = new Set(enemyPath.map(([x, y]) => `${x},${y}`));
      enemyPathRef.current = enemyPath;
      pathSetRef.current = pathSet;
      STARTRef.current = enemyPath[0];
      BASERef.current  = enemyPath[enemyPath.length - 1];

      const app = new PIXI.Application({
        width: TILE_SIZE * GRID_SIZE,
        height: TILE_SIZE * GRID_SIZE,
        backgroundColor: 0xeeeeee,
        antialias: true,
        autoDensity: true,
        resolution: Math.max(1, window.devicePixelRatio || 1),
      });
      appRef.current = app;
      mountRef.current?.appendChild(app.view);

      // подготовим текстуры башен
      texturesRef.current = {
        archer: PIXI.Texture.from(svgToURI(TOWER_SVGS.archer)),
        cannon: PIXI.Texture.from(svgToURI(TOWER_SVGS.cannon)),
        mage:   PIXI.Texture.from(svgToURI(TOWER_SVGS.mage)),
      };

      // Камера (контейнер мира)
      const camera = new PIXI.Container();
      cameraRef.current = camera;
      app.stage.addChild(camera);

      function fit() {
        const baseW = TILE_SIZE * GRID_SIZE;
        const baseH = TILE_SIZE * GRID_SIZE;
        const maxW = Math.min(window.innerWidth, tg?.viewportWidth ?? Infinity);
        const maxH = Math.min(window.innerHeight, tg?.viewportHeight ?? Infinity);
        const scale = Math.min(maxW / baseW, maxH / baseH, 1);
        app.renderer.resize(Math.ceil(baseW * scale), Math.ceil(baseH * scale));
        scaleRef.current = scale;
        camera.scale.set(scale);
        camera.position.set(0,0);
      }
      fit();
      window.addEventListener("resize", fit);
      tg?.onEvent?.("viewportChanged", fit);

      const gridLayer   = new PIXI.Container();
      const towerLayer  = new PIXI.Container();
      const enemyLayer  = new PIXI.Container();
      const bulletLayer = new PIXI.Container();
      const uiLayer     = new PIXI.Container();
      gridLayerRef.current   = gridLayer;
      towerLayerRef.current  = towerLayer;
      enemyLayerRef.current  = enemyLayer;
      bulletLayerRef.current = bulletLayer;
      uiLayerRef.current     = uiLayer;
      camera.addChild(gridLayer, towerLayer, enemyLayer, bulletLayer, uiLayer);

      // Сетка
      const START = STARTRef.current;
      const BASE  = BASERef.current;
      const pathSet2 = pathSetRef.current;
      for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
          const isPath  = pathSet2.has(`${x},${y}`);
          const isStart = x === START[0] && y === START[1];
          const isBase  = x === BASE[0]  && y === BASE[1];
          const cell = new PIXI.Graphics();
          cell.lineStyle(1, isPath ? 0x88aaff : 0x999999);
          const fill = isStart ? 0xdfffe0 : isBase ? 0xffe0e0 : isPath ? 0xeef2ff : 0xffffff;
          cell.beginFill(fill);
          cell.drawRect(0, 0, TILE_SIZE, TILE_SIZE);
          cell.endFill();
          cell.x = x * TILE_SIZE; cell.y = y * TILE_SIZE;
          cell.eventMode = "static"; cell.cursor = "pointer";
          cell.on("pointerover", () => showRadiusPreview(x, y));
          cell.on("pointerout", hideRadiusPreview);
          cell.on("pointerdown", () => {
            const typeKey = selectedTypeRef.current; if (!typeKey) return;
            if (isPath) return;
            const k = `${x},${y}`; if (occupiedRef.current.has(k)) return;
            const conf = TOWER_TYPES[typeKey]; if (goldRef.current < conf.cost) return;
            placeTower(x, y, typeKey);
          });
          gridLayer.addChild(cell);
        }
      }

      // Иконки старта/базы
      const startIcon = new PIXI.Text('🚩', { fontSize: Math.floor(TILE_SIZE * 0.8) });
      startIcon.anchor.set(0.5);
      startIcon.x = START[0] * TILE_SIZE + TILE_SIZE / 2;
      startIcon.y = START[1] * TILE_SIZE + TILE_SIZE / 2;
      uiLayer.addChild(startIcon);

      const baseIcon = new PIXI.Text('🏰', { fontSize: Math.floor(TILE_SIZE * 0.8) });
      baseIcon.anchor.set(0.5);
      baseIcon.x = BASE[0] * TILE_SIZE + TILE_SIZE / 2;
      baseIcon.y = BASE[1] * TILE_SIZE + TILE_SIZE / 2;
      uiLayer.addChild(baseIcon);

      // Зум колесом
      app.view.addEventListener('wheel', (e)=>{
        e.preventDefault();
        const cam = cameraRef.current; if(!cam) return;
        const old = scaleRef.current;
        const zoom = e.deltaY < 0 ? 1.1 : 0.9;
        let next = old * zoom;
        const min=0.4, max=3.0;
        next = Math.max(min, Math.min(max, next));
        if (next === old) return;
        // зум к курсору
        const rect = app.view.getBoundingClientRect();
        const mx = (e.clientX - rect.left);
        const my = (e.clientY - rect.top);
        const wx = (mx - cam.position.x) / old;
        const wy = (my - cam.position.y) / old;
        cam.position.set(mx - wx*next, my - wy*next);
        cam.scale.set(next);
        scaleRef.current = next;
      }, { passive:false });

      // Панорамирование перетаскиванием
      app.view.addEventListener('pointerdown', (e)=>{
        isDraggingRef.current = true; lastPosRef.current = { x: e.clientX, y: e.clientY };
      });
      window.addEventListener('pointerup', ()=>{ isDraggingRef.current=false; });
      window.addEventListener('pointermove', (e)=>{
        if (!isDraggingRef.current) return;
        const cam = cameraRef.current; if(!cam) return;
        const dx = e.clientX - lastPosRef.current.x;
        const dy = e.clientY - lastPosRef.current.y;
        cam.position.x += dx;
        cam.position.y += dy;
        lastPosRef.current = { x: e.clientX, y: e.clientY };
      });

      app.ticker.add(tick);

      return () => {
        window.removeEventListener("resize", fit);
        tg?.offEvent?.("viewportChanged", fit);
        app.ticker.remove(tick);
        app.destroy(true, true);
      };
    } catch (e) {
      console.error("Init error", e);
      alert("Init error: " + (e?.message || e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // UI sync
  useEffect(() => {
    const id = setInterval(() => {
      setGold(goldRef.current);
      setLives(livesRef.current);
      setWave(waveRef.current);
      setBreak(Math.max(0, Math.ceil(breakRef.current)));
      setSelectedTower(t => (t ? {...t} : t)); // обновляем панель выбора
    }, 100);
    return () => clearInterval(id);
  }, []);

  // ====== GAME FUNCS ======
  function createTowerUI(x, y, conf){
    const cont = new PIXI.Container();

    // Прогресс-бар подуровней
    const barBg = new PIXI.Graphics();
    const w = Math.floor(TILE_SIZE*0.9), h = 6;
    barBg.beginFill(0x222222, 0.7).drawRoundedRect(-w/2, -TILE_SIZE*0.55, w, h, 3).endFill();

    const barFill = new PIXI.Graphics();

    // Текст уровня слева (римскими цифрами)
    const lvlText = new PIXI.Text('I', { fontSize: Math.floor(TILE_SIZE*0.35), fill: 0x111111 });
    lvlText.anchor.set(1, 0.5);
    lvlText.x = -w/2 - 6; lvlText.y = -TILE_SIZE*0.55 + h/2;

    // Деления на баре
    const ticks = new PIXI.Graphics();

    cont.addChild(barBg, barFill, ticks, lvlText);
    cont.x = x; cont.y = y;
    uiLayerRef.current.addChild(cont);

    return { uiCont: cont, barBg, barFill, lvlText, ticks, w, h };
  }

  function redrawTowerProgress(tw){
    const lvl = tw.level; const sub = tw.sublevel;
    const need = SUBLEVELS_PER_LEVEL[Math.min(lvl-1, SUBLEVELS_PER_LEVEL.length-1)];
    const { barFill, lvlText, ticks, w, h } = tw.ui;

    // текст уровня
    lvlText.text = toRoman(lvl);

    // заливка по прогрессу
    const ratio = Math.min(1, sub / need);
    barFill.clear();
    barFill.beginFill(0x00c853).drawRoundedRect(-w/2+1, -TILE_SIZE*0.55+1, Math.max(0, (w-2)*ratio), h-2, 2).endFill();

    // рисуем деления
    ticks.clear();
    ticks.lineStyle(1, 0xffffff, 0.65);
    for (let i=1;i<need;i++){
      const x = -w/2 + (w*i/need);
      ticks.moveTo(x, -TILE_SIZE*0.55);
      ticks.lineTo(x, -TILE_SIZE*0.55 + h);
    }
  }

  function levelUp(tw){
    // бафы на уровень
    tw.conf.range *= 1.12;
    tw.conf.damage *= 1.18;
    tw.conf.cooldownSec = Math.max(0.35, tw.conf.cooldownSec * 0.94);

    // визуальный всплеск
    const flash = new PIXI.Graphics();
    flash.lineStyle(4, 0x00c853, 0.9);
    flash.drawCircle(0,0, TILE_SIZE*0.6);
    flash.x = tw.x; flash.y = tw.y;
    uiLayerRef.current.addChild(flash);
    let a = 1;
    const app = appRef.current;
    const fade = (d)=>{
      const dt = typeof d === 'number' ? d : (d?.deltaTime ?? 1);
      a -= (dt/60)*1.2; flash.alpha = Math.max(0,a);
      if (a<=0){ uiLayerRef.current.removeChild(flash); flash.destroy(); app.ticker.remove(fade); }
    };
    app.ticker.add(fade);
  }

  function placeTower(cx, cy, typeKey) {
    const conf = { ...TOWER_TYPES[typeKey] };

    // контейнер башни (тень + спрайт)
    const cont = new PIXI.Container();
    cont.x = cx * TILE_SIZE + TILE_SIZE / 2;
    cont.y = cy * TILE_SIZE + TILE_SIZE / 2;

    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x000000, 0.18).drawEllipse(0, TILE_SIZE*0.28, TILE_SIZE*0.32, TILE_SIZE*0.14).endFill();
    cont.addChild(shadow);

    const tex = texturesRef.current[typeKey] || PIXI.Texture.WHITE;
    const sprite = new PIXI.Sprite(tex);
    sprite.anchor.set(0.5);
    const targetSize = TILE_SIZE * 0.86;
    const scale = targetSize / 128; // SVG 128x128
    sprite.scale.set(scale);
    cont.addChild(sprite);

    // лёгкая анимация покачивания
    cont._phase = Math.random()*Math.PI*2;

    // выбор по клику
    cont.eventMode = "static";
    cont.cursor = "pointer";
    cont.on("pointerdown", () => selectTowerBySprite(cont));

    towerLayerRef.current.addChild(cont);

    const ui = createTowerUI(cont.x, cont.y, conf);

    const tower = {
      x: cont.x,
      y: cont.y,
      conf,
      cooldownLeft: 0,
      sprite: cont,
      ui,
      level: 1,
      sublevel: 0,
      invested: conf.cost,
    };
    towersRef.current.push(tower);
    redrawTowerProgress(tower);

    occupiedRef.current.add(`${cx},${cy}`);
    goldRef.current -= conf.cost;
  }

  function upgradeTowerByClick(sprite) {
    const tw = towersRef.current.find(t => t.sprite === sprite);
    if (!tw) return;
    upgradeTower(tw);
  }

  function selectTowerBySprite(sprite){
    const tw = towersRef.current.find(t => t.sprite === sprite);
    if (!tw) return;
    // снять радиус с прошлого выбора
    hideSelectedRadius();
    setSelectedTower(tw);
    showSelectedRadius(tw);
  }

  function upgradeTower(tw){
    const cost = tw.conf.upgradeCost ?? 50; if (goldRef.current < cost) return;
    goldRef.current -= cost; tw.invested += cost;
    const maxLevel = 10;
    const need = SUBLEVELS_PER_LEVEL[Math.min(tw.level-1, SUBLEVELS_PER_LEVEL.length-1)];
    tw.sublevel += 1;
    const ping = new PIXI.Graphics();
    ping.beginFill(0xffffff, 0.5).drawCircle(0,0,TILE_SIZE/3).endFill();
    ping.x = tw.x; ping.y = tw.y; uiLayerRef.current.addChild(ping);
    let a=0.5; const app = appRef.current; const fade=(d)=>{ const dt=typeof d==='number'?d:(d?.deltaTime??1); a-=(dt/60)*2; ping.alpha=Math.max(0,a); if(a<=0){ uiLayerRef.current.removeChild(ping); ping.destroy(); app.ticker.remove(fade);} }; app.ticker.add(fade);
    if (tw.sublevel >= need && tw.level < maxLevel){ tw.level += 1; tw.sublevel = 0; levelUp(tw); }
    redrawTowerProgress(tw);
    // если эта башня выбрана — обновим круг радиуса
    if (selectedTower === tw) showSelectedRadius(tw);
    setSelectedTower({...tw});
  }

  function sellTower(tw){
    // возврат: 50% базовой цены + 25% вложений в апгрейды
    const base = tw.conf.cost||0; const extra = Math.max(0, (tw.invested||base) - base);
    const refund = Math.round(base*0.5 + extra*0.25);
    goldRef.current += refund;
    // remove sprites
    if (tw.ui?.uiCont) { uiLayerRef.current.removeChild(tw.ui.uiCont); tw.ui.uiCont.destroy({children:true}); }
    if (tw.sprite?.parent) { towerLayerRef.current.removeChild(tw.sprite); tw.sprite.destroy(); }
    const idx = towersRef.current.indexOf(tw); if (idx!==-1) towersRef.current.splice(idx,1);
    hideSelectedRadius();
    setSelectedTower(null);
  }

  function startWave() {
    if (isWaveActiveRef.current) return;
    const conf = getWaveConf(waveRef.current);
    spawnRef.current.toSpawn = conf.enemies;
    spawnRef.current.timerSec = 0.5;
    isWaveActiveRef.current = true;
    waveRef.current += 1;
  }

  function spawnEnemy() {
    const idx = Math.max(0, waveRef.current - 1);
    const base = getWaveConf(idx);
    const typeKey = pickEnemyType(idx);
    const et = ENEMY_TYPES[typeKey] ?? ENEMY_TYPES.grunt;

    const hpMax = Math.max(1, Math.round(base.hp * et.hpMul));
    const speed = base.speed * et.speedMul;

    const cont = new PIXI.Container();

    const body = new PIXI.Graphics();
    body.beginFill(et.color); body.drawCircle(0, 0, TILE_SIZE / 4); body.endFill();
    cont.addChild(body);

    // HP bar (как у башен)
    const barBg = new PIXI.Graphics();
    const w = Math.floor(TILE_SIZE*0.9), h = 6;
    barBg.beginFill(0x222222, 0.7).drawRoundedRect(-w/2, -TILE_SIZE*0.55, w, h, 3).endFill();
    const barFill = new PIXI.Graphics();
    const ticks = new PIXI.Graphics();
    ticks.lineStyle(1, 0xffffff, 0.65);
    const segs = Math.max(1, Math.min(20, hpMax));
    for (let i=1;i<segs;i++){
      const x = -w/2 + (w*i/segs);
      ticks.moveTo(x, -TILE_SIZE*0.55);
      ticks.lineTo(x, -TILE_SIZE*0.55 + h);
    }
    cont.addChild(barBg, barFill, ticks);

    const updateHp = (hp)=>{
      const ratio = Math.max(0, Math.min(1, hp / hpMax));
      barFill.clear();
      barFill.beginFill(0xff4d4f).drawRoundedRect(-w/2+1, -TILE_SIZE*0.55+1, Math.max(0,(w-2)*ratio), h-2, 2).endFill();
    };
    updateHp(hpMax);

    enemyLayerRef.current.addChild(cont);

    enemiesRef.current.push({ sprite: cont, body, typeKey, pathIndex: 0, speed, hp: hpMax, hpMax, updateHp });
  }

  function fireBullet(tower, target) {
    const sprite = new PIXI.Graphics();
    sprite.beginFill(0xffd60a); sprite.drawCircle(0,0,5); sprite.endFill();
    sprite.x = tower.x; sprite.y = tower.y; bulletLayerRef.current.addChild(sprite);
    const dx = target.sprite.x - tower.x, dy = target.sprite.y - tower.y; const d = Math.hypot(dx,dy)||1; const speed = tower.conf.bulletSpeed;
    bulletsRef.current.push({ sprite, vx:(dx/d)*speed, vy:(dy/d)*speed, speed, target, damage:tower.conf.damage });
  }

  function showOverlay(text) {
    hideOverlay(); const app = appRef.current; const overlay = new PIXI.Container(); overlay.name = 'overlay';
    const bg = new PIXI.Graphics(); bg.beginFill(0x000000,0.6).drawRect(0,0,app.view.width, app.view.height).endFill();
    const label = new PIXI.Text(text,{ fill:0xffffff, fontSize:28 }); label.anchor.set(0.5); label.x=app.view.width/2; label.y=app.view.height/2;
    overlay.addChild(bg, label); uiLayerRef.current.addChild(overlay);
  }
  function hideOverlay(){ const layer=uiLayerRef.current; const old=layer?.getChildByName?.('overlay'); if(old){ layer.removeChild(old); old.destroy({children:true}); } }

  function showRadiusPreview(cx, cy){ const typeKey=selectedTypeRef.current; if(!typeKey) return; hideRadiusPreview(); const conf=TOWER_TYPES[typeKey]; const g=new PIXI.Graphics(); g.lineStyle(2,0x00cc66,0.35); g.beginFill(0x00cc66,0.08); g.drawCircle(cx*TILE_SIZE+TILE_SIZE/2, cy*TILE_SIZE+TILE_SIZE/2, conf.range); g.endFill(); g.name='radiusPreview'; uiLayerRef.current.addChild(g); radiusPreviewRef.current=g; }
  function hideRadiusPreview(){ const g=radiusPreviewRef.current; if(g?.parent){ g.parent.removeChild(g); g.destroy(); } radiusPreviewRef.current=null; }
  function showSelectedRadius(tw){ hideSelectedRadius(); if(!tw) return; const g=new PIXI.Graphics(); g.lineStyle(2,0x00cc66,0.5); g.beginFill(0x00cc66,0.08); g.drawCircle(tw.x, tw.y, tw.conf.range); g.endFill(); selectedRadiusRef.current=g; uiLayerRef.current.addChild(g); }
  function hideSelectedRadius(){ const g=selectedRadiusRef.current; if(g?.parent){ g.parent.removeChild(g); g.destroy(); } selectedRadiusRef.current=null; }

  // Главный тик
  function tick(d){
    const app = appRef.current; if(!app) return;
    const dt = typeof d === 'number' ? d : (d?.deltaTime ?? 1);
    const dtSec = dt/60;
    const enemyPath = enemyPathRef.current;

    // перерыв и автозапуск
    if (!isWaveActiveRef.current && breakRef.current > 0) {
      breakRef.current = Math.max(0, breakRef.current - dtSec);
      if (breakRef.current <= 0) { breakRef.current = 0; startWave(); }
    }

    // спавн волны
    if (isWaveActiveRef.current) {
      if (spawnRef.current.toSpawn > 0) {
        spawnRef.current.timerSec -= dtSec;
        if (spawnRef.current.timerSec <= 0) {
          spawnEnemy();
          spawnRef.current.toSpawn -= 1;
          spawnRef.current.timerSec = 0.75;
        }
      }
      if (spawnRef.current.toSpawn === 0 && enemiesRef.current.length === 0) {
        isWaveActiveRef.current = false;
        breakRef.current = 8;
      }
    }

    // движение врагов
    for (let i = enemiesRef.current.length - 1; i >= 0; i--) {
      const en = enemiesRef.current[i];
      if (!en.sprite?.parent) { enemiesRef.current.splice(i,1); continue; }
      const iCell = Math.floor(en.pathIndex);
      if (iCell < enemyPath.length - 1) {
        const t = en.pathIndex - iCell;
        const [ax, ay] = enemyPath[iCell];
        const [bx, by] = enemyPath[iCell + 1];
        en.sprite.x = (ax + (bx-ax)*t)*TILE_SIZE + TILE_SIZE/2;
        en.sprite.y = (ay + (by-ay)*t)*TILE_SIZE + TILE_SIZE/2;
        en.pathIndex += en.speed * dtSec;
      } else {
        enemyLayerRef.current.removeChild(en.sprite);
        en.sprite.destroy(); enemiesRef.current.splice(i,1);
        livesRef.current -= 1;
        if (livesRef.current <= 0) { showOverlay('💀 Game Over'); app.ticker.stop(); }
      }
    }

    // стрельба и анимация башен
    towersRef.current.forEach(t => {
      // анимация башни: лёгкое «дыхание»
      if (t.sprite && typeof t.sprite._phase === 'number'){
        t.sprite._phase += dtSec * 2.0;
        const offset = Math.sin(t.sprite._phase) * 1.2;
        t.sprite.y = t.y + offset;
      }

      if (t.cooldownLeft > 0) { t.cooldownLeft = Math.max(0, t.cooldownLeft - dtSec); return; }
      let target=null, best=Infinity;
      enemiesRef.current.forEach(en => { if(!en.sprite?.parent) return; const dx=en.sprite.x - t.x; const dy=en.sprite.y - t.y; const d=Math.hypot(dx,dy); if(d<=t.conf.range && d<best){ best=d; target=en; } });
      if (target) { fireBullet(t, target); t.cooldownLeft = t.conf.cooldownSec; }
    });

    // пули
    for (let i = bulletsRef.current.length - 1; i >= 0; i--) {
      const b = bulletsRef.current[i];
      if (!b.target || !enemiesRef.current.includes(b.target) || !b.target.sprite?.parent) {
        bulletLayerRef.current.removeChild(b.sprite); b.sprite.destroy(); bulletsRef.current.splice(i,1); continue;
      }
      const dx = b.target.sprite.x - b.sprite.x; const dy = b.target.sprite.y - b.sprite.y; const d2 = Math.hypot(dx,dy)||1; const speed=b.speed;
      b.vx = (dx/d2)*speed; b.vy = (dy/d2)*speed;
      b.sprite.x += b.vx * dtSec; b.sprite.y += b.vy * dtSec;
      if (Math.hypot(dx,dy) < 10) {
        bulletLayerRef.current.removeChild(b.sprite); b.sprite.destroy(); bulletsRef.current.splice(i,1);
        b.target.hp -= b.damage;
        if (b.target.hp > 0) {
          if (b.target.updateHp) b.target.updateHp(b.target.hp);
        } else {
          enemyLayerRef.current.removeChild(b.target.sprite);
          b.target.sprite.destroy();
          const idx2 = enemiesRef.current.indexOf(b.target);
          if (idx2 !== -1) enemiesRef.current.splice(idx2, 1);
          goldRef.current += 10;
        }
      }
    }
  }

  // UI helpers
  function selectTower(typeKey){ selectedTypeRef.current = typeKey; setSelectedType(typeKey); }
  function deselectTower(){ hideSelectedRadius(); setSelectedTower(null); }

  const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
  const isDark = tg?.colorScheme === 'dark';
  const panelStyle = {
    display:'flex', gap:16, alignItems:'center', padding:'8px 12px', borderRadius:8,
    background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    color: isDark ? '#fff' : '#111',
    boxShadow: isDark ? '0 2px 10px rgba(0,0,0,0.3)' : '0 2px 10px rgba(0,0,0,0.1)',
    fontSize:'18px', position:'sticky', top:0, zIndex:10
  };

  const startDisabled = isWaveActiveRef.current;

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
      <div style={panelStyle}>
        <div>💰 {gold}</div>
        <div>❤️ {lives}</div>
        <div>🌊 Волна: {wave}</div>
        {isWaveActiveRef.current ? <div>⏳ Волна идёт</div> : <div>☕ Перерыв: {breakTime}s</div>}
      </div>

      <div ref={mountRef} style={{ background:'#ddd', borderRadius:8, width:'100%', maxWidth:'100vw', touchAction:'none' }} />

      {/* отступ под фиксированную нижнюю панель */}
      <div style={{ height: `calc(${BOTTOM_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px))` }} />

      {/* Нижняя панель: строить ИЛИ инфо о башне */}
      {!selectedTower ? (
        <div style={{ position:'fixed', left:0, right:0, bottom:0, zIndex:20, background:'#fff', borderTop:'1px solid #ccc', boxShadow:'0 -2px 10px rgba(0,0,0,0.12)', padding:`10px 12px calc(10px + env(safe-area-inset-bottom, 0px))`, height: BOTTOM_BAR_HEIGHT, display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', justifyContent:'center' }}>
            {Object.entries(TOWER_TYPES).map(([key, t]) => {
              const disabled = gold < t.cost;
              return (
                <button key={key} disabled={disabled} onClick={() => selectTower(key)}
                  style={{ padding:'8px 12px', background: selectedType===key?'#d0ebff':'#fff', border:'1px solid #ccc', borderRadius:8, cursor: disabled?'not-allowed':'pointer', opacity: disabled?0.6:1 }}>
                  {t.name} ({t.cost})
                </button>
              );
            })}
            <button onClick={() => selectTower(null)} style={{ padding:'8px 12px', border:'1px solid #ccc', borderRadius:8, background:'#fff' }}>❌ Отмена</button>
          </div>
          <div style={{ display:'flex', justifyContent:'center' }}>
            <button onClick={() => { hideOverlay(); breakRef.current = 0; startWave(); }} disabled={startDisabled}
              style={{ padding:'10px 16px', fontSize:16, background: startDisabled ? '#9aa' : '#28a745', color:'#fff', border:'none', borderRadius:10, cursor: startDisabled ? 'not-allowed' : 'pointer' }}>
              🚀 Начать волну
            </button>
          </div>
        </div>
      ) : (
        <div style={{ position:'fixed', left:0, right:0, bottom:0, zIndex:20, background:'#fff', borderTop:'1px solid #ccc', boxShadow:'0 -2px 10px rgba(0,0,0,0.12)', padding:`10px 12px calc(10px + env(safe-area-inset-bottom, 0px))`, height: BOTTOM_BAR_HEIGHT, display:'flex', gap:12, alignItems:'center' }}>
          <div style={{minWidth:110}}>
            <div style={{fontWeight:700}}>{selectedTower.conf.name}</div>
            <div>Уровень: {toRoman(selectedTower.level)}</div>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'auto auto', columnGap:12, rowGap:4, flex:1, minWidth:0}}>
            <div>Тип урона</div><div style={{overflow:'hidden', textOverflow:'ellipsis'}}>{selectedTower.conf.dmgType}</div>
            <div>Урон</div><div>{selectedTower.conf.damage.toFixed(1)}</div>
            <div>Скорость атаки</div><div>{(1/selectedTower.conf.cooldownSec).toFixed(2)}/с</div>
            <div>Дальность</div><div>{Math.round(selectedTower.conf.range)}</div>
            <div>Подуровень</div><div>{selectedTower.sublevel}/{SUBLEVELS_PER_LEVEL[Math.min(selectedTower.level-1, SUBLEVELS_PER_LEVEL.length-1)]}</div>
            <div>Вложено</div><div>{selectedTower.invested}</div>
          </div>
          <div style={{display:'flex', gap:8}}>
            <button onClick={() => upgradeTower(selectedTower)} style={{padding:'10px 12px', background:'#28a745', color:'#fff', border:'none', borderRadius:8}}>Улучшить</button>
            <button onClick={() => sellTower(selectedTower)} style={{padding:'10px 12px', background:'#ffc107', color:'#111', border:'none', borderRadius:8}}>Продать</button>
            <button onClick={deselectTower} style={{padding:'10px 12px', background:'#e0e0e0', color:'#111', border:'none', borderRadius:8}}>Снять</button>
          </div>
        </div>
      )}
    </div>
  );
}
