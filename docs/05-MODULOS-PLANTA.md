# INVENTRA — Módulos de planta

Documentación funcional y técnica de los módulos añadidos para operación industrial: producción diaria, máquinas, almacén 5S, despachos, PNC/Kaizen, Excel e indicadores.

---

## 1. Resumen de módulos

| Módulo | Ruta | Permiso | Propósito |
|---|---|---|---|
| Producción diaria | `/produccion-diaria` | `production.daily` | Captura táctil de 4 turnos por máquina, conformes vs. scrap y OEE en tiempo real. |
| Máquinas | `/maquinas` | `production.manage` | Catálogo de inyectoras, sopladoras, extrusoras y otras. |
| MRP | `/mrp` | `mrp.view` | Requerimiento neto de órdenes abiertas + programa diario pendiente. |
| Ubicaciones 5S | `/ubicaciones` | `warehouse.locations` | Mapa de curado, PT, racks, estibas, pasillos, despacho y devoluciones; traslados internos. |
| Despachos | `/despachos` | `dispatch.manage` | Picking list, Poka-Yoke por escaneo, remisión PDF y packing list Excel. |
| PNC / Kaizen | `/pnc` | `pnc.manage` | Segregación y bloqueo de lote, causa raíz y cierre. |
| Importar / exportar | `/datos` | `data.import` | Plantillas Excel para catálogos y exportación de reportes. |
| Indicadores | `/indicadores` | `reports.view` | OEE, scrap, rotación/días de PT, IRA y cumplimiento. |

---

## 2. Producción diaria (4 turnos)

### 2.1 Turnos

| Turno | Horario | Minutos base |
|---|---|---|
| T1 | 06:00–12:00 | 360 |
| T2 | 12:00–18:00 | 360 |
| T3 | 18:00–00:00 | 360 |
| T4 | 00:00–06:00 | 360 |

El turno actual se preselecciona según la hora del dispositivo; el usuario puede cambiarlo.

### 2.2 Captura

Cada registro (`production_records`) guarda:

- Fecha, turno, máquina (código y nombre) y producto terminado/en proceso.
- Orden de producción opcional.
- Cantidad programada, piezas conformes, scrap y golpes.
- Cavidades, ciclo ideal, minutos planificados y minutos de paro.
- Motivo operativo del scrap y notas del turno.
- Lote generado con formato `L-AAAAMMDD-Tn-CODIGO`.
- Usuario, fecha/hora y estado (`abierto` o `validado`).

### 2.3 Validaciones al guardar

- Fecha obligatoria y turno válido (1–4).
- Máquina existente y activa.
- Producto existente.
- Cantidad programada > 0.
- Conformes y scrap ≥ 0, con al menos una pieza registrada.
- Minutos planificados > 0 y paro entre 0 y el tiempo planificado.

### 2.4 Validación del turno

Al pulsar **Guardar y validar** se ejecuta una transacción atómica:

1. Si hay piezas conformes: crea un movimiento `PROD_IN` con costo estándar (materiales del BOM + mano de obra) y actualiza stock global y `location_stock`.
2. Si hay scrap: crea un `PNC` con estado `segregado`, origen `produccion`, turno, máquina y orden.
3. Marca el registro como `validado`, guarda `movementId`, `pncId`, ubicación y usuario validador.
4. Registra auditoría.

Un registro ya validado no puede validarse dos veces.

### 2.5 OEE

Para cada registro:

```
producido   = conformes + scrap
disponible  = (minutos planificados − paro) / minutos planificados
rendimiento = golpes reales / ((minutos efectivos × 60) / ciclo ideal)
              (si no hay ciclo ideal: producido / programado)
calidad     = conformes / producido
OEE         = disponibilidad × rendimiento × calidad
scrap %     = scrap / producido
```

Los resúmenes por turno, máquina y periodo ponderan por minutos planificados para no sobrerrepresentar capturas cortas.

---

## 3. BOM y MRP integrados

### 3.1 BOM

- Un BOM activo por producto terminado.
- Cada componente define cantidad por unidad de salida, unidad de medida y merma %.
- El costo teórico usa costo de componentes + mano de obra / cantidad de salida.

### 3.2 MRP con programa diario

El MRP combina dos fuentes de demanda:

1. **Órdenes abiertas** (`borrador`, `liberada`, `en_proceso`).
2. **Programa diario pendiente**: para una fecha seleccionada, por producto:
   `pendiente = Σ max(0, programado − conforme)` de los registros de ese día.

Cálculo por componente:

```
requerimiento bruto = Σ (cantidad BOM × (1 + merma%) × demanda)
objetivo            = requerimiento bruto + stock mínimo (si se incluye)
requerimiento neto  = max(0, objetivo − stock disponible)
```

