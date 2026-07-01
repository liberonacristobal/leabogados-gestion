# Guía de uso — Gestión Liberona Escala Abogados

Guía práctica para el equipo. Está escrita por tareas: buscas lo que necesitas hacer y ahí están los pasos. Borrador V1 — si algo no calza con lo que ves en pantalla, avísame y lo ajusto.

---

## Antes de empezar

- **Entrar:** abre **gestion.leabogados.cl** y toca "Iniciar sesión con Google" con tu correo **@leabogados.cl**. No hay usuario ni clave aparte.
- **Dónde se usa:** principalmente desde el **iPhone**. Todo está pensado para tocar con el pulgar.
- **Qué ves según tu rol:**
  - **Cristóbal y Erasmo** (administración): ven todo.
  - **Martín, Martina y Rodrigo**: ven **Tareas, Gastos y Caja Chica**.

### Tres cosas que sirven en toda la app

1. **La lupa (arriba a la derecha) — tu punto de entrada universal.** Ábrela y escribe: un cliente, una factura, una venta o una tarea, y salta directo. También ejecuta acciones (Redactar con IA, Conciliar, Generar reporte…). Aprende lo que más usas y te lo ofrece primero.
2. **Todo es clickeable.** El **nombre de un cliente** abre su ficha desde cualquier vista. Una factura te lleva a su venta; un movimiento del banco, a su factura. Y la flecha **←** te devuelve al **lugar exacto** donde estabas.
3. **La app aprende.** Cada vez que asignas algo —una razón social, el cliente de un cargo del banco, el proyecto de un gasto— la app lo recuerda y **no te vuelve a preguntar**. Puedes ver y corregir todo lo aprendido en el menú ☰ → "Lo que aprendí".

---

## Para todo el equipo

### Tareas
- Crea una tarea con cliente, proyecto, responsable(s) y plazo.
- **Delegar:** al asignarla a otra persona, el plazo se corre según la regla del estudio.
- Se envían **correos** al crear, delegar y terminar una tarea, y hay **recordatorios** los lunes, miércoles y viernes de lo pendiente.
- El badge del header (ámbar = para hoy, rojo = vencidas) abre el panel de tareas.

### Gastos
- Registra un gasto con **monto, fecha, cliente y categoría**. Si es de una razón social específica del cliente, la asignas dentro del mismo gasto.
- La app **sugiere** el cliente/categoría según lo que ya aprendió de glosas parecidas.
- Un gasto puede ser **operativo** (descuenta saldo del cliente) o **histórico** (no descuenta). Se clasifica con el chip "Estado".
- **Conviene rendir:** si un cliente acumula gastos sin rendir por más de 30 días, la app te avisa y te ofrece "Rendir".

### Caja Chica
- Registra los gastos que pagas de tu caja (Martín / Martina).
- Cuando administración **liquida**, esos gastos quedan marcados como rendidos y tu saldo se ajusta.
- El saldo de tu caja siempre resta **todos** los gastos cargados.

---

## Para administración (Cristóbal y Erasmo)

### Inicio (Dashboard)
- La **foto del año**: vendido, meta, por cobrar, cobrado — en UF o CLP.
- **Qué atender hoy**: facturas vencidas, por cobrar esta semana, caja chica sin liquidar. Todo clickeable hacia su lista.
- Cada cifra abre el detalle que la compone; cada nombre de cliente abre su ficha.

### Ventas
- **Vendido del año** (UF/CLP) y el detalle por **abogado / área** con subtotales.
- **Nueva venta/propuesta:** cliente, área, proyecto, monto (UF), tipo de cobro (cuotas, mensual, etc.). El **responsable se autocompleta** con el abogado del cliente.
- Solo una venta **Aceptada (Activo)** genera las cuotas programadas; una Propuesta/Borrador no.
- El cobro puede tener **cuotas distintas** y se pueden **editar** las cuotas ya guardadas.

