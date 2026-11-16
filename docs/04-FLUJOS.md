# Invencodi — Flujos operativos

## F1. Entrada por compra
1. Almacenista → **Entradas → Compra**.
2. Escanea/elige producto, digita cantidad, costo unitario, proveedor, factura y lote (si aplica).
3. El sistema muestra saldo actual → saldo resultante y recalcula el **costo promedio ponderado**.
4. Confirma → se crea `movement(ENTRADA)` + `lot` + actualización de `product.stock` y `product.cost` en una transacción.
5. Toast con enlace al kardex.

**Validaciones:** cantidad > 0, costo ≥ 0, producto activo, lote obligatorio si `lotTracked`.

## F2. Salida por despacho
1. **Salidas → Despacho** → producto y cantidad, o use el módulo **Despachos** para picking con Poka-Yoke (F10).
2. Validación de disponibilidad. Si el saldo quedaría negativo:
   - bloqueo si el rol no tiene `inventory.override`;
   - si lo tiene, exige motivo y autorización registrada.
3. Descuento FEFO de lotes si el producto es rastreado; los lotes bloqueados por PNC se omiten y el despacho se rechaza.
4. Se registra destino, documento, responsable y observaciones.

## F3. Orden de producción
```
Crear OP (PT + cantidad + BOM activo)
      ↓
Explosión de materiales: qty_componente × cantidad × (1 + merma%)
      ↓
Validación de disponibilidad → semáforo (verde/amarillo/rojo)
      ↓  (si hay faltantes: lista de compra sugerida)
Liberar → En proceso
      ↓
Registrar consumo real por componente (descuenta stock, guarda lote y costo)
Registrar merma / desperdicio
      ↓
Registrar cantidad fabricada y rechazada
      ↓
Cerrar OP → ingresa PT al inventario (PROD_IN) con costo = materiales + mano de obra
      ↓
Trazabilidad: OP ↔ consumos ↔ lote de PT ↔ movimientos
```

## F4. Ajuste por conteo físico
1. **Conteo físico** → seleccionar ubicación o categoría → genera lista con saldo del sistema.
2. Se digita la cantidad contada; el sistema calcula la diferencia valorizada.
3. Al cerrar, se generan automáticamente `AJUSTE_POS` / `AJUSTE_NEG` por cada diferencia, con documento `CNT-xxxx`.
4. Queda registro de exactitud del inventario para el KPI.

## F5. Reversión de un movimiento
1. Kardex → movimiento → **Revertir** (solo Admin/Jefe).
2. Se exige motivo. El sistema verifica que el saldo permita la reversión.
3. Crea un movimiento `REVERSION` con signo contrario, enlazado a `reversalOf`; el original queda marcado `reversedBy`.
4. Nunca se borra ni se edita el movimiento original.

## F6. Traslado entre ubicaciones
Salida de origen (`TRASLADO_OUT`) + entrada en destino (`TRASLADO_IN`) con el mismo `refDoc`, en una sola transacción. En el módulo **Ubicaciones 5S** el traslado mueve `location_stock` (origen → destino, por lote) y registra `transfers` con consecutivo `TR-xxxxx`; el stock global del producto no cambia.

## F7. Offline
1. Sin red, todo funciona igual (IndexedDB).
2. Cada escritura encola un evento en `outbox`.
3. Al recuperar conexión, se hace push ordenado y luego pull incremental; conflictos por `updatedAt` + regla de negocio (los movimientos nunca se sobreescriben, se concatenan).

## F8. Registro diario de producción (4 turnos)
```
Seleccionar fecha → turno (T1..T4) → máquina (inyectora/sopladora) → producto/OP
      ↓
Capturar programado, golpes, cavidades, conformes, scrap, paros y motivo
      ↓
Vista previa OEE: Disponibilidad × Rendimiento × Calidad
      ↓
[Guardar turno]  → queda abierto, editable
[Guardar y validar] → PROD_IN por conformes + PNC por scrap + stock por ubicación
      ↓
El MRP toma la demanda pendiente = programado − conforme del día
```
**Validaciones:** turno válido, máquina activa, producto existente, cantidades ≥ 0, programado > 0, paro ≤ tiempo planificado, al menos una pieza conforme o scrap.

## F9. Mapa 5S y trazabilidad por ubicación
1. **Ubicaciones 5S → Crear mapa base** si aún no existe: Curado, PT, Racks, Despacho y Devoluciones.
2. Cada ubicación tiene tipo, zona, capacidad y estado; la vista muestra ocupación y productos/lotes almacenados.
3. **Traslado interno**: producto, cantidad, origen, destino y lote opcional. El sistema valida stock en origen y mueve el detalle por ubicación.
4. Al validar producción, el PT entra a la ubicación Curado/PT configurada; al despachar, la salida descuenta la ubicación seleccionada.

## F10. Despacho con Poka-Yoke
```
Crear despacho (cliente, pedido, vehículo, destino) → agregar líneas del picking
      ↓
Para cada línea: ubicación/lote + cantidad pickeada
      ↓
Escanear SKU, código de barras o lote → validación Poka-Yoke (verde/rojo)
      ↓
Confirmar despacho: exige cantidad exacta, escaneo, stock global y por ubicación, lote no bloqueado
      ↓
Genera salidas SALIDA (una por línea) + estado despachado
      ↓
Remisión PDF y packing list Excel
```
**Regla:** si falta una línea, la cantidad no coincide o el lote está bloqueado por PNC, el despacho no se confirma.

## F11. Producto no conforme y Kaizen
1. **PNC → Nuevo**: producto, lote, cantidad, defecto (rechupado, ráfaga, rebaba, peso, dimensión, color, otro), origen y turno/máquina.
2. Al crearlo queda `segregado` y el lote se marca `blocked = true`; no puede despacharse.
3. **Análisis Kaizen**: causa raíz (máquina, molde, material, método, mano de obra, medición, medio ambiente), detalle, acción correctiva y responsable.
4. **Cierre**: `cerrado`, `reprocesado` o `desechado`. Solo `reprocesado` libera el lote.
5. El scrap de un turno validado crea su PNC automáticamente.

## F12. Importación y exportación Excel
1. **Importar / exportar → Plantilla**: descarga `.xlsx` con encabezados y ejemplo para productos, BOM, ubicaciones o máquinas.
2. Complete la plantilla y súbala; el sistema normaliza encabezados, valida obligatorios y reporta filas creadas, actualizadas, omitidas y errores.
3. **Exportar catálogos**: productos, BOM, ubicaciones, máquinas y reportes operativos (despachos, PNC, indicadores).
4. La importación de BOM agrupa por `BOM_CODIGO` y reemplaza los componentes de la versión.

## F13. Indicadores de planta
- **OEE** por registro, turno, máquina y periodo: `A × R × C`.
  - Disponibilidad = (minutos planificados − paro) / minutos planificados.
  - Rendimiento = golpes reales / golpes esperados (o producido / programado si no hay ciclo ideal).
  - Calidad = conformes / (conformes + scrap).
- **Índice de scrap** = scrap / (conformes + scrap), por turno y por tipo de defecto.
- **Rotación de PT** = valor de salidas de PT del periodo / valor del inventario PT actual.
- **Días de inventario PT** = valor inventario PT / (salidas PT del periodo / días del periodo).
- **IRA** = 1 − (valor absoluto de diferencias del último conteo cerrado / valor del inventario contado). Objetivo ≥ 98%.
- Exportación a Excel (resumen, turnos, máquinas, scrap) y PDF.
