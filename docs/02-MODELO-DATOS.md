# INVENTRA — Modelo de datos

Base de datos local: **IndexedDB** (Dexie). Los nombres de tabla y campos son los usados en el código (`src/db/schema.ts`).

---

## Diagrama lógico

```
users ─┐
       ├──< movements >── products ──< lots
       │        │              │
       │        └──< production_orders >── boms ──< bom_items
       │                                   │
       ├──< audit_log                      └── products (PT)
       │
       ├──< production_records >── machines
       │        │
       │        └──< pnc
       │
       ├──< dispatches (items embebidos) >── movements
       │
       └──< locations ──< location_stock >── products
                │
                └──< transfers
```

## Tablas

### `users`
| Campo | Tipo | Notas |
|---|---|---|
| id | string (uuid) | PK |
| name, email | string | email único |
| role | `admin` \| `jefe` \| `almacenista` \| `produccion` \| `consulta` | permisos |
| pinHash, salt | string | PBKDF2-SHA256 |
| active | boolean | baja lógica |
| failedAttempts, lockedUntil | number | bloqueo |
| createdAt, lastLoginAt | ISO string | |

### `products`
| Campo | Tipo | Notas |
|---|---|---|
| id | string | PK |
| sku | string | único, índice |
| name, description | string | |
| category | string | línea/categoría |
| type | `MP` \| `ME` \| `IN` \| `PP` \| `PT` \| `RE` | materia prima, empaque, insumo, en proceso, terminado, repuesto |
| uom | `UND` \| `KG` \| `LT` \| `MT` \| `CJA` \| `ROLLO` | |
| cost | number | costo promedio ponderado (COP) |
| stock | number | saldo actual (derivado, mantenido por transacción) |
| minStock, maxStock | number | alertas |
| location | string | ubicación física visible |
| locationId | string? | FK a `locations` cuando el stock está en una sola ubicación |
| barcode | string | EAN/QR, índice |
| lotTracked | boolean | exige lote |
| status | `activo` \| `inactivo` | baja lógica |
| createdAt, updatedAt | ISO | |

### `movements` (kardex, inmutable)
| Campo | Tipo | Notas |
|---|---|---|
| id | string | PK |
| code | string | consecutivo `MOV-000123` |
| type | `ENTRADA` \| `SALIDA` \| `AJUSTE_POS` \| `AJUSTE_NEG` \| `TRASLADO_IN` \| `TRASLADO_OUT` \| `PROD_IN` \| `PROD_CONSUMO` \| `REVERSION` | |
| direction | `1` \| `-1` | signo aplicado al stock |
| reason | string | compra, devolución, despacho, consumo, baja… |
| productId | string | FK |
| qty | number | siempre positivo; el signo lo da `direction` |
| unitCost | number | COP |
| totalCost | number | qty × unitCost |
| stockBefore, stockAfter | number | auditoría del saldo |
| lotId, lotCode | string? | trazabilidad |
| locationId, locationName | string? | ubicación de origen/destino del movimiento |
| counterparty | string? | proveedor / cliente / destino |
| refDoc | string? | factura, remisión, OP |
| orderId | string? | orden de producción |
| notes | string? | |
| userId, userName | string | responsable |
| createdAt | ISO | fecha/hora |
| reversalOf | string? | id del movimiento revertido |
| reversedBy | string? | id de la reversión |

### `lots`
`id, productId, code, qty, unitCost, receivedAt, expiresAt?, blocked?`
> `blocked = true` cuando un PNC segregado bloquea el lote; el despacho lo rechaza.

### `boms`
`id, code, productId (PT), version, status (borrador|activo|obsoleto), outputQty, laborCost, notes, createdAt, createdBy`
> Un solo BOM `activo` por producto terminado.

### `bom_items`
`id, bomId, componentId, qty (por unidad de salida), uom, wastePct`

### `production_orders`
| Campo | Notas |
|---|---|
| id, code | `OP-0001` |
| productId, bomId, bomVersion | producto terminado y versión usada |
| plannedQty, producedQty, rejectedQty | cantidades |
| status | `borrador` → `liberada` → `en_proceso` → `cerrada` \| `cancelada` |
| materialsCost, laborCost, totalCost | costeo |
| scheduledDate, startedAt, closedAt | |
| userId, notes | |

### `production_consumptions`
`id, orderId, productId, plannedQty, realQty, wasteQty, lotId?, unitCost, totalCost, createdAt`

### `machines`
| Campo | Notas |
|---|---|
| id, code | `code` único (ej. `INY-01`) |
| name, brand | identificación |
| type | `inyectora` \| `sopladora` \| `extrusora` \| `otra` |
| cavities | cavidades por golpe |
| idealCycleSeconds | ciclo ideal por golpe |
| status | `activa` \| `mantenimiento` \| `inactiva` |
| locationId?, notes | ubicación y observaciones |
| createdAt, updatedAt | |

