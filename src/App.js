import { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";

const TILE_SIZE = 32;
const GRID_SIZE = 20;

// Генерация змейки по всей карте
const enemyPath = [];
for (let y = 0; y < GRID_SIZE; y++) {
  if (y % 2 === 0) {
    for (let x = 0; x < GRID_SIZE; x++) enemyPath.push([x, y]);
  } else {
    for (let x = GRID_SIZE - 1; x >= 0; x--) enemyPath.push([x, y]);
  }
}
const pathSet = new Set(enemyPath.map(([x, y]) => `${x},${y}`));

const WAVES = [
  { count: 5, speed: 0.5 },
  { count: 8, speed: 0.6 },
  { count: 12, speed: 0.7 },
];

export default function App() {
  const canvasRef = useRef(null);
  const appRef = useRef(null);

  const goldRef = useRef(150);
  const livesRef = useRef(5);
  const waveRef = useRef(0);
  const breakRef = useRef(5);
  const isWaveActiveRef = useRef(false);
  const occupiedRef = useRef(new Set());

  const enemiesRef = useRef([]);
  const towersRef = useRef([]);
  const bulletsRef = useRef([]);

  const spawnRef = useRef({ timer: 0, toSpawn: 0, speed: 0 });

  const [gold, setGold] = useState(goldRef.current);
  const [lives, setLives] = useState(livesRef.current);
  const [wave, setWave] = useState(waveRef.current);
  const [breakTime, setBreakTime] = useState(breakRef.current);

  const startWave = () => {
    if (waveRef.current >= WAVES.length) return;
    isWaveActiveRef.current = true;
    const waveData = WAVES[waveRef.current];
    spawnRef.current = {
      timer: 0,
      toSpawn: waveData.count,
      speed: waveData.speed,
    };
    waveRef.current++;
  };

  useEffect(() => {
    const app = new PIXI.Application();
    app
      .init({
        width: TILE_SIZE * GRID_SIZE,
        height: TILE_SIZE * GRID_SIZE,
        backgroundColor: 0xeeeeee,
        autoDensity: true,
        resolution: Math.max(1, window.devicePixelRatio || 1),
      })
      .then(() => {
        appRef.current = app;
        canvasRef.current.appendChild(app.canvas);

        const gridLayer = new PIXI.Container();
        const towerLayer = new PIXI.Container();
        const enemyLayer = new PIXI.Container();
        const bulletLayer = new PIXI.Container();

        app.stage.addChild(gridLayer, towerLayer, enemyLayer, bulletLayer);

        // Сетка
        for (let y = 0; y < GRID_SIZE; y++) {
          for (let x = 0; x < GRID_SIZE; x++) {
            const tile = new PIXI.Graphics();
            tile.lineStyle(1, 0x999999);
            tile.beginFill(pathSet.has(`${x},${y}`) ? 0xcccccc : 0xffffff);
            tile.drawRect(0, 0, TILE_SIZE, TILE_SIZE);
            tile.endFill();
            tile.x = x * TILE_SIZE;
            tile.y = y * TILE_SIZE;
            tile.eventMode = "static";
            tile.cursor = "pointer";
            tile.on("pointerdown", () => {
              if (pathSet.has(`${x},${y}`)) return;
              if (occupiedRef.current.has(`${x},${y}`)) return;
              if (goldRef.current < 50) return;
              goldRef.current -= 50;
              setGold(goldRef.current);
              occupiedRef.current.add(`${x},${y}`);
              const tower = new PIXI.Graphics();
              tower.beginFill(0x00ff00);
              tower.drawRect(-TILE_SIZE / 2, -TILE_SIZE / 2, TILE_SIZE, TILE_SIZE);
              tower.endFill();
              tower.x = x * TILE_SIZE + TILE_SIZE / 2;
              tower.y = y * TILE_SIZE + TILE_SIZE / 2;
              towerLayer.addChild(tower);
              towersRef.current.push({
                sprite: tower,
                x,
                y,
                fireRate: 60,
                fireCooldown: 0,
              });
            });
            gridLayer.addChild(tile);
          }
        }

        const tick = (deltaOrTicker) => {
          const dt =
            typeof deltaOrTicker === "number"
              ? deltaOrTicker
              : deltaOrTicker?.deltaTime ?? 1;
          const dtSec = dt / 60;

          // Перерыв + автостарт
          if (!isWaveActiveRef.current && breakRef.current > 0) {
            breakRef.current = Math.max(0, breakRef.current - dtSec);
            if (breakRef.current <= 0 && waveRef.current < WAVES.length) {
              startWave();
            }
          }

          // Спавн врагов
          if (isWaveActiveRef.current && spawnRef.current.toSpawn > 0) {
            spawnRef.current.timer -= dtSec;
            if (spawnRef.current.timer <= 0) {
              const enemy = new PIXI.Graphics();
              enemy.beginFill(0xff0000);
              enemy.drawCircle(0, 0, TILE_SIZE / 3);
              enemy.endFill();
              enemy.x = enemyPath[0][0] * TILE_SIZE + TILE_SIZE / 2;
              enemy.y = enemyPath[0][1] * TILE_SIZE + TILE_SIZE / 2;
              enemyLayer.addChild(enemy);
              enemiesRef.current.push({
                sprite: enemy,
                pathIndex: 0,
                speed: spawnRef.current.speed,
                hp: 3,
              });
              spawnRef.current.toSpawn--;
              spawnRef.current.timer = 1;
            }
          }

          // Движение врагов
          enemiesRef.current.forEach((en, i) => {
            const i0 = Math.floor(en.pathIndex);
            const t = en.pathIndex - i0;
            const [ax, ay] = enemyPath[i0] ?? enemyPath[enemyPath.length - 1];
            const [bx, by] =
              enemyPath[i0 + 1] ?? enemyPath[enemyPath.length - 1];
            en.sprite.x =
              (ax + (bx - ax) * t) * TILE_SIZE + TILE_SIZE / 2;
            en.sprite.y =
              (ay + (by - ay) * t) * TILE_SIZE + TILE_SIZE / 2;
            en.pathIndex += en.speed * dtSec;
            if (en.pathIndex >= enemyPath.length - 1) {
              enemyLayer.removeChild(en.sprite);
              en.sprite.destroy();
              enemiesRef.current.splice(i, 1);
              livesRef.current--;
              setLives(livesRef.current);
            }
          });

          // Стрельба башен
          towersRef.current.forEach((tower) => {
            tower.fireCooldown -= dtSec;
            if (tower.fireCooldown <= 0) {
              const target = enemiesRef.current[0];
              if (target) {
                const bullet = new PIXI.Graphics();
                bullet.beginFill(0x0000ff);
                bullet.drawCircle(0, 0, 4);
                bullet.endFill();
                bullet.x = tower.x * TILE_SIZE + TILE_SIZE / 2;
                bullet.y = tower.y * TILE_SIZE + TILE_SIZE / 2;
                bulletLayer.addChild(bullet);
                bulletsRef.current.push({
                  sprite: bullet,
                  target,
                  speed: 200,
                });
                tower.fireCooldown = tower.fireRate / 60;
              }
            }
          });

          // Пули
          bulletsRef.current.forEach((b, i) => {
            const dx = b.target.sprite.x - b.sprite.x;
            const dy = b.target.sprite.y - b.sprite.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 5) {
              b.target.hp -= 1;
              if (b.target.hp <= 0) {
                goldRef.current += 10;
                setGold(goldRef.current);
                enemyLayer.removeChild(b.target.sprite);
                b.target.sprite.destroy();
                enemiesRef.current = enemiesRef.current.filter((e) => e !== b.target);
              }
              bulletLayer.removeChild(b.sprite);
              b.sprite.destroy();
              bulletsRef.current.splice(i, 1);
            } else {
              b.sprite.x += (dx / dist) * b.speed * dtSec;
              b.sprite.y += (dy / dist) * b.speed * dtSec;
            }
          });

          // Проверка конца волны
          if (
            isWaveActiveRef.current &&
            spawnRef.current.toSpawn === 0 &&
            enemiesRef.current.length === 0
          ) {
            isWaveActiveRef.current = false;
            breakRef.current = 5;
          }
        };

        app.ticker.add(tick);
      });

    return () => {
      appRef.current?.destroy(true, true);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setGold(goldRef.current);
      setLives(livesRef.current);
      setWave(waveRef.current);
      setBreakTime(Math.ceil(breakRef.current));
    }, 100);
    return () => clearInterval(id);
  }, []);

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
    boxShadow: isDark
      ? "0 2px 10px rgba(0,0,0,0.3)"
      : "0 2px 10px rgba(0,0,0,0.1)",
    fontSize: "18px",
    position: "sticky",
    top: 0,
    zIndex: 10,
  };

  return (
    <div style={{ padding: 10 }}>
      <div style={panelStyle}>
        <div>💰 {gold}</div>
        <div>❤️ {lives}</div>
        <div>🌊 {wave}/{WAVES.length}</div>
        {!isWaveActiveRef.current && wave < WAVES.length && (
          <div>⏳ {breakTime}s</div>
        )}
      </div>
      <button
        onClick={startWave}
        disabled={isWaveActiveRef.current || wave >= WAVES.length}
        style={{ marginBottom: 10 }}
      >
        Начать волну
      </button>
      <div ref={canvasRef}></div>
    </div>
  );
}
