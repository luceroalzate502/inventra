import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './App';
import { AppProvider } from './context/AppContext';
import { seedIfEmpty } from './db/seed';
import { initSync } from './sync/engine';

async function bootstrap() {
  try {
    await seedIfEmpty();
  } catch (err) {
    console.error('No fue posible preparar los datos iniciales de INVENTRA.', err);
  }

  try {
    initSync();
  } catch (err) {
    console.error('No fue posible iniciar la sincronización en la nube.', err);
  }

  const container = document.getElementById('root');
  if (!container) throw new Error('No se encontró el contenedor #root.');

  createRoot(container).render(
    <StrictMode>
      <AppProvider>
        <App />
      </AppProvider>
    </StrictMode>,
  );
}

void bootstrap();
