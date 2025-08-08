import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';

const TILE_SIZE = 64;
const GRID_SIZE = 5;

// Путь врагов (клетки, куда они идут)
const enemyPath = [
  [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
  [4, 1], [4, 2], [3, 2], [2, 2], [1, 2], [0, 2]
];

// Конфиг башен
const TOWER_TYPES = {
  archer: { name: 'Лучник', cost: 50, range: TILE_SIZE * 2.2, cooldownMax: 45, bulletSpeed: 3, color: 0x1e90ff },
  cannon: { name: 'Пушка',  cost: 80, range: TILE_SIZE * 2.6, cooldownMax: 70, bulletSpeed: 2.4, color: 0x5555ff },
  mage:   { name: 'Маг',    cost: 100, range: TILE_SIZE * 3.0, cooldownMax: 55, bulletSpeed: 3.2, color: 0x7a00ff },
};

function App() {
  const canvasRef = useRef(null);
  const selectedTypeRef = useRef(null); // текущий выбранный тип башни
  const [selectedType, setSelectedType] = useState(null); // для подсветки кнопки в UI

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    tg?.ready();
    tg?.expand();

    // --- PIXI v7 ---
    const app = new PIXI.Application({
      width: TILE_SIZE * GRID_SIZE,
      height: TILE_SIZE * GRID_SIZE,
      backgroundColor: 0xeeeeee,
      antialias: true,
    });
    canvasRef.current?.appendChild(app.view);

    // --- служебные структуры ---
    const pathSet = new Set(enemyPath.map(([x, y]) => `${x},${y}`)); // для запрета постройки на пути
    const occupied = new Set(); // занятые башнями клетки "x,y"

    // --- UI-тексты поверх канвы ---
    let gold = 150;
    let lives = 5;
    const goldText = new PIXI.Text(`Gold: ${gold}`, { fontSize: 18, fill: 0x000000 });
    const livesText = new PIXI.Text(`Lives: ${lives}`, { fontSize: 18, fill: 0x000000 });
    goldText.x = 5; goldText.y = 5;
    livesText.x = TILE_SIZE * GRID_SIZE - 90; livesText.y = 5;
    app.stage.addChild(goldText, livesText);

    // --- сетка + обработка кликов по клеткам ---
    const tileContainers = []; // чтобы (x,y) легко находить
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const g = new PIXI.Graphics();
        const isPath = pathSet.has(`${x},${y}`);
        g.lineStyle(1, isPath ? 0xaaaaff : 0x999999);
        g.beginFill(isPath ? 0xeef2ff : 0xffffff);
        g.drawRect(0, 0, TILE_SIZE, TILE_SIZE);
        g.endFill();
        g.x = x * TILE_SIZE;
        g.y = y * TILE_SIZE;
        g.interactive = true;
        g.cursor = 'pointer';
        g.on('pointerdown', () => {
          // попытка поставить башню
          const typeKey = selectedTypeRef.current;
          if (!typeKey) return; // не выбрана башня
          if (isPath) return;   // нельзя на путь
          const cellKey = `${x},${y}`;
          if (occupied.has(cellKey)) return; // занято
          const tConf = TOWER_TYPES[typeKey];
          if (gold < tConf.cost) return;     // не хватает золота

          placeTower(x, y, typeKey);
        });
        app.stage.addChild(g);
        tileContainers.push(g);
      }
    }

    // --- массивы сущностей ---
    const towers = []; // {x,y,conf,cooldown}
    const enemies = []; // {sprite, pathIndex, speed, hp}
    const bullets = []; // {sprite, vx, vy, target}

    // --- функция установки башни ---
    function placeTower(cx, cy, typeKey) {
      const conf = TOWER_TYPES[typeKey];
      const tower = new PIXI.Graphics();
      tower.beginFill(conf.color);
      tower.drawCircle(0, 0, TILE_SIZE / 3);
      tower.endFill();
      tower.x = cx * TILE_SIZE + TILE_SIZE / 2;
      tower.y = cy * TILE_SIZE + TILE_SIZE / 2;
      app.stage.addChild(tower);

      towers.push({ x: tower.x, y: tower.y, conf, cooldown: 0 });
      occupied.add(`${cx},${cy}`);
      gold -= conf.cost;
      goldText.text = `Gold: ${gold}`;
    }

    // --- спавн врагов волнами ---
    let spawnTimer = 0;
    const SPAWN_COOLDOWN = 110;

    // --- основной цикл ---
    app.ticker.add(() => {
      // спавним врагов
      if (spawnTimer <= 0) {
        const e = new PIXI.Graphics();
        e.beginFill(0xff3b30);
        e.drawCircle(0, 0, TILE_SIZE / 4);
        e.endFill();
        app.stage.addChild(e);
        enemies.push({ sprite: e, pathIndex: 0, speed: 0.02 + Math.random() * 0.02, hp: 1 });
        spawnTimer = SPAWN_COOLDOWN;
      } else spawnTimer--;

      // движение врагов
      for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        if (enemy.pathIndex < enemyPath.length) {
          const [x, y] = enemyPath[Math.floor(enemy.pathIndex)];
          enemy.sprite.x = x * TILE_SIZE + TILE_SIZE / 2;
          enemy.sprite.y = y * TILE_SIZE + TILE_SIZE / 2;
          enemy.pathIndex += enemy.speed;
        } else {
          // дошёл до конца
          app.stage.removeChild(enemy.sprite);
          enemies.splice(i, 1);
          lives -= 1;
          livesText.text = `Lives: ${lives}`;
          if (lives <= 0) {
            alert('Game Over!');
            app.stop();
          }
        }
      }

      // стрельба башен
      towers.forEach(t => {
        if (t.cooldown > 0) { t.cooldown--; return; }
        // цель — ближайший враг в радиусе
        let target = null;
        let best = Infinity;
        enemies.forEach(en => {
          const dx = en.sprite.x - t.x;
          const dy = en.sprite.y - t.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= t.conf.range && dist < best) { best = dist; target = en; }
        });
        if (target) {
          const b = new PIXI.Graphics();
          b.beginFill(0xffd60a);
          b.drawCircle(0, 0, 5);
          b.endFill();
          b.x = t.x; b.y = t.y;
          const dx = target.sprite.x - t.x;
          const dy = target.sprite.y - t.y;
          const d = Math.hypot(dx, dy) || 1;
          b.vx = (dx / d) * t.conf.bulletSpeed;
          b.vy = (dy / d) * t.conf.bulletSpeed;
          b.target = target;
          bullets.push(b);
          app.stage.addChild(b);
          t.cooldown = t.conf.cooldownMax;
        }
      });

      // движение пуль и попадания
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx;
        b.y += b.vy;
        const tgt = b.target;
        if (!tgt || !enemies.includes(tgt)) {
          app.stage.removeChild(b);
          bullets.splice(i, 1);
          continue;
        }
        const hit = Math.hypot(tgt.sprite.x - b.x, tgt.sprite.y - b.y) < 10;
        if (hit) {
          app.stage.removeChild(b);
          bullets.splice(i, 1);
          tgt.hp -= 1;
          if (tgt.hp <= 0) {
            app.stage.removeChild(tgt.sprite);
            const idx = enemies.indexOf(tgt);
            if (idx !== -1) enemies.splice(idx, 1);
            gold += 10;
            goldText.text = `Gold: ${gold}`;
          }
        }
      }
    });

    return () => app.destroy(true, true);
  }, []);

  // --- HTML-панель выбора башен ---
  function selectTower(typeKey) {
    selectedTypeRef.current = typeKey;
    setSelectedType(typeKey);
  }

  const btnStyle = (key) => ({
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #ddd',
    background: selectedType === key ? '#dff0ff' : '#fff',
    cursor: 'pointer',
    fontSize: 14,
    minWidth: 120,
  });

  return (
    <div style={{
      width: '100%',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 12,
      padding: 8
    }}>
      <div
        ref={canvasRef}
        style={{
          width: TILE_SIZE * GRID_SIZE,
          height: TILE_SIZE * GRID_SIZE,
          boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
          borderRadius: 12,
          overflow: 'hidden',
          background: '#eee'
        }}
      />
      <div style={{
        display: 'flex',
        gap: 10,
        flexWrap: 'wrap',
        justifyContent: 'center',
        width: TILE_SIZE * GRID_SIZE
      }}>
        <button style={btnStyle('archer')} onClick={() => selectTower('archer')}>🏹 {TOWER_TYPES.archer.name} ({TOWER_TYPES.archer.cost})</button>
        <button style={btnStyle('cannon')} onClick={() => selectTower('cannon')}>💣 {TOWER_TYPES.cannon.name} ({TOWER_TYPES.cannon.cost})</button>
        <button style={btnStyle('mage')}   onClick={() => selectTower('mage')}>🪄 {TOWER_TYPES.mage.name} ({TOWER_TYPES.mage.cost})</button>
        <button style={{...btnStyle(null), minWidth: 90}} onClick={() => selectTower(null)}>❌ Отмена</button>
      </div>
      <div style={{fontSize: 12, color: '#666'}}>Нажми кнопку башни, затем кликни по клетке (кроме пути) — башня поставится и начнёт стрелять.</div>
    </div>
  );
}

export default App;
