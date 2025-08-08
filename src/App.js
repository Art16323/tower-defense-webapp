import { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';

const TILE_SIZE = 64;
const GRID_SIZE = 5;

const enemyPath = [
  [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
  [4, 1], [4, 2], [3, 2], [2, 2], [1, 2], [0, 2]
];

function App() {
  const canvasRef = useRef(null);

  useEffect(() => {
    console.log("✅ useEffect сработал");
    console.log("🧩 window.Telegram:", window.Telegram);

    const tg = window.Telegram?.WebApp;
    tg?.ready();
    tg?.expand();

    PIXI.Application.init({
      resizeTo: window,
      backgroundColor: 0xeeeeee,
      antialias: true,
    }).then(app => {
      if (canvasRef.current) {
        canvasRef.current.appendChild(app.canvas);
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

      // Враг
      const enemy = new PIXI.Graphics();
      enemy.beginFill(0xff0000);
      enemy.drawCircle(0, 0, TILE_SIZE / 4);
      enemy.endFill();
      app.stage.addChild(enemy);

      let index = 0;
      app.ticker.add(() => {
        if (index < enemyPath.length) {
          const [x, y] = enemyPath[Math.floor(index)];
          enemy.x = x * TILE_SIZE + TILE_SIZE / 2;
          enemy.y = y * TILE_SIZE + TILE_SIZE / 2;
          index += 0.05;
        }
      });
    });

    return () => {
      // ничего не удаляем — PixiJS v8 init async
    };
  }, []);

  return (
    <div
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100vh',
        overflow: 'hidden',
      }}
    ></div>
  );
}

export default App;