### `production_records` (captura diaria por turno)
| Campo | Notas |
|---|---|
| id, code | `PR-00001` |
| date | `YYYY-MM-DD` |
| shift | `1` \| `2` \| `3` \| `4` (06–12, 12–18, 18–00, 00–06) |
| machineId, machineCode, machineName | máquina que produjo |
| productId, productSku, productName | producto terminado / en proceso |
| orderId? | OP asociada (opcional) |
| plannedQty, goodQty, scrapQty | programado, conformes y scrap |
| shots, cavities | golpes e cavidades para rendimiento |
| plannedMinutes, downtimeMinutes | base de disponibilidad |
| idealCycleSeconds | base de rendimiento |
| scrapReason | motivo operativo del scrap |
| status | `abierto` \| `validado` |
| lotCode | lote generado (`L-AAAAMMDD-Tn-CODIGO`) |
| locationId?, movementId?, pncId? | trazabilidad al validar |
| userId, userName, createdAt, validatedAt?, validatedBy? | auditoría |

### `pnc` (producto no conforme)
| Campo | Notas |
|---|---|
| id, code | `PNC-00001` |
| date | fecha del evento |
| productId, productSku, productName | producto afectado |
| lotCode, qty, unitCost | lote segregado y valor |
| defectType | `rechupado` \| `rafaga` \| `rebaba` \| `peso` \| `dimension` \| `color` \| `otro` |
| source | `produccion` \| `almacen` \| `cliente` \| `inspeccion` |
| machineId?, shift?, orderId?, productionRecordId? | origen |
| status | `abierto` → `segregado` → `en_analisis` → `cerrado` \| `reprocesado` \| `desechado` |
| containment, rootCause, rootCauseDetail, correctiveAction, responsible, kaizenNotes, disposition | contención y Kaizen |
| userId, userName, createdAt, closedAt? | auditoría |

### `locations` (mapa 5S)
`id, code (único), name, type (curado|pt|rack|estiba|pasillo|despacho|devolucion), zone, capacity, status (activa|inactiva), notes, createdAt, updatedAt`

### `location_stock`
`id, productId, locationId, lotCode?, qty, updatedAt`
> Saldo por producto + ubicación + lote. La suma de `location_stock` de un producto debe cuadrar con `product.stock` (salvo movimientos sin ubicación).

### `transfers`
`id, code (TR-00001), productId, productSku, productName, qty, uom, fromLocationId, fromLocationName, toLocationId, toLocationName, lotCode?, notes, userId, userName, createdAt`

### `dispatches`
| Campo | Notas |
|---|---|
| id, code | `DSP-00001` |
| date, customer, orderRef | fecha, cliente y pedido |
| vehicle, driver, destination, notes | logística |
| status | `borrador` → `picking` → `despachado` \| `anulado` |
| items | líneas embebidas `{productId, sku, name, uom, requestedQty, pickedQty, lotCode?, locationId?, locationName?, scanned}` |
| remision, packingList | documentos generados |
| movementIds? | salidas creadas al confirmar |
| userId, userName, createdAt, dispatchedAt? | auditoría |

### `audit_log`
`id, entity, entityId, action (crear|actualizar|revertir|login|cierre), before?, after?, userId, userName, at`

### `counts` (conteo físico)
`id, code, status (abierto|cerrado), location?, createdAt, closedAt, userId, items: [{productId, systemQty, countedQty, diff, unitCost}]`

### `settings`
`companyName, nit, currency, allowNegativeStock, sessionMinutes, lowStockAlert, decimals, logo?`

### `counters`
Consecutivos por prefijo (`MOV`, `OP`, `BOM`, `CNT`, `PR`, `PNC`, `TR`, `DSP`).

## Índices principales

```
products: id, &sku, barcode, type, category, status, [type+status]
movements: id, code, productId, type, createdAt, orderId, [productId+createdAt]
boms: id, productId, status, [productId+status]
production_orders: id, code, status, productId
machines: id, &code, type, status
production_records: id, code, date, shift, machineId, productId, orderId, status, [date+shift], [date+machineId], [machineId+date]
pnc: id, code, date, productId, lotCode, status, defectType, productionRecordId, [date+status]
locations: id, &code, type, zone, status
location_stock: id, productId, locationId, [productId+locationId], [locationId+productId]
transfers: id, code, productId, fromLocationId, toLocationId, createdAt
dispatches: id, code, status, customer, date, createdAt
```

## Integridad

- `stock` del producto **siempre** igual a la suma algebraica de sus movimientos. Verificable con *Auditoría → Recalcular saldos*.
- La suma de `location_stock` de un producto refleja el stock físico ubicado; los movimientos sin ubicación explícita se descuentan de la ubicación disponible (FEFO) o del saldo global.
- Un lote con `blocked = true` no puede usarse en entradas nuevas ni despachos hasta que el PNC se cierre como `reprocesado`.
- Borrado lógico únicamente (`status = inactivo`); nunca se elimina un producto con movimientos.
- Toda operación que toca stock corre dentro de `db.transaction('rw', ...)`.
- Validar un turno es idempotente por estado: un registro `validado` no vuelve a generar `PROD_IN` ni PNC.
- Un despacho confirmado no se edita ni anula; las salidas quedan enlazadas en `movementIds`.
