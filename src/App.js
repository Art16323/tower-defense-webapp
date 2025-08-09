import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';

const TILE_SIZE = 64;
const GRID_SIZE = 5;

// Путь по клеткам
const enemyPath = [
  [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
  [4, 1], [4, 2], [3, 2], [2, 2], [1, 2], [0, 2]
];
const pathSet = new Set(enemyPath.map(([x, y]) => `${x},${y}`));

// Типы башен
const TOWER_TYPES = {
  archer: { name: 'Лучник', cost: 50,  range: TILE_SIZE * 2.2, cooldownMax: 0.75, bulletSpeed: 220, color: 0x1e90ff, damage: 1 },
  cannon: { name: 'Пушка',  cost: 80,  range: TILE_SIZE * 2.6, cooldownMax: 1.20, bulletSpeed: 180, color: 0xffa500, damage: 2 },
  mage:   { name: 'Маг',    cost: 100, range: TILE_SIZE * 3.0, cooldownMax: 0.90, bulletSpeed: 240, color: 0x7a00ff, damage: 1.5 },
};

// Волны (скорости и КД — в СЕКУНДАХ; скорости — клетки/сек, bulletSpeed — px/сек)
const WAVES = [
  { enemies: 6,  speed: 0.80, hp: 1 },
  { enemies: 10, speed: 1.00, hp: 2 },
  { enemies: 14, speed: 1.25, hp: 3 },
];

export default function App() {
  // DOM узел для канвы
  const mountRef = useRef(null);

  // PIXI и слои
  const appRef = useRef(null);
  const gridLayerRef   = useRef(null);
  const towerLayerRef  = useRef(null);
  const enemyLayerRef  = useRef(null);
  const bulletLayerRef = useRef(null);
  const uiLayerRef     = useRef(null);

  // Истинное состояние игры (refs)
  const goldRef  = useRef(150);
  const livesRef = useRef(5);
  const waveRef  = useRef(0);       // 0..N-1 (индекс следующей волны)
  const breakRef = useRef(0);       // секунды перерыва
  const isWaveActiveRef = useRef(false);

  const selectedTypeRef = useRef(null);
  const towersRef  = useRef([]);    // {x,y,conf,cooldownSec,sprite}
  const enemiesRef = useRef([]);    // {sprite,pathIndex,speedCellPerSec,hp}
  const bulletsRef = useRef([]);    // {sprite,vx,vy,target,damage}
  const occupiedRef = useRef(new Set()); // "x,y" заняты башней

  // Спавн волны
  const spawnRef = useRef({ toSpawn: 0, timerSec: 0 }); // таймер до следующего спавна (сек)

  // React-стейт только для UI (синхронизируем редко)
  const [gold, setGold]       = useState(goldRef.current);
  const [lives, setLives]     = useState(livesRef.current);
  const [wave, setWave]       = useState(waveRef.current);
  const [breakTime, setBreak] = useState(Math.ceil(breakRef.current));
  const [selectedType, setSelectedType] = useState(null);

  // Подсветка радиуса (один круг переиспользуем)
  const radiusPreviewRef = useRef(null);

  // ---- init PIXI один раз ----
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    tg?.ready?.();
    tg?.expand?.();

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

    // Слои
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
    app.stage.addChild(gridLayer, towerLayer, enemyLayer, bulletLayer, uiLayer);

    // Сетка + обработчики кликов
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

        // Подсветка радиуса при наведении
        cell.on('pointerover', () => showRadiusPreview(x, y));
        cell.on('pointerout', hideRadiusPreview);

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

    // Тикер
    app.ticker.add(tick);

    return () => {
      app.ticker.remove(tick);
      // уничтожаем все слои и их детей
      [uiLayer, bulletLayer, enemyLayer, towerLayer, gridLayer].forEach(layer => {
        if (layer) {
          layer.removeChildren().forEach(c => c.destroy?.());
          layer.destroy?.({ children: true });
        }
      });
      app.destroy(true, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Синх UI (10 раз/сек) ----
  useEffect(() => {
    const id = setInterval(() => {
      setGold(goldRef.current);
      setLives(livesRef.current);
      setWave(waveRef.current);
      setBreak(Math.max(0, Math.ceil(breakRef.current)));
    }, 100);
    return () => clearInterval(id);
  }, []);

  // ---------- Игровые функции ----------
  function placeTower(cx, cy, typeKey) {
    const conf = { ...TOWER_TYPES[typeKey] };

    const sprite = new PIXI.Graphics();
    sprite.lineStyle(2, 0x000000);
    sprite.beginFill(conf.color);
    sprite.drawCircle(0, 0, TILE_SIZE / 3);
    sprite.endFill();
    sprite.x = cx * TILE_SIZE + TILE_SIZE / 2;
    sprite.y = cy * TILE_SIZE + TILE_SIZE / 2;
    towerLayerRef.current.addChild(sprite);

    towersRef.current.push({
      x: sprite.x,
      y: sprite.y,
      conf,
      cooldownSec: 0,
      sprite
    });
    occupiedRef.current.add(`${cx},${cy}`);

    goldRef.current -= conf.cost;
  }

  function startWave() {
    if (isWaveActiveRef.current) return;
    const waveIdx = waveRef.current;
    if (waveIdx >= WAVES.length) return;

    const conf = WAVES[waveIdx];
    spawnRef.current.toSpawn = conf.enemies;
    spawnRef.current.timerSec = 0.5; // полсекунды до первого спавна
    isWaveActiveRef.current = true;
    waveRef.current += 1; // теперь 1..N
  }

  function spawnEnemy(speedCellPerSec, hp) {
    const sprite = new PIXI.Graphics();
    sprite.beginFill(0xff3b30);
    sprite.drawCircle(0, 0, TILE_SIZE / 4);
    sprite.endFill();
    enemyLayerRef.current.addChild(sprite);

    enemiesRef.current.push({
      sprite,
      pathIndex: 0,               // положение по пути (клетки)
      speed: speedCellPerSec,     // клетки/сек
      hp
    });
  }

  function fireBullet(tower, target) {
    const sprite = new PIXI.Graphics();
    sprite.beginFill(0xffd60a);
    sprite.drawCircle(0, 0, 5);
    sprite.endFill();
    sprite.x = tower.x;
    sprite.y = tower.y;
    bulletLayerRef.current.addChild(sprite);

    // начальный вектор
    const dx = target.sprite.x - tower.x;
    const dy = target.sprite.y - tower.y;
    const d = Math.hypot(dx, dy) || 1;

    bulletsRef.current.push({
      sprite,
      vx: (dx / d) * tower.conf.bulletSpeed, // px/сек
      vy: (dy / d) * tower.conf.bulletSpeed, // px/сек
      target,
      damage: tower.conf.damage,
    });
  }

  function showOverlay(text) {
    hideOverlay(); // сначала убрать возможный старый
    const app = appRef.current;
    const overlay = new PIXI.Container();

    const bg = new PIXI.Graphics();
    bg.beginFill(0x000000, 0.6)
      .drawRect(0, 0, app.view.width, app.view.height)
      .endFill();

    const label = new PIXI.Text(text, { fill: 0xffffff, fontSize: 28 });
    label.anchor.set(0.5);
    label.x = app.view.width / 2;
    label.y = app.view.height / 2;

    overlay.addChild(bg, label);
    uiLayerRef.current.addChild(overlay);
    overlay.name = 'overlay';
  }

  function hideOverlay() {
    const layer = uiLayerRef.current;
    const old = layer?.getChildByName?.('overlay');
    if (old) {
      layer.removeChild(old);
      old.destroy({ children: true });
    }
  }

  function showRadiusPreview(cx, cy) {
    const typeKey = selectedTypeRef.current;
    const layer = uiLayerRef.current;
    if (!typeKey || !layer) return;

    // если уже есть — уберём
    hideRadiusPreview();

    const conf = TOWER_TYPES[typeKey];
    const g = new PIXI.Graphics();
    g.lineStyle(2, 0x00cc66, 0.4);
    g.beginFill(0x00cc66, 0.08);
    g.drawCircle(
      cx * TILE_SIZE + TILE_SIZE / 2,
      cy * TILE_SIZE + TILE_SIZE / 2,
      conf.range
    );
    g.endFill();
    g.name = 'radiusPreview';
    layer.addChild(g);
    radiusPreviewRef.current = g;
  }

  function hideRadiusPreview() {
    const g = radiusPreviewRef.current;
    if (g && g.parent) {
      g.parent.removeChild(g);
      g.destroy();
    }
    radiusPreviewRef.current = null;
  }

  // ---------- Главный тик ----------
  function tick(ticker) {
    const dt = ticker.deltaTime;   // "кадры" относительно 60fps
    const dtSec = dt / 60;         // секунды

    // Перерыв
    if (!isWaveActiveRef.current && breakRef.current > 0) {
      breakRef.current = Math.max(0, breakRef.current - dtSec);
    }

    // Спавн во время волны
    if (isWaveActiveRef.current) {
      const waveIdx = waveRef.current - 1;
      const conf = WAVES[waveIdx];

      if (spawnRef.current.toSpawn > 0) {
        if (spawnRef.current.timerSec <= 0) {
          spawnEnemy(conf.speed, conf.hp);
          spawnRef.current.toSpawn -= 1;
          spawnRef.current.timerSec = 0.75; // интервал между врагами (сек)
        } else {
          spawnRef.current.timerSec -= dtSec;
        }
      }

      // Конец волны?
      if (spawnRef.current.toSpawn === 0 && enemiesRef.current.length === 0) {
        isWaveActiveRef.current = false;
        if (waveRef.current >= WAVES.length) {
          showOverlay('🏆 Победа!');
          appRef.current.ticker.stop();
        } else {
          breakRef.current = 10; // сек перерыва
        }
      }
    }

    // Движение врагов (плавная интерполяция)
    for (let i = enemiesRef.current.length - 1; i >= 0; i--) {
      const en = enemiesRef.current[i];
      if (!en.sprite?.parent) { enemiesRef.current.splice(i, 1); continue; }

      const iCell = Math.floor(en.pathIndex);
      if (iCell < enemyPath.length - 1) {
        const t = en.pathIndex - iCell;
        const [ax, ay] = enemyPath[iCell];
        const [bx, by] = enemyPath[iCell + 1];
        en.sprite.x = (ax + (bx - ax) * t) * TILE_SIZE + TILE_SIZE / 2;
        en.sprite.y = (ay + (by - ay) * t) * TILE_SIZE + TILE_SIZE / 2;
        en.pathIndex += en.speed * dtSec; // клетки/сек * сек
      } else {
        // дошел до конца
        enemyLayerRef.current.removeChild(en.sprite);
        en.sprite.destroy();
        enemiesRef.current.splice(i, 1);
        livesRef.current -= 1;
        if (livesRef.current <= 0) {
          showOverlay('💀 Game Over');
          appRef.current.ticker.stop();
        }
      }
    }

    // Стрельба башен
    towersRef.current.forEach(t => {
      if (t.cooldownSec > 0) { t.cooldownSec = Math.max(0, t.cooldownSec - dtSec); return; }
      // найти цель
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
        t.cooldownSec = t.conf.cooldownMax; // сек
      }
    });

    // Пули (homing-lite: подправляем вектор к цели)
    for (let i = bulletsRef.current.length - 1; i >= 0; i--) {
      const b = bulletsRef.current[i];
      if (!b.target || !enemiesRef.current.includes(b.target) || !b.target.sprite?.parent) {
        bulletLayerRef.current.removeChild(b.sprite);
        b.sprite.destroy();
        bulletsRef.current.splice(i, 1);
        continue;
      }

      // наведение
      const dxT = b.target.sprite.x - b.sprite.x;
      const dyT = b.target.sprite.y - b.sprite.y;
      const dT = Math.hypot(dxT, dyT) || 1;
      b.vx = (dxT / dT) * (Math.hypot(b.vx, b.vy)); // сохраняем скорость (px/сек)
      b.vy = (dyT / dT) * (Math.hypot(b.vx, b.vy));

      // перемещение (px = (px/сек) * сек)
      b.sprite.x += b.vx * dtSec;
      b.sprite.y += b.vy * dtSec;

      if (Math.hypot(dxT, dyT) < 10) {
        // попадание
        bulletLayerRef.current.removeChild(b.sprite);
        b.sprite.destroy();
        bulletsRef.current.splice(i, 1);

        b.target.hp -= b.damage;
        if (b.target.hp <= 0) {
          enemyLayerRef.current.removeChild(b.target.sprite);
          b.target.sprite.destroy();
          const idx = enemiesRef.current.indexOf(b.target);
          if (idx !== -1) enemiesRef.current.splice(idx, 1);
          goldRef.current += 10;
        }
      }
    }
  }

  // ---------- UI-хелперы ----------
  function selectTower(typeKey) {
    selectedTypeRef.current = typeKey;
    setSelectedType(typeKey);
  }

  const startDisabled = isWaveActiveRef.current || waveRef.current >= WAVES.length;

  // ---------- Рендер HTML UI ----------
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
      {/* Инфо-панель */}
      <div style={{ display:'flex', gap:16, fontSize:16 }}>
        <div>💰 {gold}</div>
        <div>❤️ {lives}</div>
        <div>🌊 Волна: {Math.min(wave, WAVES.length)}/{WAVES.length}</div>
        {isWaveActiveRef.current
          ? <div>⏳ Волна идёт</div>
          : <div>☕ Перерыв: {breakTime}s</div>}
      </div>

      {/* Канва */}
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
        onClick={() => { hideOverlay(); breakRef.current = 0; startWave(); }}
        disabled={startDisabled}
        style={{
          marginTop:10, padding:'6px 14px', fontSize:16,
          background: startDisabled ? '#9aa' : '#28a745',
          color:'#fff', border:'none', borderRadius:6,
          cursor: startDisabled ? 'not-allowed' : 'pointer'
        }}
      >
        🚀 Начать волну
      </button>
    </div>
  );
}
