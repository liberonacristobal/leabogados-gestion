// Datos FICTICIOS para el modo demo (?demo=1). Nada de esto es real.
// Empresas, RUTs, montos y personas inventados. El modo demo nunca toca la base real.

export const demoData = {
  clients: [
    { id:'c1', name:'Comercial Andes SpA',        rut:'76.111.222-3', status:'Activo',    type:'Empresa', abogado_responsable:'Cristóbal', is_internal:false },
    { id:'c2', name:'Inversiones Ríofrío Ltda',    rut:'77.333.444-5', status:'Activo',    type:'Empresa', abogado_responsable:'Erasmo',    is_internal:false },
    { id:'c3', name:'Constructora Pehuén SA',      rut:'76.555.666-7', status:'Activo',    type:'Empresa', abogado_responsable:'Cristóbal', is_internal:false },
    { id:'c4', name:'Tech Araucanía SpA',          rut:'77.777.888-9', status:'Activo',    type:'Empresa', abogado_responsable:'Erasmo',    is_internal:false },
    { id:'c5', name:'Viñedos del Maipo Ltda',      rut:'76.222.333-4', status:'Activo',    type:'Empresa', abogado_responsable:'Cristóbal', is_internal:false },
    { id:'c6', name:'Clínica San Rafael SpA',      rut:'77.444.555-6', status:'Activo',    type:'Empresa', abogado_responsable:'Erasmo',    is_internal:false },
    { id:'c7', name:'Transportes Volcán SpA',      rut:'76.888.999-0', status:'Activo',    type:'Empresa', abogado_responsable:'Cristóbal', is_internal:false },
    { id:'c8', name:'Agrícola Las Vertientes Ltda',rut:'77.121.314-5', status:'Prospecto', type:'Empresa', abogado_responsable:'Erasmo',    is_internal:false },
  ],
  client_entities: [
    { id:'e1',  client_id:'c1', name:'Comercial Andes SpA', rut:'76.111.222-3' },
    { id:'e1b', client_id:'c1', name:'Andes Retail SpA',    rut:'76.111.999-1' },
    { id:'e2',  client_id:'c2', name:'Inversiones Ríofrío Ltda', rut:'77.333.444-5' },
  ],
  sales: [
    { id:'s1',  client_id:'c1', entity_id:'e1', title:'Asesoría corporativa permanente', area:'Corporativo', moneda:'UF',  amount_uf:30,  cost_uf:0,  uf_value:39000, year:2026, month:1, status:'Activo', cobro_type:'mensual',       responsible:'Cristóbal', created_at:'2026-01-05' },
    { id:'s2',  client_id:'c2', entity_id:'e2', title:'Reorganización societaria',         area:'Corporativo', moneda:'UF',  amount_uf:200, cost_uf:20, uf_value:39000, year:2026, month:2, status:'Activo', cobro_type:'cuotas',        responsible:'Erasmo',    created_at:'2026-02-10' },
    { id:'s3',  client_id:'c3',               title:'Litigio laboral colectivo',          area:'Litigios',    moneda:'CLP', amount_clp:12000000, cost_clp:0, year:2026, month:3, status:'Activo', cobro_type:'personalizada', responsible:'Cristóbal', created_at:'2026-03-02' },
    { id:'s4',  client_id:'c4',               title:'Asesoría legal permanente',          area:'Corporativo', moneda:'CLP', amount_clp:1500000,  cost_clp:0, year:2026, month:1, status:'Activo', cobro_type:'mensual',       responsible:'Erasmo',    created_at:'2026-01-15' },
    { id:'s5',  client_id:'c5',               title:'Constitución y registro de marcas',  area:'Propiedad Industrial', moneda:'UF', amount_uf:80, cost_uf:8, uf_value:39000, year:2026, month:4, status:'Activo', cobro_type:'cuotas', responsible:'Cristóbal', created_at:'2026-04-08' },
    { id:'s6',  client_id:'c6',               title:'Contratos con proveedores',          area:'Corporativo', moneda:'CLP', amount_clp:6500000, cost_clp:0, year:2026, month:5, status:'Activo', cobro_type:'unico',         responsible:'Erasmo',    created_at:'2026-05-12' },
    { id:'s7',  client_id:'c7',               title:'Defensa tributaria SII',             area:'Tributario',  moneda:'UF',  amount_uf:150, cost_uf:30, uf_value:39000, year:2026, month:2, status:'Activo', cobro_type:'cuotas',        responsible:'Cristóbal', created_at:'2026-02-20' },
    { id:'s8',  client_id:'c2',               title:'Due diligence adquisición',          area:'Corporativo', moneda:'UF',  amount_uf:60,  cost_uf:0,  uf_value:39000, year:2026, month:5, status:'Activo', cobro_type:'unico',         responsible:'Erasmo',    created_at:'2026-05-03' },
    { id:'s9',  client_id:'c1',               title:'Asesoría corporativa 2025',          area:'Corporativo', moneda:'UF',  amount_uf:120, cost_uf:0,  uf_value:37500, year:2025, month:6, status:'Activo', cobro_type:'cuotas',        responsible:'Cristóbal', created_at:'2025-06-01' },
    { id:'s10', client_id:'c3',               title:'Litigio civil 2025',                 area:'Litigios',    moneda:'CLP', amount_clp:8000000, cost_clp:0, year:2025, month:9, status:'Activo', cobro_type:'personalizada', responsible:'Cristóbal', created_at:'2025-09-10' },
  ],
  billing: [
    // Pagadas (cobrado 2026)
    { id:'b1',  client_id:'c1', sale_id:'s1', entity_id:'e1', concept:'Honorarios enero',        amount:1170000,  status:'Pagado',     invoice_no:'1201', issued_at:'2026-01-31', due:'2026-02-15', paid_at:'2026-02-10', billing_type:'honorarios', monto_terceros:0 },
    { id:'b2',  client_id:'c1', sale_id:'s1', entity_id:'e1', concept:'Honorarios febrero',      amount:1170000,  status:'Pagado',     invoice_no:'1230', issued_at:'2026-02-28', due:'2026-03-15', paid_at:'2026-03-12', billing_type:'honorarios', monto_terceros:0 },
    { id:'b3',  client_id:'c7', sale_id:'s7', concept:'Defensa tributaria — cuota 1/3',          amount:1950000,  status:'Pagado',     invoice_no:'1245', issued_at:'2026-03-05', due:'2026-03-25', paid_at:'2026-03-22', billing_type:'honorarios', monto_terceros:600000 },
    { id:'b4',  client_id:'c2', sale_id:'s2', entity_id:'e2', concept:'Reorganización — cuota 1/4', amount:1950000, status:'Pagado',   invoice_no:'1260', issued_at:'2026-03-20', due:'2026-04-10', paid_at:'2026-04-05', billing_type:'honorarios', monto_terceros:0 },
    { id:'b5',  client_id:'c4', sale_id:'s4', concept:'Asesoría permanente — abril',             amount:1500000,  status:'Pagado',     invoice_no:'1288', issued_at:'2026-04-30', due:'2026-05-15', paid_at:'2026-05-14', billing_type:'honorarios', monto_terceros:0 },
    // Pendientes (por cobrar, al día)
    { id:'b6',  client_id:'c2', sale_id:'s2', entity_id:'e2', concept:'Reorganización — cuota 2/4', amount:1950000, status:'Pendiente', invoice_no:'1305', issued_at:'2026-05-20', due:'2026-06-25', paid_at:null, billing_type:'honorarios', monto_terceros:0 },
    { id:'b7',  client_id:'c6', sale_id:'s6', concept:'Contratos con proveedores',               amount:6500000,  status:'Pendiente',  invoice_no:'1312', issued_at:'2026-05-28', due:'2026-07-10', paid_at:null, billing_type:'honorarios', monto_terceros:0 },
    { id:'b8',  client_id:'c5', sale_id:'s5', concept:'Marcas — cuota 1/2',                      amount:1560000,  status:'Pendiente',  invoice_no:'1320', issued_at:'2026-06-02', due:'2026-06-30', paid_at:null, billing_type:'honorarios', monto_terceros:0 },
    // Vencidas (aging)
    { id:'b9',  client_id:'c3', sale_id:'s3', concept:'Litigio laboral — anticipo',             amount:4000000,  status:'Vencido',    invoice_no:'1270', issued_at:'2026-04-01', due:'2026-05-05', paid_at:null, billing_type:'honorarios', monto_terceros:0 },
    { id:'b10', client_id:'c7', sale_id:'s7', concept:'Defensa tributaria — cuota 2/3',          amount:1950000,  status:'Vencido',    invoice_no:'1248', issued_at:'2026-03-10', due:'2026-03-25', paid_at:null, billing_type:'honorarios', monto_terceros:0 },
    // Programadas (futuro, cash flow)
    { id:'b11', client_id:'c2', sale_id:'s2', entity_id:'e2', concept:'Reorganización — cuota 3/4', amount:1950000, status:'Programada', invoice_no:null, issued_at:null, due:'2026-07-15', paid_at:null, billing_type:'honorarios', monto_terceros:0 },
    { id:'b12', client_id:'c2', sale_id:'s2', entity_id:'e2', concept:'Reorganización — cuota 4/4', amount:1950000, status:'Programada', invoice_no:null, issued_at:null, due:'2026-08-15', paid_at:null, billing_type:'honorarios', monto_terceros:0 },
    { id:'b13', client_id:'c7', sale_id:'s7', concept:'Defensa tributaria — cuota 3/3',          amount:1950000,  status:'Programada', invoice_no:null, issued_at:null, due:'2026-09-01', paid_at:null, billing_type:'honorarios', monto_terceros:0 },
    { id:'b14', client_id:'c5', sale_id:'s5', concept:'Marcas — cuota 2/2',                      amount:1560000,  status:'Programada', invoice_no:null, issued_at:null, due:'2026-08-30', paid_at:null, billing_type:'honorarios', monto_terceros:0 },
    // Reembolso (excluido de facturado)
    { id:'b15', client_id:'c1', concept:'Reembolso gastos notariales',                          amount:120000,   status:'Pendiente',  invoice_no:null, issued_at:'2026-06-01', due:'2026-06-20', paid_at:null, billing_type:'reembolso', monto_terceros:0, notes:'Rendición ID demo' },
    // 2025 (para el selector de año)
    { id:'b16', client_id:'c1', sale_id:'s9', concept:'Asesoría 2025 — cuota final',            amount:2300000,  status:'Pagado',     invoice_no:'1120', issued_at:'2025-11-30', due:'2025-12-15', paid_at:'2025-12-12', billing_type:'honorarios', monto_terceros:0 },
  ],
  expenses: [
    // Fondos de clientes
    { id:'x1', client_id:'c1', entity_id:'e1', type:'fondo', amount:1000000, concept:'Fondo de gastos', category:'Fondo', date:'2026-02-01', created_by:'Cristóbal' },
    { id:'x2', client_id:'c3',               type:'fondo', amount:500000,  concept:'Fondo de gastos', category:'Fondo', date:'2026-03-05', created_by:'Cristóbal' },
    // Gastos con cliente (algunos dejan saldo negativo → "clientes sin fondos")
    { id:'x3', client_id:'c1', entity_id:'e1', type:'gasto', amount:320000, concept:'Inscripción Conservador', category:'CBR',      date:'2026-03-10', created_by:'Martín',  client_rendered_at:null },
    { id:'x4', client_id:'c2', type:'gasto', amount:180000, concept:'Notaría — escritura',     category:'Notaria',        date:'2026-04-02', created_by:'Martín',  paid_by_client:false },
    { id:'x5', client_id:'c5', type:'gasto', amount:95000,  concept:'Registro de marca INAPI',  category:'Otro',           date:'2026-05-09', created_by:'Martina', },
    { id:'x6', client_id:'c6', type:'gasto', amount:60000,  concept:'Certificados',             category:'Registro Civil', date:'2026-05-20', created_by:'Martina', },
    // Caja chica (gastos por persona, varios sin liquidar)
    { id:'x7',  client_id:'c3', type:'gasto', amount:140000, concept:'Diario Oficial — publicación', category:'Diario Oficial', date:'2026-06-02', created_by:'Martín',  rendered_at:null },
    { id:'x8',  client_id:'c3', type:'gasto', amount:90000,  concept:'Fotocopias y trámites',        category:'Otro',           date:'2026-06-05', created_by:'Martín',  rendered_at:null },
    { id:'x9',  client_id:'c7', type:'gasto', amount:75000,  concept:'Notaría — poder',              category:'Notaria',        date:'2026-06-08', created_by:'Martín',  rendered_at:null },
    { id:'x10', client_id:'c5', type:'gasto', amount:40000,  concept:'Estacionamiento y traslados',  category:'Otro',           date:'2026-06-10', created_by:'Martina', rendered_at:null },
  ],
  petty_cash: [
    { id:'pc1', user_name:'Martín',  amount:300000, delivered_at:'2026-06-01', delivered_by:'Cristóbal', notes:'Caja del mes' },
    { id:'pc2', user_name:'Martina', amount:250000, delivered_at:'2026-06-01', delivered_by:'Cristóbal', notes:'Caja del mes' },
  ],
  tasks: [
    { id:'t1', title:'Redactar contrato de prestación de servicios', client_id:'c1', project:'Asesoría permanente', status:'Activo', due:'2026-06-12', assignees:['Martín'],   assigned_by:'Cristóbal', created_at:'2026-06-05' },
    { id:'t2', title:'Preparar escrito de contestación',             client_id:'c3', project:'Litigio laboral',     status:'Activo', due:'2026-06-16', assignees:['Erasmo'],   assigned_by:'Cristóbal', created_at:'2026-06-06' },
    { id:'t3', title:'Revisar due diligence — carpeta laboral',      client_id:'c2', project:'Due diligence',       status:'Activo', due:'2026-06-20', assignees:['Martina'],  assigned_by:'Erasmo',    created_at:'2026-06-08' },
    { id:'t4', title:'Inscribir marca en INAPI',                     client_id:'c5', project:'Marcas',              status:'Activo', due:'2026-06-25', assignees:['Rodrigo'],  assigned_by:'Cristóbal', created_at:'2026-06-09' },
    { id:'t5', title:'Agendar reunión de cierre',                    client_id:'c6', project:null,                  status:'Activo', due:'2026-06-30', assignees:['Cristóbal'],assigned_by:'Cristóbal', created_at:'2026-06-10' },
    { id:'t6', title:'Enviar minuta tributaria al cliente',          client_id:'c7', project:'Defensa SII',        status:'Activo', due:'2026-06-11', assignees:['Martín'],   assigned_by:'Erasmo',    created_at:'2026-06-04' },
    { id:'t7', title:'Actualizar poderes vigentes',                  client_id:'c1', project:null,                  status:'Activo', due:'2026-07-03', assignees:['Martina'],  assigned_by:'Cristóbal', created_at:'2026-06-10' },
    { id:'t8', title:'Liquidar gastos del mes',                      client_id:null, project:null,                  status:'Activo', due:'2026-06-18', assignees:['Martín'],   assigned_by:'Cristóbal', created_at:'2026-06-09' },
    { id:'t9', title:'Cotizar perito contable',                      client_id:'c3', project:'Litigio laboral',     status:'Activo', due:null,         assignees:['Rodrigo'],  assigned_by:'Cristóbal', created_at:'2026-06-07' },
    { id:'t10',title:'Cierre escritura reorganización',              client_id:'c2', project:'Reorganización',      status:'Terminado', due:'2026-05-28', completed_at:'2026-05-29', assignees:['Erasmo'], assigned_by:'Cristóbal', created_at:'2026-05-20' },
  ],
  proveedores: [
    { id:'pv1', nombre:'Notaría Edwards',     razon_social:'Notaría Edwards y Cía.', rut:'77.900.100-2' },
    { id:'pv2', nombre:'Estudio Contable MJ', razon_social:'MJ Asesorías Ltda.',     rut:'76.500.300-4' },
  ],
  terceros_pagos: [
    { id:'tp1', billing_id:'b3', proveedor_id:'pv1', proveedor:'Notaría Edwards', monto:600000, estado:'por_pagar', tipo_costo:'Notaría', sale_id:'s7', created_at:'2026-03-22' },
    { id:'tp2', billing_id:'b6', proveedor_id:'pv2', proveedor:'Estudio Contable MJ', monto:450000, estado:'pendiente', tipo_costo:'Contabilidad', sale_id:'s2', created_at:'2026-05-20' },
  ],
  anticipos: [],
  rendiciones: [],
}
