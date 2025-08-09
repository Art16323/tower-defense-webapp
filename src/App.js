import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';

const TILE_SIZE = 64;
const GRID_SIZE = 5;

const enemyPath = [
  [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
  [4, 1], [4, 2], [3, 2], [2, 2], [1, 2], [0, 2]
];

const pathSet = new Set(enemyPath.map(([x, y]) => `${x},${y}`));

const TOWER_TYPES = {
  archer: { name: 'Лучник', cost: 50, range: TILE_SIZE * 2.2, cooldownMax: 45, bulletSpeed: 3, color: 0x1e90ff, damage: 1, upgradeCost: 40 },
  cannon: { name: 'Пушка', cost: 80, range: TILE_SIZE * 2.6, cooldownMax: 70, bulletSpeed: 2.4, color: 0x5555ff, damage: 2, upgradeCost: 60 },
  mage:   { name: 'Маг', cost: 100, range: TILE_SIZE * 3.0, cooldownMax: 55, bulletSpeed: 3.2, color: 0x7a00ff, damage: 1.5, upgradeCost: 70 },
};

const WAVES = [
  { enemies: 5, speed: 0.02, hp: 1 },
  { enemies: 8, speed: 0.025, hp: 2 },
  { enemies: 12, speed: 0.03, hp: 3 },
  { enemies: 15, speed: 0.035, hp: 4 }
];

function App() {
  const canvasRef = useRef(null);
  const selectedTypeRef = useRef(null);
  const [selectedType, setSelectedType] = useState(null);

  const [gold, setGold] = useState(150);
  const [lives, setLives] = useState(5);
  const [wave, setWave] = useState(0);
  const [waveTime, setWaveTime] = useState(0);
  const [breakTime, setBreakTime] = useState(0);
  const [isWaveActive, setIsWaveActive] = useState(false);

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
    canvasRef.current?.appendChild(app.view);

    const occupied = new Set();
    const towers = [];
    const enemies = [];
    const bullets = [];

    // Сетка
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
          const typeKey = selectedTypeRef.current;
          if (!typeKey) return;
          if (isPath) return;
          const cellKey = `${x},${y}`;
          if (occupied.has(cellKey)) return;
          const conf = TOWER_TYPES[typeKey];
          if (gold < conf.cost) return;
          placeTower(x, y, typeKey);
        });
        app.stage.addChild(g);
      }
    }

    function placeTower(cx, cy, typeKey) {
      const conf = { ...TOWER_TYPES[typeKey] };
      const tower = new PIXI.Graphics();
      tower.beginFill(conf.color);
      tower.drawCircle(0, 0, TILE_SIZE / 3);
      tower.endFill();
      tower.x = cx * TILE_SIZE + TILE_SIZE / 2;
      tower.y = cy * TILE_SIZE + TILE_SIZE / 2;
      tower.interactive = true;
      tower.cursor = 'pointer';
      tower.on('pointerdown', () => upgradeTower(towerData));
      app.stage.addChild(tower);

      const towerData = { x: tower.x, y: tower.y, conf, cooldown: 0, sprite: tower };
      towers.push(towerData);
      occupied.add(`${cx},${cy}`);
      setGold(g => g - conf.cost);
    }

    function upgradeTower(tower) {
      if (gold < tower.conf.upgradeCost) return;
      tower.conf.range *= 1.3;
      tower.conf.damage *= 1.5;
      tower.conf.cooldownMax *= 0.9;
      setGold(g => g - tower.conf.upgradeCost);
    }

    let spawnTimer = 0;
    let enemiesToSpawn = 0;

    function startWave() {
      if (isWaveActive) return;
      const nextWaveIndex = wave;
      if (nextWaveIndex >= WAVES.length) return;
      setWaveTime(0);
      setIsWaveActive(true);
      setWave(w => w + 1);
      enemiesToSpawn = WAVES[nextWaveIndex].enemies;
      spawnTimer = 60;
    }

    app.ticker.add(() => {
      // Если волна активна — спавним врагов
      if (isWaveActive) {
        setWaveTime(t => t + 1 / 60);
        if (enemiesToSpawn > 0 && spawnTimer <= 0) {
          const waveConf = WAVES[wave - 1];
          const e = new PIXI.Graphics();
          e.beginFill(0xff3b30);
          e.drawCircle(0, 0, TILE_SIZE / 4);
          e.endFill();
          app.stage.addChild(e);
          enemies.push({
            sprite: e,
            pathIndex: 0,
            speed: waveConf.speed,
            hp: waveConf.hp
          });
          enemiesToSpawn--;
          spawnTimer = 50;
        } else {
          spawnTimer--;
        }
        // Если врагов нет и нечего спавнить — конец волны
        if (enemies.length === 0 && enemiesToSpawn === 0) {
          setIsWaveActive(false);
          setBreakTime(10);
        }
      } else {
        // Перерыв
        if (breakTime > 0) {
          setBreakTime(t => t - 1 / 60);
        }
      }

      // Движение врагов
      for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        if (enemy.pathIndex < enemyPath.length) {
          const [x, y] = enemyPath[Math.floor(enemy.pathIndex)];
          enemy.sprite.x = x * TILE_SIZE + TILE_SIZE / 2;
          enemy.sprite.y = y * TILE_SIZE + TILE_SIZE / 2;
          enemy.pathIndex += enemy.speed;
        } else {
          app.stage.removeChild(enemy.sprite);
          enemies.splice(i, 1);
          setLives(l => {
            const newLives = l - 1;
            if (newLives <= 0) {
              alert('Game Over!');
              app.stop();
            }
            return newLives;
          });
        }
      }

      // Стрельба
      towers.forEach(t => {
        if (t.cooldown > 0) { t.cooldown--; return; }
        let target = null;
        let minDist = Infinity;
        enemies.forEach(en => {
          const dx = en.sprite.x - t.x;
          const dy = en.sprite.y - t.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= t.conf.range && dist < minDist) {
            minDist = dist;
            target = en;
          }
        });
        if (target) {
          const b = new PIXI.Graphics();
          b.beginFill(0xffd60a);
          b.drawCircle(0, 0, 5);
          b.endFill();
          b.x = t.x;
          b.y = t.y;
          const dx = target.sprite.x - t.x;
          const dy = target.sprite.y - t.y;
          const dist = Math.hypot(dx, dy) || 1;
          b.vx = (dx / dist) * t.conf.bulletSpeed;
          b.vy = (dy / dist) * t.conf.bulletSpeed;
          b.damage = t.conf.damage;
          b.target = target;
          bullets.push(b);
          app.stage.addChild(b);
          t.cooldown = t.conf.cooldownMax;
        }
      });

      // Пули
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx;
        b.y += b.vy;
        if (!b.target || !enemies.includes(b.target)) {
          app.stage.removeChild(b);
          bullets.splice(i, 1);
          continue;
        }
        const hit = Math.hypot(b.target.sprite.x - b.x, b.target.sprite.y - b.y) < 10;
        if (hit) {
          app.stage.removeChild(b);
          bullets.splice(i, 1);
          b.target.hp -= b.damage;
          if (b.target.hp <= 0) {
            app.stage.removeChild(b.target.sprite);
            const idx = enemies.indexOf(b.target);
            if (idx !== -1) enemies.splice(idx, 1);
            setGold(g => g + 10);
          }
        }
      }
    });

    return () => app.destroy(true, true);
  }, [gold, lives, wave, isWaveActive, breakTime]);

  function selectTower(typeKey) {
    selectedTypeRef.current = typeKey;
    setSelectedType(typeKey);
  }

  function fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      {/* Инфопанель */}
      <div style={{ display: 'flex', gap: 20, fontSize: 16 }}>
        <div>💰 {gold}</div>
        <div>❤️ {lives}</div>
        <div>🌊 Волна: {wave}</div>
        {isWaveActive ? <div>⏳ {fmtTime(waveTime)}</div> : <div>☕ Перерыв: {fmtTime(breakTime)}</div>}
      </div>

      {/* Поле */}
      <div ref={canvasRef} style={{ background: '#ddd', borderRadius: 8 }} />

      {/* Кнопки башен */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
        {Object.entries(TOWER_TYPES).map(([key, t]) => (
          <button
            key={key}
            onClick={() => selectTower(key)}
            style={{
              padding: '6px 10px',
              background: selectedType === key ? '#d0ebff' : '#fff',
              border: '1px solid #ccc',
              borderRadius: 6,
              cursor: 'pointer'
            }}
          >
            {t.name} ({t.cost})
          </button>
        ))}
        <button onClick={() => selectTower(null)}>❌ Отмена</button>
      </div>

      {/* Кнопка старта волны */}
      <button
        onClick={() => {
          const ev = new Event('startWave');
          window.dispatchEvent(ev);
        }}
        style={{
          marginTop: 10,
          padding: '6px 14px',
          fontSize: 16,
          background: '#28a745',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer'
        }}
      >
        🚀 Начать волну
      </button>
    </div>
  );
}

export default App;
