// Datos FICTICIOS para el modo demo (?demo=1). Nada de esto es real.
// Empresas, RUTs, montos y personas inventados. El modo demo nunca toca la base real.

export const demoData = {
  annual_targets: [
    { year:2026, target_amount:800000000, currency:'CLP' },
    { year:2025, target_amount:600000000, currency:'CLP' },
  ],
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
  proyectos_cartera: [
    { id:'p1', cliente_id:'c1', nombre_proyecto:'Reestructuración societaria', estado:'rojo',  etapa_idx:2, responsable:'CL', nota:'Esperando poderes del segundo socio para firmar', plazo_label:'Firma de escritura ante notario', plazo:new Date(Date.now()-4*864e5).toISOString().slice(0,10),  ultima_actividad:new Date(Date.now()-18*864e5).toISOString().slice(0,10), origen:'manual', activo:true },
    { id:'p2', cliente_id:'c3', nombre_proyecto:'Regularización de servidumbre', estado:'ambar', etapa_idx:1, responsable:'RD', nota:'Redactando minuta para el CBR', plazo_label:null, plazo:new Date(Date.now()+5*864e5).toISOString().slice(0,10), ultima_actividad:new Date(Date.now()-9*864e5).toISOString().slice(0,10), origen:'manual', activo:true },
    { id:'p3', cliente_id:'c6', nombre_proyecto:'Constitución de sociedad', estado:'ambar', etapa_idx:0, responsable:'EE', nota:'Reuniendo antecedentes de los socios', plazo_label:null, plazo:new Date(Date.now()+6*864e5).toISOString().slice(0,10), ultima_actividad:new Date(Date.now()-12*864e5).toISOString().slice(0,10), origen:'manual', activo:true },
    { id:'p4', cliente_id:'c5', nombre_proyecto:'Contrato de distribución', estado:'verde', etapa_idx:3, responsable:'MP', nota:'Enviado a revisión del cliente', plazo_label:null, plazo:new Date(Date.now()+21*864e5).toISOString().slice(0,10), ultima_actividad:new Date(Date.now()-2*864e5).toISOString().slice(0,10), origen:'manual', activo:true },
    { id:'p5', cliente_id:'c4', nombre_proyecto:'Due diligence de compra', estado:'verde', etapa_idx:1, responsable:'MC', nota:'Revisando carpeta tributaria en Drive', plazo_label:null, plazo:null, ultima_actividad:new Date(Date.now()-1*864e5).toISOString().slice(0,10), origen:'manual', activo:true },
  ],
  client_entities: [
    { id:'e1',  client_id:'c1', name:'Comercial Andes SpA', rut:'76.111.222-3' },
    { id:'e1b', client_id:'c1', name:'Andes Retail SpA',    rut:'76.111.999-1' },
    { id:'e2',  client_id:'c2', name:'Inversiones Ríofrío Ltda', rut:'77.333.444-5' },
  ],
  // Vendido 2026 ≈ $527M (≈63% de la meta de $800M)
  sales: [
    { id:'s1',  client_id:'c1', entity_id:'e1', title:'Asesoría corporativa permanente', area:'Corporativo', moneda:'UF',  amount_uf:90,   cost_uf:0,   uf_value:39000, year:2026, month:1, status:'Activo', cobro_type:'mensual',       responsible:'Cristóbal', created_at:'2026-01-05' },
    { id:'s2',  client_id:'c2', entity_id:'e2', title:'Reorganización societaria',         area:'Corporativo', moneda:'UF',  amount_uf:1500, cost_uf:150, uf_value:39000, year:2026, month:2, status:'Activo', cobro_type:'cuotas',        responsible:'Erasmo',    created_at:'2026-02-10' },
    { id:'s3',  client_id:'c3',               title:'Litigio laboral colectivo',          area:'Litigios',    moneda:'CLP', amount_clp:75000000,  cost_clp:0, year:2026, month:3, status:'Activo', cobro_type:'personalizada', responsible:'Cristóbal', created_at:'2026-03-02' },
    { id:'s4',  client_id:'c4',               title:'Asesoría legal permanente',          area:'Corporativo', moneda:'CLP', amount_clp:4000000,   cost_clp:0, year:2026, month:1, status:'Activo', cobro_type:'mensual',       responsible:'Erasmo',    created_at:'2026-01-15' },
    { id:'s5',  client_id:'c5',               title:'Constitución y registro de marcas',  area:'Propiedad Industrial', moneda:'UF', amount_uf:600,  cost_uf:60, uf_value:39000, year:2026, month:4, status:'Activo', cobro_type:'cuotas', responsible:'Cristóbal', created_at:'2026-04-08' },
    { id:'s6',  client_id:'c6',               title:'Contratos con proveedores',          area:'Corporativo', moneda:'CLP', amount_clp:40000000, cost_clp:0, year:2026, month:5, status:'Activo', cobro_type:'unico',         responsible:'Erasmo',    created_at:'2026-05-12' },
    { id:'s7',  client_id:'c7',               title:'Defensa tributaria SII',             area:'Tributario',  moneda:'UF',  amount_uf:2000, cost_uf:300, uf_value:39000, year:2026, month:2, status:'Activo', cobro_type:'cuotas',        responsible:'Cristóbal', created_at:'2026-02-20' },
    { id:'s8',  client_id:'c2',               title:'Due diligence adquisición',          area:'Corporativo', moneda:'UF',  amount_uf:1200, cost_uf:0,  uf_value:39000, year:2026, month:5, status:'Activo', cobro_type:'unico',         responsible:'Erasmo',    created_at:'2026-05-03' },
    { id:'s11', client_id:'c5',               title:'Asesoría M&A — venta de activos',     area:'Corporativo', moneda:'UF',  amount_uf:1800, cost_uf:0,  uf_value:39000, year:2026, month:4, status:'Activo', cobro_type:'cuotas',        responsible:'Cristóbal', created_at:'2026-04-20' },
    { id:'s12', client_id:'c6',               title:'Reestructuración financiera',         area:'Corporativo', moneda:'CLP', amount_clp:45000000, cost_clp:0, year:2026, month:6, status:'Activo', cobro_type:'cuotas',        responsible:'Erasmo',    created_at:'2026-06-02' },
    // 2025 (para el selector de año)
    { id:'s9',  client_id:'c1',               title:'Asesoría corporativa 2025',          area:'Corporativo', moneda:'UF',  amount_uf:1200, cost_uf:0,  uf_value:37500, year:2025, month:6, status:'Activo', cobro_type:'cuotas',        responsible:'Cristóbal', created_at:'2025-06-01' },
    { id:'s10', client_id:'c3',               title:'Litigio civil 2025',                 area:'Litigios',    moneda:'CLP', amount_clp:60000000, cost_clp:0, year:2025, month:9, status:'Activo', cobro_type:'personalizada', responsible:'Cristóbal', created_at:'2025-09-10' },
  ],
  // Facturado 2026 ≈ $271M · Cobrado ≈ $143M · Por cobrar ≈ $128M · Programado ≈ $65M
  billing: [
    // Pagadas (cobrado 2026)
    { id:'b1',  client_id:'c1', sale_id:'s1', entity_id:'e1', concept:'Honorarios enero',        amount:3510000,  status:'Pagado',     invoice_no:'1201', issued_at:'2026-01-31', due:'2026-02-15', paid_at:'2026-02-10', billing_type:'honorarios', monto_terceros:0 },
    { id:'b2',  client_id:'c1', sale_id:'s1', entity_id:'e1', concept:'Honorarios febrero',      amount:3510000,  status:'Pagado',     invoice_no:'1230', issued_at:'2026-02-28', due:'2026-03-15', paid_at:'2026-03-12', billing_type:'honorarios', monto_terceros:0 },
    { id:'b3',  client_id:'c1', sale_id:'s1', entity_id:'e1', concept:'Honorarios marzo',        amount:3510000,  status:'Pagado',     invoice_no:'1255', issued_at:'2026-03-31', due:'2026-04-15', paid_at:'2026-04-11', billing_type:'honorarios', monto_terceros:0 },
    { id:'b4',  client_id:'c7', sale_id:'s7', concept:'Defensa tributaria — cuota 1/3',          amount:26000000, status:'Pagado',     invoice_no:'1245', issued_at:'2026-03-05', due:'2026-03-25', paid_at:'2026-03-22', billing_type:'honorarios', monto_terceros:4000000 },
    { id:'b5',  client_id:'c2', sale_id:'s2', entity_id:'e2', concept:'Reorganización — cuota 1/4', amount:19500000, status:'Pagado',  invoice_no:'1260', issued_at:'2026-03-20', due:'2026-04-10', paid_at:'2026-04-05', billing_type:'honorarios', monto_terceros:0 },
    { id:'b6',  client_id:'c4', sale_id:'s4', concept:'Asesoría permanente — abril',             amount:4000000,  status:'Pagado',     invoice_no:'1288', issued_at:'2026-04-30', due:'2026-05-15', paid_at:'2026-05-14', billing_type:'honorarios', monto_terceros:0 },
    { id:'b7',  client_id:'c3', sale_id:'s3', concept:'Litigio laboral — anticipo',             amount:30000000, status:'Pagado',     invoice_no:'1262', issued_at:'2026-03-15', due:'2026-04-05', paid_at:'2026-04-02', billing_type:'honorarios', monto_terceros:0 },
    { id:'b8',  client_id:'c2', sale_id:'s8', entity_id:'e2', concept:'Due diligence',           amount:23400000, status:'Pagado',     invoice_no:'1295', issued_at:'2026-05-10', due:'2026-05-30', paid_at:'2026-05-27', billing_type:'honorarios', monto_terceros:0 },
    { id:'b9',  client_id:'c5', sale_id:'s11', concept:'Asesoría M&A — cuota 1/2',               amount:30000000, status:'Pagado',     invoice_no:'1300', issued_at:'2026-05-05', due:'2026-05-25', paid_at:'2026-05-23', billing_type:'honorarios', monto_terceros:0 },
    // Pendientes (por cobrar, al día)
    { id:'b10', client_id:'c6', sale_id:'s6', concept:'Contratos con proveedores',               amount:40000000, status:'Pendiente',  invoice_no:'1312', issued_at:'2026-05-28', due:'2026-07-10', paid_at:null, billing_type:'honorarios', monto_terceros:0 },
    { id:'b11', client_id:'c5', sale_id:'s5', concept:'Marcas — cuota 1/2',                      amount:23400000, status:'Pendiente',  invoice_no:'1320', issued_at:'2026-06-02', due:'2026-06-30', paid_at:null, billing_type:'honorarios', monto_terceros:0 },
    { id:'b12', client_id:'c4', sale_id:'s4', concept:'Asesoría permanente — mayo',              amount:4000000,  status:'Pendiente',  invoice_no:'1330', issued_at:'2026-05-31', due:'2026-06-20', paid_at:null, billing_type:'honorarios', monto_terceros:0 },
    // Vencidas (aging)
    { id:'b13', client_id:'c3', sale_id:'s3', concept:'Litigio laboral — cuota 2',              amount:35000000, status:'Vencido',    invoice_no:'1270', issued_at:'2026-04-01', due:'2026-05-05', paid_at:null, billing_type:'honorarios', monto_terceros:0 },
    { id:'b14', client_id:'c7', sale_id:'s7', concept:'Defensa tributaria — cuota 2/3',          amount:26000000, status:'Vencido',    invoice_no:'1248', issued_at:'2026-03-10', due:'2026-03-25', paid_at:null, billing_type:'honorarios', monto_terceros:0 },
    // Programadas (futuro, cash flow)
    { id:'b15', client_id:'c2', sale_id:'s2', entity_id:'e2', concept:'Reorganización — cuota 3/4', amount:19500000, status:'Programada', invoice_no:null, issued_at:null, due:'2026-07-15', paid_at:null, billing_type:'honorarios', monto_terceros:0 },
    { id:'b16', client_id:'c2', sale_id:'s2', entity_id:'e2', concept:'Reorganización — cuota 4/4', amount:19500000, status:'Programada', invoice_no:null, issued_at:null, due:'2026-08-15', paid_at:null, billing_type:'honorarios', monto_terceros:0 },
    { id:'b17', client_id:'c7', sale_id:'s7', concept:'Defensa tributaria — cuota 3/3',          amount:26000000, status:'Programada', invoice_no:null, issued_at:null, due:'2026-09-01', paid_at:null, billing_type:'honorarios', monto_terceros:0 },
    // Reembolso (excluido de facturado)
    { id:'b18', client_id:'c1', concept:'Reembolso gastos notariales',                          amount:320000,   status:'Pendiente',  invoice_no:null, issued_at:'2026-06-01', due:'2026-06-20', paid_at:null, billing_type:'reembolso', monto_terceros:0, notes:'Rendición ID demo' },
    // 2025 (para el selector de año)
    { id:'b19', client_id:'c1', sale_id:'s9', concept:'Asesoría 2025 — cuota final',            amount:18000000, status:'Pagado',     invoice_no:'1120', issued_at:'2025-11-30', due:'2025-12-15', paid_at:'2025-12-12', billing_type:'honorarios', monto_terceros:0 },
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
    { id:'tp1', billing_id:'b4',  proveedor_id:'pv1', proveedor:'Notaría Edwards',     monto:4000000, estado:'por_pagar', tipo_costo:'Notaría',      sale_id:'s7', created_at:'2026-03-22' },
    { id:'tp2', billing_id:'b10', proveedor_id:'pv2', proveedor:'Estudio Contable MJ', monto:3000000, estado:'pendiente', tipo_costo:'Contabilidad', sale_id:'s6', created_at:'2026-05-28' },
  ],
  anticipos: [],
  rendiciones: [],
}
