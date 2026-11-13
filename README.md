# INVENTRA

Sistema de gestión integral de inventarios, construido como **PWA** con React 19, TypeScript y Vite. Funciona en teléfono, tablet y escritorio; guarda la información localmente con IndexedDB (Dexie) y queda preparado para sincronizar con un backend o ERP.

Aplicación genérica de inventarios: configure el nombre de su empresa, NIT y demás datos desde **Configuración**.

## Módulos

- Panel de control con KPIs, valorización, rotación, cobertura y alertas.
- Catálogo de 6 tipos de inventario: materia prima, empaque, insumo, producto en proceso, producto terminado y repuesto.
- Entradas y salidas con costeo promedio ponderado, lotes y control de stock negativo.
- Kardex y trazabilidad completa por producto, lote, documento y usuario.
- Producción: órdenes, explosión de BOM, consumo real, mermas, cierre y costo de fabricación.
- Registro diario de producción en 4 turnos, por máquina (inyectora/sopladora) y molde; captura táctil de piezas conformes y scrap, con OEE en tiempo real.
- Catálogo de máquinas con cavidades, ciclo ideal y estado (activa, mantenimiento, inactiva).
- Listas de materiales versionadas con costo teórico.
- MRP: requerimiento neto a partir de órdenes abiertas, programa diario pendiente, BOM, stock y stock mínimo.
- Ubicaciones 5S (curado, PT, racks, estibas, pasillos, despacho, devoluciones), stock por ubicación y traslados internos trazables.
- Despachos contra pedido con picking list, validación Poka-Yoke por escaneo, remisión PDF y packing list Excel.
- Producto no conforme (PNC): segregación y bloqueo de lote por rechupado, ráfaga, rebaba, peso o dimensión; análisis Kaizen de causa raíz y cierre.
- Importación masiva desde plantillas Excel para productos, BOM, ubicaciones y máquinas; exportación de catálogos y reportes operativos.
- Indicadores: OEE (disponibilidad × rendimiento × calidad) por turno y máquina, índice de scrap, rotación y días de inventario de PT, exactitud de registros (IRA).
- Conteo físico con ajustes valorizados.
- Reportes de existencias, valorización, rotación, consumo, producción y trazabilidad; exportación a Excel y PDF.
- Usuarios, roles, matriz de permisos y bloqueo por intentos fallidos.
- Auditoría inmutable de operaciones, accesos y cambios.
- Respaldo y restauración completa en JSON.

## Cuentas de acceso

| Perfil | Correo | Contraseña |
| --- | --- | --- |
| Administrador | `lucero.alzate502@asys.edu.co` | `1001415502` |
| Jefe de inventarios | `jefe@inventra.co` | `jefe123` |
| Almacenista | `almacen@inventra.co` | `almacen123` |
| Producción | `produccion@inventra.co` | `produccion123` |
| Consulta | `consulta@inventra.co` | `consulta123` |

La aplicación arranca **sin datos operativos**: no hay productos, movimientos, BOM, órdenes de producción ni conteos precargados. Solo se crean la configuración inicial y las cuentas de acceso. Empiece creando sus productos y registrando entradas.

## Ejecutar en desarrollo

```bash
npm install
npm run dev -- --host
```

Abrir la URL que muestra Vite (por defecto `http://localhost:5173`).

> En Windows, si PowerShell bloquea `npm.ps1`, usar `npm.cmd`.

## Compilar para producción

```bash
npm run build
npm run preview
```

El resultado queda en `dist/`. La PWA incluye manifest, iconos y service worker para instalación y uso sin conexión.

## Estructura

```text
src/
  components/   Layout, UI, gráficos, escáner, selector de productos
  context/      Sesión, tema, notificaciones y conectividad
  db/           Esquema Dexie y seed base (configuración + cuentas)
  domain/       Reglas de negocio: movimientos, producción, BOM/MRP, almacén 5S, despachos, PNC/Kaizen, indicadores, Excel, permisos
  pages/        Vistas de cada módulo
  styles/       Sistema de diseño responsive con modo claro/oscuro
docs/           Arquitectura, modelo de datos, navegación, flujos operativos y módulos de planta
```

## Reglas de negocio clave

- Todo movimiento actualiza el stock dentro de una transacción atómica.
- Los movimientos confirmados no se eliminan: se revierten con autorización y motivo.
- Sin permiso `inventory.override`, una salida no puede dejar el saldo negativo.
- Los productos con control por lote descuentan por FIFO y los lotes bloqueados por PNC no se pueden despachar.
- Las salidas usan el costo promedio ponderado vigente; las entradas lo recalculan.
- Las órdenes de producción validan materiales antes de liberarse y descuentan consumo real al ejecutarse.
- Al validar un turno, las piezas conformes generan una entrada `PROD_IN` al almacén (con stock por ubicación) y el scrap genera un `PNC` segregado.
- Un despacho solo se confirma si cada línea tiene cantidad pickeada exacta, escaneo Poka-Yoke válido, stock suficiente y lote/ubicación disponibles.
- OEE = Disponibilidad × Rendimiento × Calidad; el índice de scrap = scrap / (conformes + scrap).
- Cada operación sensible queda registrada en auditoría.

## Publicar en GitHub Pages

La app está preparada para publicarse como sitio estático. El flujo `.github/workflows/deploy.yml` compila y despliega automáticamente en cada push a `main`.

1. Cree un repositorio en GitHub (por ejemplo `inventra`) y suba el proyecto:

   ```bash
   git remote add origin https://github.com/USUARIO/inventra.git
   git push -u origin main
   ```

2. En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Espere el workflow **Deploy INVENTRA to GitHub Pages** en la pestaña **Actions**.
4. La app quedará en `https://USUARIO.github.io/inventra/` (o en `https://USUARIO.github.io/` si el repositorio se llama `USUARIO.github.io`).

El workflow calcula la ruta base (`/inventra/`) automáticamente, ajusta el manifest de la PWA y genera `dist/404.html` para que los enlaces profundos (`/inventra/despachos`, `/inventra/pnc`, …) funcionen al recargar o compartir.

Para otros hosts (Vercel, Netlify, Cloudflare Pages, hosting propio) use `npm run build` y publique la carpeta `dist/` en la raíz del dominio.

> **Datos por dispositivo:** la información se guarda en IndexedDB dentro de cada navegador. Publicar la app permite abrirla desde cualquier teléfono, tablet o computador, pero **cada dispositivo tiene su propia base local** y los datos no se comparten entre dispositivos. Para compartir información entre varios equipos se requiere conectar el backend/ERP mediante la capa `sync/` (pendiente).
>
> Antes de publicar, cambie la contraseña de la cuenta administradora y desactive o ajuste las cuentas de demostración (`jefe@inventra.co`, `almacen@inventra.co`, `produccion@inventra.co`, `consulta@inventra.co`) desde **Usuarios y roles**.

## Reiniciar la aplicación

Desde la consola del navegador:

```js
indexedDB.deleteDatabase('inventra');
localStorage.clear();
location.reload();
```

La aplicación volverá a crear la configuración y las cuentas de acceso al recargar, sin datos operativos.