### Facturación
- Vista "**Etapas del cobro**": un protagonista (Por cobrar) con Vencido / Al día anidados, más Cobrado, Por facturar, Anticipos y Proveedores.
- Cada estado tiene su **color e ícono** (Vencido rojo, Por cobrar navy, Cobrado verde, etc.) y abre su lista.
- Por factura puedes **anular**, registrar pago, enviar por correo. El estado de una factura sale de una sola fórmula (saldo), así que las cifras siempre cuadran.
- **Anticipos:** cubren cuotas sin doble conteo (la cuota queda "Anticipada").

### Conciliación bancaria
- Subes la cartola del BICE y la app la cruza con tus facturas y fondos.
- La cartola se agrupa por **año › mes** (colapsable); los descalces y lo sin identificar se resuelven ahí.
- "**Costo de oficina…**" enlaza un cargo a un costo estructural del estudio (con categoría y subcategoría que la app aprende).
- Todo cambio es **reversible** (Deshacer).

### Clientes y su ficha
- Lista con **buscador** e índice A-Z. El nombre humano del cliente adelante, la razón social debajo.
- La **ficha** tiene 4 pestañas: **Resumen, Contacto, Ventas, Cartola**.
  - En **Contacto** están: identificación, razones sociales, personas de contacto, destinatario de facturas y **Documentos (Drive)**.
  - **Documentos (Drive):** vincula sola la carpeta del cliente (por nombre) y navegas sus subcarpetas y archivos; tocas uno y se abre en Drive.

### Costos de Oficina
- Registra los costos de la firma (sueldos, arriendo, servicios) en un cliente interno.
- Se agrupan por **mes** (colapsable) y por **categoría › subcategoría**; las categorías **aprenden** con el uso.

### Rendiciones a clientes
- Rinde los gastos de un cliente: eliges el período, los gastos y el proyecto (que además **asigna** el proyecto a esos gastos).
- Genera el **correo + PDF** de rendición (bilingüe ES/EN si hace falta), con tu **firma** (logo, nombre, cargo, teléfono).
- Rendir **no** genera una factura automática. Una devolución de fondos se marca con el toggle "Devolución".

### Redactar con IA
Menú ☰ o la lupa → **"Redactar con IA"**. La IA redacta en el **formato real del estudio**, y **tú siempre validas y editas** antes de usarlo — nada se envía solo.

- **8 tipos:** Propuesta de honorarios, Memo, Informe tributario, Presentación, Plan de acción, Minuta, Cláusula, Correo.
- **Cruza hasta 5 fuentes** para que el borrador venga contextualizado:
  1. El **formato** del estudio (leído de tu Drive).
  2. El **radar SII** (normativa vigente; cita lo pertinente).
  3. La **ficha del cliente** (áreas, vendido, por cobrar).
  4. **Precedentes**: busca documentos pasados de tu Drive y redacta sobre esa base.
  5. Un **documento del cliente**: "Traer un documento de [cliente]" → eliges un archivo de su carpeta y la IA lo **lee** y usa sus datos.
- **Biblioteca de cláusulas** (en el tipo Cláusula): extrae cláusulas reutilizables de tus contratos/pactos/protocolos y las guarda por categoría.
- **Exporta** el borrador a **Word** y, en Presentación, a **PowerPoint (PPTX)**; o lo **guarda directo en la carpeta del cliente** en Drive.

### Inteligencia de Negocios
- KPIs sólidos + **oportunidades accionables** de la cartera.
- **Radar del SII** (novedades normativas), con memo de conversación al cliente y "Plan del año".

---

## Tips

- **Si la app te pregunta algo que ya le dijiste**, no debería: revisa "Lo que aprendí" (menú ☰) y corrige o "Olvida" lo que quedó mal.
- **Las listas largas** se agrupan y colapsan; abre solo lo que necesitas.
- **Volver:** la flecha ← siempre te deja donde estabas, aunque hayas saltado entre vistas.
- **Todo se puede deshacer** donde tiene sentido (conciliación, mover gastos, borrar cobros).
- **Correos:** todo sale desde **cl@leabogados.cl** (nunca de un Gmail personal).
