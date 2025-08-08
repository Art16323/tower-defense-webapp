import { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';

const TILE_SIZE = 64;
const GRID_SIZE = 5;

const enemyPath = [
  [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
  [4, 1], [4, 2], [3, 2], [2, 2], [1, 2], [0, 2]
];

const towerPositions = [
  [2, 1],
  [3, 3],
  [1, 4]
];

const TOWER_RANGE = TILE_SIZE * 2;
const BULLET_SPEED = 3;

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

    // Жизни
    let lives = 5;
    const livesText = new PIXI.Text(`Lives: ${lives}`, {
      fontSize: 18,
      fill: 0x000000,
    });
    livesText.x = 5;
    livesText.y = TILE_SIZE * GRID_SIZE + 5;
    app.stage.addChild(livesText);

    // Массив врагов
    const enemies = [];
    let spawnTimer = 0;

    // Пули
    const bullets = [];

    app.ticker.add(() => {
      // Спавн врагов каждые 120 кадров
      if (spawnTimer <= 0) {
        const enemy = new PIXI.Graphics();
        enemy.beginFill(0xff0000);
        enemy.drawCircle(0, 0, TILE_SIZE / 4);
        enemy.endFill();
        app.stage.addChild(enemy);
        enemies.push({ sprite: enemy, pathIndex: 0, speed: 0.02 });
        spawnTimer = 120;
      } else {
        spawnTimer--;
      }

      // Движение врагов
      enemies.forEach((enemy, ei) => {
        if (enemy.pathIndex < enemyPath.length) {
          const [x, y] = enemyPath[Math.floor(enemy.pathIndex)];
          enemy.sprite.x = x * TILE_SIZE + TILE_SIZE / 2;
          enemy.sprite.y = y * TILE_SIZE + TILE_SIZE / 2;
          enemy.pathIndex += enemy.speed;
        } else {
          // Враг дошёл до конца
          app.stage.removeChild(enemy.sprite);
          enemies.splice(ei, 1);
          lives--;
          livesText.text = `Lives: ${lives}`;
          if (lives <= 0) {
            alert("Game Over!");
            app.stop();
          }
        }
      });

      // Стрельба башен
      towers.forEach(tower => {
        // Найти ближайшего врага в радиусе
        let target = null;
        let minDist = Infinity;
        enemies.forEach(enemy => {
          const dx = enemy.sprite.x - tower.x;
          const dy = enemy.sprite.y - tower.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= TOWER_RANGE && dist < minDist) {
            minDist = dist;
            target = enemy;
          }
        });

        if (target && tower.cooldown <= 0) {
          // Создаём пулю
          const bullet = new PIXI.Graphics();
          bullet.beginFill(0xffff00);
          bullet.drawCircle(0, 0, 5);
          bullet.endFill();
          bullet.x = tower.x;
          bullet.y = tower.y;
          const dx = target.sprite.x - tower.x;
          const dy = target.sprite.y - tower.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          bullet.vx = (dx / dist) * BULLET_SPEED;
          bullet.vy = (dy / dist) * BULLET_SPEED;
          bullet.target = target;
          bullets.push(bullet);
          app.stage.addChild(bullet);
          tower.cooldown = 50;
        } else {
          tower.cooldown--;
        }
      });

      // Движение пуль
      bullets.forEach((bullet, bi) => {
        bullet.x += bullet.vx;
        bullet.y += bullet.vy;

        if (bullet.target) {
          const dx = bullet.target.sprite.x - bullet.x;
          const dy = bullet.target.sprite.y - bullet.y;
          if (Math.sqrt(dx * dx + dy * dy) < 10) {
            app.stage.removeChild(bullet);
            bullets.splice(bi, 1);

            // Удаляем врага при попадании
            const index = enemies.indexOf(bullet.target);
            if (index !== -1) {
              app.stage.removeChild(enemies[index].sprite);
              enemies.splice(index, 1);
            }
          }
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
