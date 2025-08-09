import { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";

const TILE_SIZE = 64;
const GRID_SIZE = 10; // было 5 — сделал 10; можно менять под девайсы

// Длинный путь змейкой по всему полю
function buildSnakePath(n) {
  const p = [];
  for (let y = 0; y < n; y++) {
    if (y % 2 === 0) {
      for (let x = 0; x < n; x++) p.push([x, y]);
    } else {
      for (let x = n - 1; x >= 0; x--) p.push([x, y]);
    }
  }
  return p;
}
const enemyPath = buildSnakePath(GRID_SIZE);
const pathSet = new Set(enemyPath.map(([x, y]) => `${x},${y}`));

// Генерация параметров волны по её индексу (0,1,2,...)
function getWaveConf(idx) {
  const enemies = 6 + Math.floor(idx * 1.5);          // постепенно больше врагов
  const speed   = 0.80 + Math.min(0.9, idx * 0.03);    // ускоряем, но с потолком
  const hp      = 1 + Math.floor(idx / 2);             // раз в две волны +1 хп
  return { enemies, speed, hp };
}

export default function App() {
  // DOM
  const mountRef = useRef(null);

  // PIXI и слои
  const appRef = useRef(null);
  const gridLayerRef   = useRef(null);
  const towerLayerRef  = useRef(null);
  const enemyLayerRef  = useRef(null);
  const bulletLayerRef = useRef(null);
  const uiLayerRef     = useRef(null);

  // Истинное состояние (refs)
  const goldRef  = useRef(150);
  const livesRef = useRef(5);
  const waveRef  = useRef(0);        // индекс следующей волны (0..∞)
  const breakRef = useRef(0);        // перерыв в секундах
  const isWaveActiveRef = useRef(false);

  const selectedTypeRef = useRef(null);
  const towersRef  = useRef([]);     // {x,y,conf,cooldownLeft,sprite}
  const enemiesRef = useRef([]);     // {sprite,pathIndex,speed,hp}
  const bulletsRef = useRef([]);     // {sprite,vx,vy,speed,target,damage}
  const occupiedRef = useRef(new Set()); // "x,y"
  const spawnRef = useRef({ toSpawn: 0, timerSec: 0 });

  // Типы башен (секундные тайминги; bulletSpeed — px/сек)
  const TOWER_TYPES = {
    archer: { name: "Лучник", cost: 50,  range: TILE_SIZE * 2.2, cooldownSec: 0.75, bulletSpeed: 220, color: 0x1e90ff, damage: 1,   upgradeCost: 40 },
    cannon: { name: "Пушка",  cost: 80,  range: TILE_SIZE * 2.6, cooldownSec: 1.20, bulletSpeed: 180, color: 0xffa500, damage: 2,   upgradeCost: 60 },
    mage:   { name: "Маг",    cost: 100, range: TILE_SIZE * 3.0, cooldownSec: 0.90, bulletSpeed: 240, color: 0x7a00ff, damage: 1.5, upgradeCost: 70 },
  };

  // UI-стейты (синкаем редко)
  const [gold, setGold]       = useState(goldRef.current);
  const [lives, setLives]     = useState(livesRef.current);
  const [wave, setWave]       = useState(waveRef.current);
  const [breakTime, setBreak] = useState(Math.ceil(breakRef.current));
  const [selectedType, setSelectedType] = useState(null);

  // Радиус превью при выборе башни
  const radiusPreviewRef = useRef(null);

  // Инициализация PIXI один раз
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

    // Responsive-fit (масштаб под экран)
    function fit() {
      const baseW = TILE_SIZE * GRID_SIZE;
      const baseH = TILE_SIZE * GRID_SIZE;

      const maxW = Math.min(window.innerWidth,  tg?.viewportWidth  ?? Infinity);
      const maxH = Math.min(window.innerHeight, tg?.viewportHeight ?? Infinity);

      const scale = Math.min(maxW / baseW, maxH / baseH, 1); // не upscale-им
      app.renderer.resize(Math.ceil(baseW * scale), Math.ceil(baseH * scale));
      app.stage.scale.set(scale);
    }
    fit();
    window.addEventListener("resize", fit);
    tg?.onEvent?.("viewportChanged", fit);

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

    // Сетка с обработчиками
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const isPath = pathSet.has(`${x},${y}`);
        const cell = new PIXI.Graphics();
        cell.lineStyle(1, isPath ? 0x88aaff : 0x999999);
        cell.beginFill(isPath ? 0xeef2ff : 0xffffff);
        cell.drawRect(0, 0, TILE_SIZE, TILE_SIZE);
        cell.endFill();
        cell.x = x * TILE_SIZE;
        cell.y = y * TILE_SIZE;

        cell.eventMode = "static";
        cell.cursor = "pointer";

        // превью радиуса
        cell.on("pointerover", () => showRadiusPreview(x, y));
        cell.on("pointerout", hideRadiusPreview);

        // установка башни
        cell.on("pointerdown", () => {
          const typeKey = selectedTypeRef.current;
          if (!typeKey) return;
          if (isPath) return;
          const k = `${x},${y}`;
          if (occupiedRef.current.has(k)) return;
          const conf = TOWER_TYPES[typeKey];
          if (goldRef.current < conf.cost) return;
          placeTower(x, y, typeKey);
        });

        gridLayer.addChild(cell);
      }
    }

    // Тикер (кросс-версионный deltaTime)
    app.ticker.add(tick);

    return () => {
      window.removeEventListener("resize", fit);
      tg?.offEvent?.("viewportChanged", fit);
      app.ticker.remove(tick);
      app.destroy(true, true); // одного достаточно
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Синк UI 10 раз/сек
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

    // апгрейд по клику
    sprite.eventMode = "static";
    sprite.cursor = "pointer";
    sprite.on("pointerdown", () => upgradeTowerByClick(sprite));

    towerLayerRef.current.addChild(sprite);

    towersRef.current.push({
      x: sprite.x,
      y: sprite.y,
      conf,
      cooldownLeft: 0, // сек
      sprite
    });
    occupiedRef.current.add(`${cx},${cy}`);
    goldRef.current -= conf.cost;
  }

  function upgradeTowerByClick(sprite) {
    const tw = towersRef.current.find(t => t.sprite === sprite);
    if (!tw) return;
    const cost = tw.conf.upgradeCost ?? 50;
    if (goldRef.current < cost) return;

    // простая схема апгрейда
    tw.conf.range *= 1.25;
    tw.conf.damage *= 1.4;

    // корректный пересчёт КД (сек) без ловушки с ||
    const baseCd =
      (typeof tw.conf.cooldownSec === "number" ? tw.conf.cooldownSec : null) ??
      (typeof tw.conf.cooldownLeft === "number" ? tw.conf.cooldownLeft : null) ??
      TOWER_TYPES.archer.cooldownSec;

    tw.conf.cooldownSec = Math.max(0.4, baseCd * 0.9);
    goldRef.current -= cost;

    // вспышка
    const flash = new PIXI.Graphics();
    flash.beginFill(0xffffff, 0.6).drawCircle(0, 0, TILE_SIZE / 2).endFill();
    flash.x = tw.x; flash.y = tw.y;
    uiLayerRef.current.addChild(flash);
    let a = 0.6;
    const app = appRef.current;
    const fade = (deltaOrTicker) => {
      const dt = typeof deltaOrTicker === "number" ? deltaOrTicker : (deltaOrTicker?.deltaTime ?? 1);
      a -= (dt / 60) * 1.5;
      flash.alpha = Math.max(0, a);
      if (flash.alpha <= 0) {
        uiLayerRef.current.removeChild(flash);
        flash.destroy();
        app.ticker.remove(fade);
      }
    };
    app.ticker.add(fade);
  }

  function startWave() {
    if (isWaveActiveRef.current) return;

    const idx = waveRef.current;       // 0..∞ — индекс следующей волны
    const conf = getWaveConf(idx);

    spawnRef.current.toSpawn  = conf.enemies;
    spawnRef.current.timerSec = 0.5;   // стартовая задержка
    isWaveActiveRef.current = true;
    waveRef.current += 1;              // теперь счётчик волн в UI идёт 1..∞
  }

  function spawnEnemy() {
    const idx = Math.max(0, waveRef.current - 1); // индекс активной волны
    const conf = getWaveConf(idx);

    const sprite = new PIXI.Graphics();
    sprite.beginFill(0xff3b30);
    sprite.drawCircle(0, 0, TILE_SIZE / 4);
    sprite.endFill();
    enemyLayerRef.current.addChild(sprite);

    enemiesRef.current.push({
      sprite,
      pathIndex: 0,           // положение по пути (клетки)
      speed: conf.speed,      // клетки/сек
      hp: conf.hp
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

    const dx = target.sprite.x - tower.x;
    const dy = target.sprite.y - tower.y;
    const d = Math.hypot(dx, dy) || 1;
    const speed = tower.conf.bulletSpeed; // px/сек

    bulletsRef.current.push({
      sprite,
      vx: (dx / d) * speed,
      vy: (dy / d) * speed,
      speed,
      target,
      damage: tower.conf.damage
    });
  }

  function showOverlay(text) {
    hideOverlay();
    const app = appRef.current;
    const overlay = new PIXI.Container();
    overlay.name = "overlay";

    const bg = new PIXI.Graphics();
    bg.beginFill(0x000000, 0.6).drawRect(0, 0, app.view.width, app.view.height).endFill();

    const label = new PIXI.Text(text, { fill: 0xffffff, fontSize: 28 });
    label.anchor.set(0.5);
    label.x = app.view.width / 2;
    label.y = app.view.height / 2;

    overlay.addChild(bg, label);
    uiLayerRef.current.addChild(overlay);
  }

  function hideOverlay() {
    const layer = uiLayerRef.current;
    const old = layer?.getChildByName?.("overlay");
    if (old) {
      layer.removeChild(old);
      old.destroy({ children: true });
    }
  }

  function showRadiusPreview(cx, cy) {
    const typeKey = selectedTypeRef.current;
    if (!typeKey) return;
    hideRadiusPreview();

    const conf = TOWER_TYPES[typeKey];
    const g = new PIXI.Graphics();
    g.lineStyle(2, 0x00cc66, 0.35);
    g.beginFill(0x00cc66, 0.08);
    g.drawCircle(
      cx * TILE_SIZE + TILE_SIZE / 2,
      cy * TILE_SIZE + TILE_SIZE / 2,
      conf.range
    );
    g.endFill();
    g.name = "radiusPreview";
    uiLayerRef.current.addChild(g);
    radiusPreviewRef.current = g;
  }

  function hideRadiusPreview() {
    const g = radiusPreviewRef.current;
    if (g?.parent) {
      g.parent.removeChild(g);
      g.destroy();
    }
    radiusPreviewRef.current = null;
  }

  // Главный тик (кросс-версионный deltaTime)
  function tick(deltaOrTicker) {
    const app = appRef.current;
    if (!app) return;

    const dt = typeof deltaOrTicker === "number"
      ? deltaOrTicker
      : (deltaOrTicker?.deltaTime ?? 1);
    const dtSec = dt / 60;

    // Перерыв: тикает и автостарт по окончании
    if (!isWaveActiveRef.current && breakRef.current > 0) {
      breakRef.current = Math.max(0, breakRef.current - dtSec);
      if (breakRef.current <= 0) {
        breakRef.current = 0;
        startWave(); // автостарт следующей волны
      }
    }

    // Спавн волны
    if (isWaveActiveRef.current) {
      if (spawnRef.current.toSpawn > 0) {
        spawnRef.current.timerSec -= dtSec;
        if (spawnRef.current.timerSec <= 0) {
          spawnEnemy();
          spawnRef.current.toSpawn -= 1;
          spawnRef.current.timerSec = 0.75; // интервал спавна (сек)
        }
      }

      // Конец волны? — запускаем перерыв, без ограничений по количеству волн
      if (spawnRef.current.toSpawn === 0 && enemiesRef.current.length === 0) {
        isWaveActiveRef.current = false;
        breakRef.current = 8; // длина перерыва между волнами
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
        // дошёл
        enemyLayerRef.current.removeChild(en.sprite);
        en.sprite.destroy();
        enemiesRef.current.splice(i, 1);
        livesRef.current -= 1;
        if (livesRef.current <= 0) {
          showOverlay("💀 Game Over");
          app.ticker.stop();
        }
      }
    }

    // Стрельба башен
    towersRef.current.forEach(t => {
      if (t.cooldownLeft > 0) { t.cooldownLeft = Math.max(0, t.cooldownLeft - dtSec); return; }

      // цель — ближайший в радиусе
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
        t.cooldownLeft = t.conf.cooldownSec;
      }
    });

    // Полёт пуль (homing-lite)
    for (let i = bulletsRef.current.length - 1; i >= 0; i--) {
      const b = bulletsRef.current[i];
      if (!b.target || !enemiesRef.current.includes(b.target) || !b.target.sprite?.parent) {
        bulletLayerRef.current.removeChild(b.sprite);
        b.sprite.destroy();
        bulletsRef.current.splice(i, 1);
        continue;
      }

      // перенаводим вектор, сохраняя модуль скорости (px/сек)
      const dx = b.target.sprite.x - b.sprite.x;
      const dy = b.target.sprite.y - b.sprite.y;
      const d  = Math.hypot(dx, dy) || 1;
      const speed = b.speed;
      b.vx = (dx / d) * speed;
      b.vy = (dy / d) * speed;

      // перемещаем
      b.sprite.x += b.vx * dtSec;
      b.sprite.y += b.vy * dtSec;

      // попадание
      if (Math.hypot(dx, dy) < 10) {
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

  // UI-помощники
  function selectTower(typeKey) {
    selectedTypeRef.current = typeKey;
    setSelectedType(typeKey);
  }

  const tg = window.Telegram?.WebApp;
  const isDark = tg?.colorScheme === "dark";
  const panelStyle = {
    display: "flex",
    gap: 16,
    alignItems: "center",
    padding: "8px 12px",
    borderRadius: 8,
    background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
    color: isDark ? "#fff" : "#111",
    boxShadow: isDark ? "0 2px 10px rgba(0,0,0,0.3)" : "0 2px 10px rgba(0,0,0,0.1)",
    fontSize: "18px",
    position: "sticky",
    top: 0,
    zIndex: 10
  };

  const startDisabled = isWaveActiveRef.current; // без проверки длины массива волн

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
      {/* Верхняя панель */}
      <div style={panelStyle}>
        <div>💰 {gold}</div>
        <div>❤️ {lives}</div>
        <div>🌊 Волна: {wave}</div>
        {isWaveActiveRef.current ? <div>⏳ Волна идёт</div> : <div>☕ Перерыв: {breakTime}s</div>}
      </div>

      {/* Канва */}
      <div ref={mountRef} style={{ background:"#ddd", borderRadius:8, width:"100%", maxWidth:"100vw" }} />

      {/* Кнопки башен */}
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", justifyContent:"center", marginTop:8 }}>
        {Object.entries(TOWER_TYPES).map(([key, t]) => {
          const disabled = gold < t.cost;
          return (
            <button
              key={key}
              disabled={disabled}
              onClick={() => selectTower(key)}
              style={{
                padding:"6px 10px",
                background: selectedType === key ? "#d0ebff" : "#fff",
                border:"1px solid #ccc",
                borderRadius:6,
                cursor: disabled ? "not-allowed" : "pointer",
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
          marginTop:10, padding:"6px 14px", fontSize:16,
          background: startDisabled ? "#9aa" : "#28a745",
          color:"#fff", border:"none", borderRadius:6,
          cursor: startDisabled ? "not-allowed" : "pointer"
        }}
      >
        🚀 Начать волну
      </button>
    </div>
  );
}
