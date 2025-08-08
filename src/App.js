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
    const app = new PIXI.Application({
      width: TILE_SIZE * GRID_SIZE,
      height: TILE_SIZE * GRID_SIZE,
      backgroundColor: 0xeeeeee,
    });

    canvasRef.current.appendChild(app.view);

    // добавляем башни в следующем шаге

    // Отрисовка сетки
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

    // Враг — красный круг
    const enemy = new PIXI.Graphics();
    enemy.beginFill(0xff0000);
    enemy.drawCircle(0, 0, TILE_SIZE / 4);
    enemy.endFill();
    app.stage.addChild(enemy);

    // Анимация движения врага
    let index = 0;
    app.ticker.add(() => {
      if (index < enemyPath.length) {
        const [x, y] = enemyPath[index];
        enemy.x = x * TILE_SIZE + TILE_SIZE / 2;
        enemy.y = y * TILE_SIZE + TILE_SIZE / 2;
        index += 0.05; // скорость
      }
    });

    return () => app.destroy(true, true);
  }, []);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
      <div ref={canvasRef}></div>
    </div>
  );
}

export default App;
