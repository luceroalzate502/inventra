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
- Sincronización multidispositivo con Supabase, con funcionamiento offline y resolución de conflictos por última escritura.

## Cuentas de acceso

| Perfil | Correo | Contraseña |
| --- | --- | --- |
| Administrador | `lucero.alzate502@asys.edu.co` | `1001415502` |

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
  sync/         Sincronización con Supabase: configuración, motor y estado
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

> **Datos por dispositivo:** la información se guarda en IndexedDB dentro de cada navegador. Publicar la app permite abrirla desde cualquier teléfono, tablet o computador, pero **cada dispositivo tiene su propia base local**. Para compartir información entre varios equipos, conecte la nube desde **Administración → Nube y sincronización** (ver la sección siguiente).
>
> Antes de publicar, cambie la contraseña de la cuenta administradora desde **Usuarios y roles**.

## Sincronización entre equipos (Supabase)

La app sigue siendo **offline-first**: cada dispositivo escribe primero en IndexedDB y la nube se actualiza en segundo plano. Sin internet se puede seguir operando; los cambios se envían al recuperar la conexión.

### 1. Crear el proyecto en Supabase

1. Cree una cuenta y un proyecto gratuito en [supabase.com](https://supabase.com).
2. En **SQL Editor**, pegue y ejecute el script [`public/supabase-schema.sql`](public/supabase-schema.sql). También puede copiarlo o descargarlo desde la pantalla **Nube y sincronización**.
3. En **Project Settings → API** copie el **Project URL** y la **anon public key**.
4. En **Authentication → Providers → Email**, si no quiere confirmar correos, desactive **Confirm email**.

### 2. Conectar cada dispositivo

1. Abra **Administración → Nube y sincronización**.
2. Complete la URL, la llave anónima y una cuenta de nube (correo y contraseña de mínimo 6 caracteres). Si la cuenta no existe, la app la crea automáticamente.
3. Elija el modo inicial:
   - **Automático**: sube si el servidor está vacío; descarga si el servidor ya tiene datos.
   - **Descargar del servidor**: reemplaza los datos locales por los de la nube.
   - **Subir este equipo**: envía todo el contenido local y combina con lo existente.
   - **Combinar cambios**: sube y baja; en conflictos gana la edición más reciente.
4. Repita la conexión en los demás equipos con la **misma cuenta de nube**.

### Cómo funciona

- La tabla `public.inventra_records` guarda cada registro como JSON, identificado por `(table_name, record_id)`.
- La app usa Supabase Auth para proteger la tabla con RLS: solo usuarios autenticados del proyecto acceden.
- Se sincronizan usuarios (incluidos roles y hashes PBKDF2 de las contraseñas), configuración, productos, movimientos, lotes, BOM, producción, PNC, ubicaciones, traslados, despachos, conteos y auditoría.
- No se sincronizan los contadores locales ni el `outbox` heredado. Con la nube activa, los códigos generados agregan un sufijo del dispositivo para evitar colisiones sin conexión.
- Los campos volátiles del usuario (`lastLoginAt`, `failedAttempts`, `lockedUntil`) son propios de cada equipo y no viajan.
- Los conflictos se resuelven por **última escritura gana**, usando la marca de tiempo del dispositivo y su ID como desempate. En campos únicos (`users.email`, `products.sku`, `locations.code`, `machines.code`) el registro remoto tiene prioridad.
- El servidor también descarta escrituras cuya marca de tiempo sea más antigua que la copia central, para que un equipo desactualizado no sobrescriba cambios recientes. Mantenga la fecha y hora de los equipos sincronizadas.
- Al recibir movimientos de otro equipo, el stock de cada producto y el stock por ubicación se recalculan desde el historial local de movimientos. Así las existencias no dependen de valores derivados que viajen desactualizados.
- La sincronización se dispara al guardar cambios, al recuperar conexión, al enfocar la ventana y cada 30 segundos.
- La contraseña de la nube no se guarda en el equipo: Supabase conserva una sesión renovable.

### Seguridad

- La **anon key** es pública por diseño; la protección real la da la cuenta autenticada y las políticas RLS.
- Cualquier persona con la URL del proyecto y la anon key puede crear una cuenta si la confirmación de correo está desactivada. Para un entorno real, restrinja el registro o use cuentas creadas previamente desde Supabase.
- Los hashes PBKDF2 de los usuarios viajan entre equipos para que las credenciales funcionen en todos. Proteja la cuenta de nube y la base central.
- Use HTTPS en producción. La app acepta `http://localhost` solo para desarrollo.

### Problemas frecuentes

| Síntoma | Solución |
| --- | --- |
| «La tabla inventra_records no existe» | Ejecute `public/supabase-schema.sql` en el SQL Editor. |
| «Correo o contraseña de la nube incorrectos» | Revise la cuenta; si la creó antes, use la misma contraseña. |
| Supabase exige confirmar el correo | Confirme el enlace o desactive **Confirm email**. |
| La sesión de la nube expiró | Vuelva a conectar el dispositivo desde **Nube y sincronización**. |
| Un equipo no ve los cambios | Pulse **Sincronizar ahora**; revise el indicador de la nube en la barra superior. |

## Reiniciar la aplicación

Desde la consola del navegador:

```js
indexedDB.deleteDatabase('inventra');
localStorage.clear();
location.reload();
```

La aplicación volverá a crear la configuración y las cuentas de acceso al recargar, sin datos operativos.
