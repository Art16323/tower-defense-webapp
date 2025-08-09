import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';

const TILE_SIZE = 64;
const GRID_SIZE = 5;

// Маршрут по клеткам
const enemyPath = [
  [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
  [4, 1], [4, 2], [3, 2], [2, 2], [1, 2], [0, 2]
];
const pathSet = new Set(enemyPath.map(([x, y]) => `${x},${y}`));

const TOWER_TYPES = {
  archer: { name: 'Лучник', cost: 50, range: TILE_SIZE * 2.2, cooldownMax: 45, bulletSpeed: 3, color: 0x1e90ff, damage: 1 },
  cannon: { name: 'Пушка', cost: 80, range: TILE_SIZE * 2.6, cooldownMax: 70, bulletSpeed: 2.4, color: 0xffa500, damage: 2 },
  mage:   { name: 'Маг',    cost: 100, range: TILE_SIZE * 3.0, cooldownMax: 55, bulletSpeed: 3.2, color: 0x7a00ff, damage: 1.5 },
};

const WAVES = [
  { enemies: 6,  speed: 0.02,  hp: 1 },
  { enemies: 10, speed: 0.026, hp: 2 },
  { enemies: 14, speed: 0.032, hp: 3 },
];

export default function App() {
  // HTML-слой
  const mountRef = useRef(null);

  // PIXI и слои
  const appRef = useRef(null);
  const gridLayerRef   = useRef(null);
  const towerLayerRef  = useRef(null);
  const enemyLayerRef  = useRef(null);
  const bulletLayerRef = useRef(null);

  // Гейм-рефы (истина)
  const goldRef  = useRef(150);
  const livesRef = useRef(5);
  const waveRef  = useRef(0);            // 0 = ещё ни одной волны не стартовали
  const breakRef = useRef(0);            // секунды перерыва (float)
  const isWaveActiveRef = useRef(false);

  const selectedTypeRef = useRef(null);
  const towersRef  = useRef([]);         // {x,y,conf,cooldown,sprite}
  const enemiesRef = useRef([]);         // {sprite,pathIndex,speed,hp}
  const bulletsRef = useRef([]);         // {sprite,vx,vy,target,damage}
  const occupiedRef = useRef(new Set()); // "x,y" заняты башней

  // Спавн волны
  const spawnRef = useRef({ toSpawn: 0, timer: 0 }); // timer — кадры до следующего спавна

  // React-стейт только для UI (синк редко)
  const [gold, setGold]       = useState(goldRef.current);
  const [lives, setLives]     = useState(livesRef.current);
  const [wave, setWave]       = useState(waveRef.current);
  const [breakTime, setBreak] = useState(Math.ceil(breakRef.current));

  // ---- init PIXI (один раз) ----
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    tg?.ready();
    tg?.expand();

    const app = new PIXI.Application({
      width: TILE_SIZE * GRID_SIZE,
      height: TILE_SIZE * GRID_SIZE,
      backgroundColor: 0xeeeeee,
      antialias: true,
    });
    appRef.current = app;
    mountRef.current?.appendChild(app.view);

    // Слои
    const gridLayer   = new PIXI.Container();
    const towerLayer  = new PIXI.Container();
    const enemyLayer  = new PIXI.Container();
    const bulletLayer = new PIXI.Container();
    gridLayerRef.current   = gridLayer;
    towerLayerRef.current  = towerLayer;
    enemyLayerRef.current  = enemyLayer;
    bulletLayerRef.current = bulletLayer;
    app.stage.addChild(gridLayer, towerLayer, enemyLayer, bulletLayer);

    // Рисуем сетку, вешаем клики
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const cell = new PIXI.Graphics();
        const isPath = pathSet.has(`${x},${y}`);
        cell.lineStyle(1, isPath ? 0x88aaff : 0x999999);
        cell.beginFill(isPath ? 0xeef2ff : 0xffffff);
        cell.drawRect(0, 0, TILE_SIZE, TILE_SIZE);
        cell.endFill();
        cell.x = x * TILE_SIZE;
        cell.y = y * TILE_SIZE;

        cell.eventMode = 'static';
        cell.cursor = 'pointer';
        cell.on('pointerdown', () => {
          const typeKey = selectedTypeRef.current;
          if (!typeKey) return;
          if (isPath) return;
          const key = `${x},${y}`;
          if (occupiedRef.current.has(key)) return;
          const conf = TOWER_TYPES[typeKey];
          if (goldRef.current < conf.cost) return;
          placeTower(x, y, typeKey);
        });

        gridLayer.addChild(cell);
      }
    }

    // Игровой цикл
    app.ticker.add(gameLoop);

    return () => {
      app.ticker.remove(gameLoop);
      app.destroy(true, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- UI-синхронизация (10 раз/сек) ----
  useEffect(() => {
    const id = setInterval(() => {
      setGold(goldRef.current);
      setLives(livesRef.current);
      setWave(waveRef.current);
      setBreak(Math.max(0, Math.ceil(breakRef.current)));
    }, 100);
    return () => clearInterval(id);
  }, []);

  // ---- API функций ----
  function placeTower(cx, cy, typeKey) {
    const app = appRef.current;
    if (!app) return;

    const conf = { ...TOWER_TYPES[typeKey] };
    const sprite = new PIXI.Graphics();
    sprite.lineStyle(2, 0x000000);
    sprite.beginFill(conf.color);
    sprite.drawCircle(0, 0, TILE_SIZE / 3);
    sprite.endFill();
    sprite.x = cx * TILE_SIZE + TILE_SIZE / 2;
    sprite.y = cy * TILE_SIZE + TILE_SIZE / 2;

    towerLayerRef.current.addChild(sprite);

    towersRef.current.push({ x: sprite.x, y: sprite.y, conf, cooldown: 0, sprite });
    occupiedRef.current.add(`${cx},${cy}`);

    goldRef.current -= conf.cost;
    // setGold трогать не нужно — синкнет интервал
  }

  function startWave() {
    // прервать перерыв и начать следующую волну
    if (isWaveActiveRef.current) return;
    const waveIdx = waveRef.current; // 0..N-1
    if (waveIdx >= WAVES.length) return;

    const conf = WAVES[waveIdx];
    spawnRef.current.toSpawn = conf.enemies;
    spawnRef.current.timer = 30; // задержка до первого спавна (кадры)
    isWaveActiveRef.current = true;
    waveRef.current += 1; // теперь 1..N
  }

  // ---- Игровой цикл ----
  function gameLoop() {
    const app = appRef.current;
    if (!app) return;

    // Спавн врагов, если волна активна
    if (isWaveActiveRef.current) {
      const waveIdx = waveRef.current - 1; // активная волна
      const conf = WAVES[waveIdx];

      if (spawnRef.current.toSpawn > 0) {
        if (spawnRef.current.timer <= 0) {
          spawnEnemy(conf.speed, conf.hp);
          spawnRef.current.toSpawn -= 1;
          spawnRef.current.timer = 45; // интервал между врагами
        } else {
          spawnRef.current.timer -= 1;
        }
      }

      // Волна закончилась, если нет врагов и никого не осталось спавнить
      if (spawnRef.current.toSpawn === 0 && enemiesRef.current.length === 0) {
        isWaveActiveRef.current = false;
        breakRef.current = 10; // секунд перерыва
      }
    } else {
      // Перерыв тикает
      if (breakRef.current > 0) {
        breakRef.current = Math.max(0, breakRef.current - 1 / 60);
      }
    }

    // Движение врагов (плавная интерполяция)
    const enemies = enemiesRef.current;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const en = enemies[i];
      if (!en.sprite?.parent) { enemies.splice(i, 1); continue; }

      const iCell = Math.floor(en.pathIndex);
      if (iCell < enemyPath.length - 1) {
        const t = en.pathIndex - iCell;
        const [ax, ay] = enemyPath[iCell];
        const [bx, by] = enemyPath[iCell + 1];
        en.sprite.x = (ax + (bx - ax) * t) * TILE_SIZE + TILE_SIZE / 2;
        en.sprite.y = (ay + (by - ay) * t) * TILE_SIZE + TILE_SIZE / 2;
        en.pathIndex += en.speed; // speed = клеток/кадр
      } else {
        // дошёл до конца
        enemyLayerRef.current.removeChild(en.sprite);
        enemies.splice(i, 1);
        livesRef.current -= 1;
        if (livesRef.current <= 0) {
          app.ticker.stop();
          showOverlay('Game Over');
        }
      }
    }

    // Стрельба башен
    const towers = towersRef.current;
    towers.forEach(t => {
      if (t.cooldown > 0) { t.cooldown -= 1; return; }
      // цель — ближайший враг в радиусе
      let target = null, best = Infinity;
      enemiesRef.current.forEach(en => {
        if (!en.sprite?.parent) return;
        const dx = en.sprite.x - t.x;
        const dy = en.sprite.y - t.y;
        const d = Math.hypot(dx, dy);
        if (d <= t.conf.range && d < best) { best = d; target = en; }
      });
      if (target) {
        fireBullet(t, target);
        t.cooldown = t.conf.cooldownMax;
      }
    });

    // Пули
    const bullets = bulletsRef.current;
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      if (!b.target || !enemiesRef.current.includes(b.target) || !b.target.sprite?.parent) {
        bulletLayerRef.current.removeChild(b.sprite);
        bullets.splice(i, 1);
        continue;
      }
      b.sprite.x += b.vx;
      b.sprite.y += b.vy;

      const dx = b.target.sprite.x - b.sprite.x;
      const dy = b.target.sprite.y - b.sprite.y;
      if (Math.hypot(dx, dy) < 10) {
        // попадание
        bulletLayerRef.current.removeChild(b.sprite);
        bullets.splice(i, 1);
        b.target.hp -= b.damage;
        if (b.target.hp <= 0) {
          enemyLayerRef.current.removeChild(b.target.sprite);
          const idx = enemiesRef.current.indexOf(b.target);
          if (idx !== -1) enemiesRef.current.splice(idx, 1);
          goldRef.current += 10;
        }
      }
    }
  }

  function spawnEnemy(speed, hp) {
    const sprite = new PIXI.Graphics();
    sprite.beginFill(0xff3b30);
    sprite.drawCircle(0, 0, TILE_SIZE / 4);
    sprite.endFill();
    enemyLayerRef.current.addChild(sprite);
    enemiesRef.current.push({ sprite, pathIndex: 0, speed, hp });
  }

  function fireBullet(tower, target) {
    const sprite = new PIXI.Graphics();
    sprite.beginFill(0xffd60a);
    sprite.drawCircle(0, 0, 5);
    sprite.endFill();
    sprite.x = tower.x;
    sprite.y = tower.y;
    bulletLayerRef.current.addChild(sprite);

    const dx = target.sprite.x - tower.x;
    const dy = target.sprite.y - tower.y;
    const d = Math.hypot(dx, dy) || 1;

    bulletsRef.current.push({
      sprite,
      vx: (dx / d) * tower.conf.bulletSpeed,
      vy: (dy / d) * tower.conf.bulletSpeed,
      target,
      damage: tower.conf.damage,
    });
  }

  // ---- UI-хелперы ----
  function selectTower(typeKey) {
    selectedTypeRef.current = typeKey;
    setSelectedType(typeKey);
  }

  function showOverlay(text) {
    const app = appRef.current;
    const overlay = new PIXI.Container();
    const bg = new PIXI.Graphics();
    bg.beginFill(0x000000, 0.6).drawRect(0, 0, app.view.width, app.view.height).endFill();
    const label = new PIXI.Text(text, { fill: 0xffffff, fontSize: 28 });
    label.anchor.set(0.5);
    label.x = app.view.width / 2;
    label.y = app.view.height / 2;
    overlay.addChild(bg, label);
    app.stage.addChild(overlay);
  }

  const [selectedType, setSelectedType] = useState(null); // только визуальная подсветка

  // ---- Рендер HTML UI ----
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
      {/* Инфопанель */}
      <div style={{ display:'flex', gap:16, fontSize:16 }}>
        <div>💰 {gold}</div>
        <div>❤️ {lives}</div>
        <div>🌊 Волна: {wave}/{WAVES.length}</div>
        {isWaveActiveRef.current
          ? <div>⏳ Волна идёт</div>
          : <div>☕ Перерыв: {breakTime}s</div>}
      </div>

      {/* Canvas */}
      <div ref={mountRef} style={{ background:'#ddd', borderRadius:8 }} />

      {/* Выбор башен */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', justifyContent:'center', marginTop:8 }}>
        {Object.entries(TOWER_TYPES).map(([key, t]) => {
          const disabled = gold < t.cost;
          return (
            <button
              key={key}
              disabled={disabled}
              onClick={() => selectTower(key)}
              style={{
                padding:'6px 10px',
                background: selectedType === key ? '#d0ebff' : '#fff',
                border:'1px solid #ccc',
                borderRadius:6,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1
              }}
            >
              {t.name} ({t.cost})
            </button>
          );
        })}
        <button onClick={() => selectTower(null)}>❌ Отмена</button>
      </div>

      {/* Старт волны */}
      <button
        onClick={() => {
          // прерываем перерыв и начинаем новую волну
          breakRef.current = 0;
          startWave();
        }}
        disabled={isWaveActiveRef.current || waveRef.current >= WAVES.length}
        style={{
          marginTop:10, padding:'6px 14px', fontSize:16,
          background: isWaveActiveRef.current ? '#9aa' : '#28a745',
          color:'#fff', border:'none', borderRadius:6, cursor:'pointer'
        }}
      >
        🚀 Начать волну
      </button>
    </div>
  );
}
