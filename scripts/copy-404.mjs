// GitHub Pages no reescribe rutas de una SPA: copia index.html a 404.html
// para que cualquier enlace profundo (/inventra/despachos, /inventra/pnc, …)
// cargue la aplicación y React Router resuelva la ruta.
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve(process.cwd(), 'dist');
copyFileSync(resolve(dist, 'index.html'), resolve(dist, '404.html'));
console.log('GitHub Pages: dist/404.html generado a partir de index.html');