La pantalla muestra:

- Faltantes y cobertura por componente.
- Órdenes que alimentan el cálculo.
- Productos del programa diario pendientes y si tienen BOM activa.
- Advertencia de productos sin BOM (`missingDaily`).

---

## 4. Almacén 5S y trazabilidad por ubicación

### 4.1 Tipos de ubicación

| Tipo | Uso |
|---|---|
| `curado` | Producto recién producido en enfriamiento. |
| `pt` | Producto terminado liberado para despacho. |
| `rack` | Almacenamiento en racks. |
| `estiba` | Almacenamiento en estibas. |
| `pasillo` | Zonas de tránsito/control 5S. |
| `despacho` | Picking y carga de transporte. |
| `devolucion` | Producto devuelto pendiente de inspección. |

### 4.2 Mapa base

El botón **Crear mapa 5S base** crea, solo si no hay ubicaciones:

- `CUR-01` Curado
- `PT-01` Producto terminado
- `RACK-A1`, `RACK-A2`
- `DSP-01` Despacho
- `DEV-01` Devoluciones

### 4.3 Stock por ubicación

- `product.stock` es el saldo global.
- `location_stock` guarda producto + ubicación + lote + cantidad.
- Los movimientos con `locationId` actualizan ambos niveles.
- Los traslados internos mueven `location_stock` sin alterar el stock global.
- La etiqueta de ubicación del producto se sincroniza: una ubicación con stock muestra su nombre; varias muestran “N ubicaciones”.

### 4.4 Traslados

Validaciones:

- Cantidad > 0.
- Origen y destino distintos y existentes.
- Stock suficiente en la ubicación origen (filtrando por lote si se indica).
- Se descuenta por antigüedad (`updatedAt`) y se suma en destino.
- Se crea un registro `transfers` con consecutivo `TR-00001` y auditoría.

---

## 5. Despachos y Poka-Yoke

### 5.1 Estados

```
borrador → picking → despachado
        ↘ anulado
```

### 5.2 Creación

El despacho guarda cliente, pedido, fecha, vehículo, conductor, destino y notas. Cada línea del picking contiene producto, cantidad solicitada, cantidad pickeada, lote y ubicación opcionales, y bandera `scanned`.

### 5.3 Validación Poka-Yoke

El escaneo acepta:

- SKU del producto.
- Código de barras.
- Código de lote.

Debe coincidir con una línea del picking. La línea se marca como escaneada y la cantidad pickeada debe igualar la solicitada.

### 5.4 Confirmación

La confirmación se rechaza si:

- Alguna línea tiene cantidad pickeada ≤ 0.
- La cantidad pickeada no coincide exactamente con la solicitada.
- Alguna línea no fue escaneada.
- No hay stock global suficiente.
- El lote está bloqueado por PNC.
- La ubicación seleccionada no tiene stock suficiente.

Si todo es válido, se crea una salida `SALIDA` por línea, se enlazan los movimientos y el despacho pasa a `despachado`. Un despacho confirmado no se edita ni se anula.

### 5.5 Documentos

- **Remisión PDF** con datos del cliente, pedido, vehículo, conductor y líneas.
- **Packing list Excel** con cantidades, lotes y ubicaciones.

---

## 6. Producto no conforme (PNC) y Kaizen

### 6.1 Defectos

`rechupado`, `rafaga` (ráfaga), `rebaba`, `peso` (fuera de especificación), `dimension`, `color` y `otro`.

Los motivos operativos del turno se mapean automáticamente:

| Motivo del turno | Tipo PNC |
|---|---|
| Rechupado | `rechupado` |
| Ráfaga / rebaba | `rafaga` |
| Peso fuera de especificación | `peso` |
| Defecto dimensional | `dimension` |
| Color / contaminación | `color` |
| Arranque de máquina | `otro` |
| Paro de molde | `rebaba` |
| Otro defecto | `otro` |

### 6.2 Estados

```
abierto → segregado → en_analisis → cerrado
                              ↘ reprocesado (libera lote)
                              ↘ desechado
```

### 6.3 Bloqueo de lote

- Crear un PNC `abierto` o `segregado` marca `blocked = true` en los lotes coincidentes.
- Un lote bloqueado no puede despacharse ni usarse en una entrada nueva.
- Solo el cierre como `reprocesado` libera el lote.
- El cierre exige causa raíz registrada y nota de disposición.

### 6.4 Kaizen

Campos: causa raíz (máquina, molde, material, método, mano de obra, medición, medio ambiente), detalle, acción correctiva, responsable y notas. La acción correctiva exige al menos 8 caracteres.

