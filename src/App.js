import { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';

const TILE_SIZE = 64;
const GRID_SIZE = 5;

// Путь врага
const enemyPath = [
  [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
  [4, 1], [4, 2], [3, 2], [2, 2], [1, 2], [0, 2]
];

// Позиции башен
const towerPositions = [
  [2, 1],
  [3, 3],
  [1, 4]
];

const TOWER_RANGE = TILE_SIZE * 2; // радиус атаки
const BULLET_SPEED = 3; // скорость полёта снаряда

function App() {
  const canvasRef = useRef(null);

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

    if (canvasRef.current) {
      canvasRef.current.appendChild(app.view);
    }

    // Сетка
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const tile = new PIXI.Graphics();
        tile.lineStyle(1, 0x999999);
        tile.beginFill(0xffffff);
        tile.drawRect(0, 0, TILE_SIZE, TILE_SIZE);
        tile.endFill();
        tile.x = x * TILE_SIZE;
        tile.y = y * TILE_SIZE;
        app.stage.addChild(tile);
      }
    }

    // Башни
    const towers = [];
    towerPositions.forEach(([x, y]) => {
      const tower = new PIXI.Graphics();
      tower.beginFill(0x0000ff);
      tower.drawCircle(0, 0, TILE_SIZE / 3);
      tower.endFill();
      tower.x = x * TILE_SIZE + TILE_SIZE / 2;
      tower.y = y * TILE_SIZE + TILE_SIZE / 2;
      app.stage.addChild(tower);
      towers.push({ x: tower.x, y: tower.y, cooldown: 0 });
    });

    // Враг
    const enemy = new PIXI.Graphics();
    enemy.beginFill(0xff0000);
    enemy.drawCircle(0, 0, TILE_SIZE / 4);
    enemy.endFill();
    app.stage.addChild(enemy);

    let index = 0;
    const bullets = [];

    app.ticker.add(() => {
      // Движение врага
      if (index < enemyPath.length) {
        const [x, y] = enemyPath[Math.floor(index)];
        enemy.x = x * TILE_SIZE + TILE_SIZE / 2;
        enemy.y = y * TILE_SIZE + TILE_SIZE / 2;
        index += 0.02;
      }

      // Стрельба башен
      towers.forEach(tower => {
        const dx = enemy.x - tower.x;
        const dy = enemy.y - tower.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= TOWER_RANGE && tower.cooldown <= 0) {
          // создаём пулю
          const bullet = new PIXI.Graphics();
          bullet.beginFill(0xffff00);
          bullet.drawCircle(0, 0, 5);
          bullet.endFill();
          bullet.x = tower.x;
          bullet.y = tower.y;
          bullet.vx = (dx / distance) * BULLET_SPEED;
          bullet.vy = (dy / distance) * BULLET_SPEED;
          bullets.push(bullet);
          app.stage.addChild(bullet);
          tower.cooldown = 50; // перезарядка
        } else {
          tower.cooldown--;
        }
      });

      // Движение пуль
      bullets.forEach((bullet, i) => {
        bullet.x += bullet.vx;
        bullet.y += bullet.vy;

        // проверка попадания
        const dx = enemy.x - bullet.x;
        const dy = enemy.y - bullet.y;
        if (Math.sqrt(dx * dx + dy * dy) < 10) {
          app.stage.removeChild(bullet);
          bullets.splice(i, 1);
        }
      });
    });

    return () => {
      app.destroy(true, true);
    };
  }, []);

  return (
    <div
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
      }}
    />
  );
}

export default App;
