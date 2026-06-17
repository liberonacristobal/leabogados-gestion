# Cómo leer una cartola BICE — dónde está cada dato

Documento de referencia para el parseo. Explica la estructura de la cartola y, sobre todo,
**dónde vive el RUT del cliente** dentro de la columna "Descripción".

---

## 1. Las columnas de la cartola

La tabla de movimientos tiene estas columnas (ubícalas por su nombre, no por posición fija):

| Fecha | Documento | Descripción | Cargos | Abonos | Saldo Contable |
|-------|-----------|-------------|--------|--------|----------------|

- **Fecha:** viene como `DD-MM`. Cuando una fila trae `-`, significa **misma fecha que la
  fila de arriba** (rellenar hacia abajo).
- **Documento:** número de operación del banco.
- **Descripción:** ACÁ está toda la info comprimida (nombre, RUT, banco, cuenta, fecha/hora).
- **Cargos:** monto cuando es plata que SALE (un pago que hizo la firma).
- **Abonos:** monto cuando es plata que ENTRA (alguien le transfirió a la firma).
- El **monto NUNCA se saca de la Descripción**: se toma de Cargos o de Abonos.

Regla base: si el valor está en **Abonos** → `tipo = 'abono'`. Si está en **Cargos** →
`tipo = 'cargo'`.

---

## 2. Dónde está el RUT del cliente (el dato más importante)

El RUT del cliente que paga está SIEMPRE dentro de la columna Descripción, pero en un lugar
distinto según el tipo de movimiento. Hay 4 formatos. Estos son ejemplos **reales** de tu
cartola, anotados.

### Formato A — ABONO recibido (un cliente le paga a la firma)  ← el que más importa

```
Abono por transferencia de INVERSIONES BATLLE ROMERO LIMITADA Rut 76.637.369-0 desde Banco BCI - MACH el 05/05/2026 a las 07:51
                           └──────── NOMBRE del cliente ──────┘     └─── RUT ───┘
```

- El **nombre** está entre la palabra `de ` y la palabra `Rut`.
- El **RUT** está justo después de `Rut `.
- El **monto** está en la columna **Abonos**.

Más ejemplos reales:
```
Abono por transferencia de GLORIA CHEYRE ALCALDE Rut 5.896.754-8 desde B.Santander el 11/05/2026 a las 23:02
Abono por transferencia de Servicios Profesionales de Salud B Rut 77.696.574-K desde B.Chile el 06/05/2026 a las 23:27
```

### Formato B — CARGO / transferencia a un tercero (la firma le paga a alguien)

```
Transf. a terceros vía internet a cuenta 1944894 B.BICE, CRISTOBAL LIBERONA, Rut 15.621.320-9, el 04-05-2026 alas 08:16:07
                                          └─cuenta─┘ └banco┘  └──── NOMBRE ───┘     └─── RUT ───┘
```

- El **nombre** está entre la coma que sigue al banco y la coma de `, Rut`.
- El **RUT** está después de `Rut `.
- El **monto** está en la columna **Cargos**.
- (Acá el "tercero" es a quien la firma le paga; no es un cliente que abona.)

### Formato C — Traspaso entre cuentas propias (movimiento interno, SIN cliente)

```
Transferencia entre cuentas propias BICE desde cuenta N01-38392-2 hacia cuenta N  01-40383-4, el 05/05/2026a las 08:33:19 hrs.
                                                       └origen─┘            └─destino─┘
```

- **No tiene RUT de cliente** (es plata de la firma moviéndose entre sus dos cuentas).
- `es_interno = true`, `rut = null`.

### Formato D — Pagos sin tercero (tarjeta, SII)

```
Cargo por Pago Tarjeta VISA Nro. XXXX XXXX XXXX 5363.
Cargo por pago SII Nro. Oper. IF240240222095233552, víaElectrónica, el 29/05/2026 a las 18:08, monto $ 713.360,00.
```

- **No traen RUT ni nombre de tercero.** `rut = null`, `nombre = null`. Son cargos sin
  contraparte; no entran a la conciliación.

---

## 3. Reglas de extracción (regex ya probado)

```js
const RUT = String.raw`(\d{1,3}(?:\.\d{3})*-[\dkK])`; // ej: 76.637.369-0  /  77.696.574-K

// Formato A — ABONO recibido: nombre entre "de " y "Rut", rut después de "Rut"
const reAbono  = new RegExp(`Abono por transferencia de (.+?)\\s*Rut\\s*${RUT}`, 'i');

// Formato B — CARGO a tercero: nombre entre el banco y ", Rut", rut después de "Rut"
const reTransf = new RegExp(`a cuenta \\S+ [^,]+,\\s*(.+?),\\s*Rut\\s*${RUT}`, 'i');
```

Pseudocódigo por fila:
```
si Abonos > 0      -> tipo = 'abono'  ; intenta reAbono  para sacar (nombre, rut)
si Cargos > 0      -> tipo = 'cargo'  ; intenta reTransf para sacar (nombre, rut)
si la glosa dice "cuentas propias"  -> es_interno = true ; rut = null
si rut == RUT_PROPIO (77.700.387-9) -> es_interno = true (auto-transferencia)
si no calza ningún patrón (tarjeta/SII) -> rut = null ; nombre = null
```

---

## 4. Trampas reales que DEBES manejar

- **RUT pegado al nombre (sin espacio antes de "Rut"):**
  ```
  Abono por transferencia de RODRIGO ALBERTO MACHO URIBERut 9.619.443-9 desde B.Santander...
                             └──── nombre: RODRIGO ALBERTO MACHO URIBE ───┘ Rut 9.619.443-9
  ```
  El `\s*` antes de `Rut` en el regex ya lo cubre (cero o más espacios). El nombre resultante
  no debe incluir la palabra "Rut".

- **Dígito verificador K** (mayúscula o minúscula): `77.696.574-K`. Cubierto por `[\dkK]`.

- **Nombres truncados por el banco:** "...LIMITA", "...LIMIT", "Tecnologia Y Seguridad Sbs
  Latam S". Se guardan **tal cual**, no inventar el nombre completo.

- **"alas" pegado / "a las":** la glosa a veces escribe la hora pegada ("alas 08:16:07").
  No afecta la extracción porque cortamos en el RUT, antes de la hora.

- **RUT propio aparece como "tercero":** el banco a veces escribe una auto-transferencia
  como `Transf. a terceros ... Liberona Escala Abogados Limitada, Rut 77.700.387-9`. Eso es
  interno: `es_interno = true`.

---

## 5. Cómo saber que leíste TODO bien (verificación obligatoria)

La cartola trae, al pie, un bloque "Resumen del Período" con **Total Cargos** y **Total
Abonos**. Después de parsear:

```
suma de todos los montos de abonos importados  debe ser IGUAL a "Total Abonos" del banco
suma de todos los montos de cargos importados  debe ser IGUAL a "Total Cargos" del banco
```

Si ambas diferencias dan **0**, leíste todos los movimientos sin perder ni duplicar ninguno.
Si no dan 0, hay una fila mal parseada: revísala antes de guardar.