---

## 7. Importación y exportación Excel

### 7.1 Plantillas

| Plantilla | Encabezados |
|---|---|
| Productos | `SKU, NOMBRE, TIPO, UOM, COSTO, STOCK_MIN, STOCK_MAX, UBICACION, CODIGO_BARRAS, LOTE, CATEGORIA, DESCRIPCION` |
| BOM | `BOM_CODIGO, PRODUCTO_SKU, VERSION, CANTIDAD_SALIDA, COMPONENTE_SKU, CANTIDAD, MERMA_PCT, MANO_OBRA, ESTADO` |
| Ubicaciones | `CODIGO, NOMBRE, TIPO, ZONA, CAPACIDAD, ESTADO, NOTAS` |
| Máquinas | `CODIGO, NOMBRE, TIPO, MARCA, CAVIDADES, CICLO_IDEAL_SEG, ESTADO, NOTAS` |

### 7.2 Reglas de importación

- Los encabezados se normalizan (mayúsculas, sin acentos, espacios → `_`).
- Productos: `SKU` y `NOMBRE` obligatorios; el tipo debe ser MP, ME, IN, PP, PT o RE.
- BOM: agrupa por `BOM_CODIGO`; reemplaza los componentes existentes; exige producto y componentes existentes y cantidad > 0.
- Ubicaciones y máquinas: `CODIGO` y `NOMBRE` obligatorios; actualizan si el código ya existe.
- Se reportan filas creadas, actualizadas, omitidas y errores con número de fila.
- Cada importación deja auditoría.

### 7.3 Exportaciones

- Catálogos: productos, BOM, ubicaciones y máquinas.
- Operativas: despachos, PNC e indicadores de planta (resumen, turnos, máquinas, scrap).
- Reportes existentes: existencias, valorización, rotación, consumo, producción y trazabilidad.

---

## 8. Indicadores

### 8.1 OEE

```
Disponibilidad = (minutos planificados − paro) / minutos planificados
Rendimiento    = golpes reales / golpes esperados
Calidad        = conformes / (conformes + scrap)
OEE            = Disponibilidad × Rendimiento × Calidad
```

### 8.2 Scrap

```
Índice de scrap = scrap / (conformes + scrap)
```

Se muestra por turno, por máquina y por tipo de defecto (PNC).

### 8.3 Rotación y días de inventario de PT

```
valor inventario PT = Σ max(0, stock PT) × costo
rotación PT         = valor salidas PT del periodo / valor inventario PT
días de inventario  = valor inventario PT / (valor salidas PT / días del periodo)
```

### 8.4 Exactitud de registros (IRA)

```
IRA = 1 − (Σ |diferencia| × costo / Σ stock sistema × costo)
```

Se calcula con el último conteo físico cerrado. Objetivo ≥ 98%.

### 8.5 Exportación

- Excel: hojas de resumen, turnos, máquinas y scrap por defecto.
- PDF: detalle por turno y totales del periodo.

---

## 9. Permisos

| Permiso | Admin | Jefe | Almacenista | Producción | Consulta |
|---|:--:|:--:|:--:|:--:|:--:|
| `production.daily` | ✔ | ✔ | — | ✔ | — |
| `production.manage` (máquinas) | ✔ | ✔ | — | ✔ | — |
| `mrp.view` | ✔ | ✔ | — | ✔ | — |
| `warehouse.locations` | ✔ | ✔ | ✔ | — | — |
| `dispatch.manage` | ✔ | ✔ | ✔ | — | — |
| `pnc.manage` | ✔ | ✔ | ✔ | ✔ | — |
| `data.import` | ✔ | ✔ | — | — | — |
| `reports.view` (indicadores) | ✔ | ✔ | ✔ | ✔ | ✔ |

---

## 10. Datos iniciales y reinicio

La aplicación arranca sin datos operativos: no hay productos, máquinas, ubicaciones, BOM, órdenes ni registros de producción. El mapa 5S se crea bajo demanda desde **Ubicaciones 5S**.

Para reiniciar desde la consola del navegador:

```js
indexedDB.deleteDatabase('inventra');
localStorage.clear();
location.reload();
```

---

## 11. Extensiones sugeridas

- Sincronización de los nuevos `outbox` (`production_record`, `pnc`, `transfer`, `dispatch`) con backend/ERP.
- Órdenes de mantenimiento ligadas a paros de máquina.
- Costeo real por turno con consumo teórico vs. real de resina.
- Etiquetas QR de ubicación y lote para Poka-Yoke físico.
- Alertas automáticas cuando el OEE o el scrap superan umbrales por turno.
