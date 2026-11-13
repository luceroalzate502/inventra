# INVENTRA — Arquitectura de la solución

Aplicación móvil de gestión integral de inventarios industriales (materias primas → producción → producto terminado → despacho).

---

## 1. Decisión de plataforma

| Criterio | Decisión | Justificación |
|---|---|---|
| Tipo de app | **PWA (Progressive Web App)** con React + TypeScript | Instalable en Android/iOS/tablet desde el navegador, un solo código, sin tiendas ni compilación nativa. |
| Persistencia | **IndexedDB** (Dexie) | Base de datos transaccional en el dispositivo, soporta miles de registros y consultas indexadas. |
| Offline | **Offline-first real** | La app funciona sin red; los movimientos se guardan localmente y quedan en cola de sincronización. |
| Sincronización | Capa `sync/` desacoplada (outbox + pull incremental) | Lista para conectarse a un backend/ERP sin reescribir la app. |
| Moneda | COP (`Intl.NumberFormat es-CO`) | Requisito del negocio. |

> El equipo no tenía Node instalado; se instaló Node LTS y el proyecto se compila con Vite.

## 2. Capas

```
UI (React + TS)                 src/pages, src/components
   │  hooks de datos
Estado / lógica de dominio      src/domain  (reglas de negocio puras y testeables)
   │  repositorios
Persistencia                    src/db      (Dexie / IndexedDB)
   │  outbox
Sincronización (opcional)       src/sync    (push/pull, resolución de conflictos)
```

**Regla de oro:** ninguna pantalla escribe stock directamente. Todo movimiento pasa por `domain/movements.ts`, que valida, calcula costo y actualiza existencias globales y por ubicación dentro de una transacción de IndexedDB. Los módulos de planta (`productionDaily.ts`, `warehouse.ts`, `dispatch.ts`, `pnc.ts`) orquestan esas reglas sin duplicarlas.

## 3. Módulos funcionales

1. **Autenticación y usuarios** — roles, permisos, PIN/contraseña con PBKDF2, bitácora.
2. **Panel de control** — KPIs, alertas, gráficos, movimientos recientes.
3. **Productos** — 6 tipos de inventario, SKU, ubicación, mín/máx, código de barras.
4. **BOM** — versiones, componentes, costo teórico, explosión de materiales.
5. **Entradas** — compras, devoluciones, producción, ajustes+, traslados.
6. **Salidas** — consumo, despacho, venta, devolución a proveedor, ajustes−, bajas.
7. **Producción** — órdenes, disponibilidad, consumo real, mermas, cierre, ingreso de PT.
8. **Producción diaria** — captura táctil por 4 turnos, máquina y molde; conformes vs. scrap, OEE en tiempo real.
9. **Máquinas** — catálogo de inyectoras, sopladoras y extrusoras con cavidades y ciclo ideal.
10. **MRP** — requerimiento neto de órdenes abiertas + programa diario pendiente, con BOM y stock mínimo.
11. **Almacén 5S** — ubicaciones (curado, PT, racks, estibas, pasillos, despacho, devoluciones), ocupación y traslados internos.
12. **Despachos** — picking list, validación Poka-Yoke por escaneo, remisión PDF y packing list Excel.
13. **PNC y Kaizen** — segregación, bloqueo de lote por defecto, análisis de causa raíz y cierre.
14. **Importar / exportar** — plantillas Excel para catálogos y exportación de reportes operativos.
15. **Indicadores** — OEE, scrap, rotación y días de inventario de PT, IRA y cumplimiento.
16. **Reportes** — kardex, existencias, valorización, rotación, trazabilidad; Excel y PDF.
17. **Auditoría** — historial inmutable, reversiones autorizadas.

## 4. Reglas de negocio transversales

- **No stock negativo**: una salida que deje el saldo bajo cero se bloquea salvo permiso `inventory.override` + motivo.
- **Movimientos inmutables**: no se editan ni eliminan; se corrigen con un movimiento de reversión que referencia el original.
- **Trazabilidad por lote**: si el producto es `lotTracked`, toda entrada exige lote y toda salida descuenta lotes (FEFO). Un lote bloqueado por PNC no puede despacharse.
- **Costo**: costo promedio ponderado móvil por producto, recalculado en cada entrada.
- **Producción**: el consumo descuenta inventario y el cierre ingresa PT; el costo del PT = costo de materiales + mano de obra opcional.
- **Validación de turno**: las piezas conformes generan `PROD_IN` y stock por ubicación; el scrap genera un `PNC` segregado en la misma transacción.
- **Almacén por ubicación**: `product.stock` es el saldo global; `location_stock` mantiene el detalle por ubicación y lote. Los traslados mueven ambos sin alterar el total.
- **Despacho Poka-Yoke**: solo se confirma si cada línea tiene cantidad pickeada exacta, escaneo validado, stock global y por ubicación suficientes, y lote no bloqueado.
- **Indicadores**: OEE = disponibilidad × rendimiento × calidad; scrap = scrap / (conformes + scrap); IRA = 1 − (valor absoluto de diferencias / valor del inventario contado).
- **Auditoría**: cada escritura deja registro con usuario, fecha/hora y valores antes/después.

## 5. Seguridad

- Contraseña/PIN → PBKDF2-SHA256 (100k iteraciones, sal aleatoria) vía Web Crypto.
- Sesión con expiración por inactividad (configurable).
- Matriz de permisos por rol evaluada en UI **y** en dominio.
- Bloqueo tras 5 intentos fallidos.
- Datos en reposo: IndexedDB del dispositivo; exportación de respaldo cifrable en el backend.

## 6. Fases de construcción

| Fase | Entregable | Estado |
|---|---|---|
| 0 | Arquitectura, modelo de datos, navegación, flujos | ✔ |
| 1 | Base técnica, DB, seed, autenticación y shell de navegación | ✔ |
| 2 | Productos + movimientos (entradas/salidas) + kardex | ✔ |
| 3 | BOM + producción con descuento/ingreso automático | ✔ |
| 4 | Dashboard, KPIs, reportes y exportaciones | ✔ |
| 5 | Auditoría, ajustes, conteo físico, respaldos | ✔ |
| 6 | Sync con backend/ERP y notificaciones push | pendiente (capa lista) |
| 7 | Módulos de planta: producción diaria 4 turnos, máquinas, almacén 5S, despachos Poka-Yoke, PNC/Kaizen, Excel e indicadores | ✔ |
