import { useEffect } from 'react';

function App() {
  useEffect(() => {
    const tg = window.Telegram.WebApp;
    tg.expand(); // раскрывает WebApp на весь экран
    tg.ready();  // сообщает Telegram, что всё загружено
  }, []);

  return (
    <div style={{ textAlign: 'center', padding: '1rem' }}>
      <h1>Tower Defense</h1>
      <p>🛡️ Добро пожаловать, защитник!</p>
      <p>Здесь будет поле, враги и башни.</p>
    </div>
  );
}

export default App;
