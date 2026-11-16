# Invencodi — Diseño de navegación

## Estructura adaptativa

- **Celular (< 900 px):** barra inferior de 5 accesos + menú "Más" (hoja deslizante) + botón flotante de acción rápida.
- **Tableta / escritorio (≥ 900 px):** menú lateral fijo colapsable + barra superior con búsqueda global.

## Mapa de pantallas

```
Login / Recuperar acceso
└─ Inicio (Dashboard)
   ├─ Productos ─────────────── lista · ficha · nuevo/editar · etiqueta QR
   ├─ Movimientos
   │   ├─ Entradas ──────────── compra · devolución · ajuste+ · traslado
   │   ├─ Salidas ───────────── consumo · despacho · venta · baja · ajuste−
   │   └─ Kardex ────────────── historial por producto
   ├─ Almacén
   │   ├─ Ubicaciones 5S ────── curado · PT · racks · estibas · pasillos · traslados
   │   └─ Despachos ─────────── picking · Poka-Yoke · remisión PDF · packing list
   ├─ Planta
   │   ├─ Producción ────────── órdenes · nueva · detalle (consumo, cierre)
   │   ├─ Producción diaria ─── captura táctil 4 turnos por máquina
   │   ├─ Máquinas ──────────── inyectoras · sopladoras · extrusoras
   │   ├─ BOM ───────────────── lista · editor · comparar versiones
   │   ├─ MRP ───────────────── órdenes abiertas + programa diario pendiente
   │   └─ PNC / Kaizen ──────── segregación · bloqueo de lote · causa raíz
   ├─ Análisis
   │   ├─ Indicadores OEE ───── OEE · scrap · rotación PT · días · IRA
   │   ├─ Reportes ──────────── existencias · valorización · rotación · trazabilidad
   │   ├─ Conteo físico
   │   └─ Alertas
   ├─ Administración
   │   ├─ Importar / exportar ─ plantillas y reportes Excel
   │   ├─ Usuarios y roles
   │   ├─ Configuración
   │   ├─ Auditoría
   │   └─ Respaldos (exportar/importar JSON)
   └─ Perfil / Cerrar sesión
```

## Accesos rápidos (FAB)

`Escanear QR` · `Registrar entrada` · `Registrar salida` · `Nueva orden de producción` · `Registrar turno` · `Despacho`

## Permisos por rol

| Módulo | Admin | Jefe inv. | Almacenista | Producción | Consulta |
|---|:--:|:--:|:--:|:--:|:--:|
| Dashboard | ✔ | ✔ | ✔ | ✔ | ✔ |
| Productos (ver) | ✔ | ✔ | ✔ | ✔ | ✔ |
| Productos (crear/editar) | ✔ | ✔ | — | — | — |
| Entradas | ✔ | ✔ | ✔ | — | — |
| Salidas | ✔ | ✔ | ✔ | — | — |
| Producción (órdenes) | ✔ | ✔ | — | ✔ | — |
| Producción diaria (4 turnos) | ✔ | ✔ | — | ✔ | — |
| Máquinas | ✔ | ✔ | — | ✔ | — |
| BOM (editar) | ✔ | ✔ | — | ✔ | — |
| MRP | ✔ | ✔ | — | ✔ | — |
| Ubicaciones y traslados 5S | ✔ | ✔ | ✔ | — | — |
| Despachos / Poka-Yoke | ✔ | ✔ | ✔ | — | — |
| PNC / Kaizen | ✔ | ✔ | ✔ | ✔ | — |
| Indicadores OEE | ✔ | ✔ | ✔ | ✔ | ✔ |
| Reportes | ✔ | ✔ | ✔ | ✔ | ✔ |
| Conteo físico | ✔ | ✔ | ✔ | — | — |
| Importar / exportar Excel | ✔ | ✔ | — | — | — |
| Usuarios / Config | ✔ | — | — | — | — |
| Auditoría | ✔ | ✔ | — | — | — |
| Autorizar stock negativo | ✔ | ✔ | — | — | — |

## Principios de UX

1. **Máximo 3 toques** para registrar un movimiento; en planta, botones grandes por turno y máquina.
2. Confirmación explícita con resumen (producto, cantidad, saldo resultante) antes de impactar inventario.
3. Errores en lenguaje operativo ("No hay suficiente stock: disponible 12 UND").
4. Estados vacíos con llamada a la acción.
5. Feedback inmediato (toast) + opción "Deshacer" solo vía reversión autorizada.
6. Modo offline visible con contador de operaciones pendientes de sincronizar.
7. Objetivos táctiles ≥ 44 px, entradas numéricas con stepper y validación Poka-Yoke con respuesta visual verde/rojo.
