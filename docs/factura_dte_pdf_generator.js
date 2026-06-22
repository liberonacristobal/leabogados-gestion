const fs=require('fs'); const { jsPDF }=require('jspdf'); const bwipjs=require('bwip-js');
const xml=fs.readFileSync('muestra.xml','latin1');
const docs=[...xml.matchAll(/<Documento[\s\S]*?<\/Documento>/g)].map(m=>m[0]);
const fmtRut=r=>{ const [n,dv]=r.split('-'); return n.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+'-'+dv };
const fmtN=n=>(n||0).toLocaleString('es-CL');
const MES=['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const fchL=iso=>{ const [y,m,d]=iso.split('-'); return `${+d} de ${MES[+m]} de ${y}` };
const logo='data:image/png;base64,'+fs.readFileSync('/tmp/logo_azul_t.png').toString('base64');
const NAVY=[0,60,80], GRAF=[61,61,61], MUT=[83,114,129], BORD=[210,216,221], RED=[192,11,11], REDLT=[196,125,125];
const sanit=s=>String(s||'').replace(/[\/\\:*?"<>|]/g,'').replace(/\s+/g,' ').trim().slice(0,45);

async function buildOne(doc){
  const g=(t,s=doc)=>{ const m=s.match(new RegExp('<'+t+'>([\\s\\S]*?)</'+t+'>')); return m?m[1].trim():'' };
  const ted=doc.match(/<TED[\s\S]*?<\/TED>/)[0];
  const idDoc=doc.match(/<IdDoc>[\s\S]*?<\/IdDoc>/)[0], emi=doc.match(/<Emisor>[\s\S]*?<\/Emisor>/)[0], rec=doc.match(/<Receptor>[\s\S]*?<\/Receptor>/)[0], tot=doc.match(/<Totales>[\s\S]*?<\/Totales>/)[0];
  const detalles=[...doc.matchAll(/<Detalle>[\s\S]*?<\/Detalle>/g)].map(m=>m[0]);
  const D={ folio:g('Folio',idDoc), fch:g('FchEmis',idDoc), fma:g('FmaPago',idDoc), rutE:g('RUTEmisor',emi),
    rutR:g('RUTRecep',rec), rznR:g('RznSocRecep',rec), giroR:g('GiroRecep',rec), dirR:g('DirRecep',rec), cmnaR:g('CmnaRecep',rec), ciuR:g('CiudadRecep',rec),
    exe:+g('MntExe',tot), total:+g('MntTotal',tot),
    items:detalles.map(d=>({nmb:g('NmbItem',d), dsc:g('DscItem',d), qty:g('QtyItem',d), prc:+g('PrcItem',d), mnt:+g('MontoItem',d)})) };
  const fma={'1':'Contado','2':'Crédito','3':'Sin costo'}[D.fma]||'';
  const png=await bwipjs.toBuffer({ bcid:'pdf417', text:ted, columns:14, scale:2, eclevel:5, includetext:false });
  const bc='data:image/png;base64,'+png.toString('base64');
  const p=new jsPDF({unit:'mm',format:'letter',compress:true}); const W=215.9, M=15;
  p.setDrawColor(...BORD); p.setLineWidth(0.4); p.roundedRect(11,12,W-22,261,2.5,2.5);
  p.addImage(logo,'PNG',M,16,80,20.8);
  const bw=54, bx=W-M-bw, by=16, bh=32;
  p.setDrawColor(...RED); p.setLineWidth(0.8); p.roundedRect(bx,by,bw,bh,2,2);
  p.setTextColor(...RED); p.setFont('helvetica','bold');
  p.setFontSize(11); p.text('R.U.T. '+fmtRut(D.rutE),bx+bw/2,by+6.5,{align:'center'});
  p.setFontSize(9); p.text('FACTURA NO AFECTA O',bx+bw/2,by+13,{align:'center'}); p.text('EXENTA ELECTRÓNICA',bx+bw/2,by+17,{align:'center'});
  p.setFontSize(16.5); p.text('N° '+D.folio,bx+bw/2,by+25,{align:'center'});
  p.setFont('helvetica','normal'); p.setFontSize(6.5); p.setTextColor(...REDLT); p.text('S.I.I. - SANTIAGO ORIENTE',bx+bw/2,by+30,{align:'center'});
  const fy=by+bh+6; p.setFont('helvetica','normal'); p.setFontSize(8); p.setTextColor(...MUT);
  p.text('Fecha de emisión:',bx,fy); const flw=p.getTextWidth('Fecha de emisión:  ');
  p.setFont('helvetica','bold'); p.setTextColor(...GRAF); p.text(fchL(D.fch),bx+flw,fy);
  let ye=43; p.setFontSize(8.5);
  const inl=(lab,val,vcol)=>{ p.setFont('helvetica','bold'); p.setTextColor(...NAVY); p.text(lab,M,ye); const w=p.getTextWidth(lab+'  '); p.setFont('helvetica','normal'); p.setTextColor(...(vcol||GRAF)); p.text(val,M+w,ye); ye+=4.7; };
  inl('Giro:','Prestación de servicios y asesorías profesionales');
  inl('Dirección:','Cam. Las Hualtatas 4901, C. 11, Lo Barnechea, Santiago');
  p.setFontSize(8.5);
  p.setFont('helvetica','bold'); p.setTextColor(...NAVY); p.text('Email:',M,ye); let cx=M+p.getTextWidth('Email:  ');
  p.setFont('helvetica','normal'); p.setTextColor(...GRAF); p.text('contacto@leabogados.cl',cx,ye); cx+=p.getTextWidth('contacto@leabogados.cl');
  p.setTextColor(...MUT); p.text('     ·     ',cx,ye); cx+=p.getTextWidth('     ·     ');
  p.setFont('helvetica','bold'); p.setTextColor(...NAVY); p.text('Teléfono:',cx,ye); cx+=p.getTextWidth('Teléfono:  ');
  p.setFont('helvetica','normal'); p.setTextColor(...GRAF); p.text('+56991556769',cx,ye); ye+=6;
  p.setFont('helvetica','bold'); p.setFontSize(9); p.setTextColor(...NAVY); p.text('VENTA DEL GIRO',M,ye);
  p.setDrawColor(...BORD); p.setLineWidth(0.3); p.line(M,ye+5,W-M,ye+5);
  let y=ye+9; const rh=32;
  p.setFillColor(247,249,250); p.setDrawColor(...BORD); p.setLineWidth(0.3); p.roundedRect(M,y,W-2*M,rh,1.5,1.5,'FD');
  p.setFontSize(8.5); const VX=M+30; let yr=y+7;
  const lbl=(t,x,yy)=>{ p.setTextColor(...NAVY); p.setFont('helvetica','bold'); p.text(t,x,yy) };
  const val=(t,x,yy,mw)=>{ p.setTextColor(...GRAF); p.setFont('helvetica','normal'); p.text(t,x,yy,mw?{maxWidth:mw}:undefined) };
  lbl('Señor(es):',M+3,yr); val(D.rznR,VX,yr,150); yr+=5.4;
  lbl('R.U.T.:',M+3,yr); val(fmtRut(D.rutR),VX,yr); yr+=5.4;
  lbl('Giro:',M+3,yr); val(D.giroR,VX,yr,150); yr+=5.4;
  lbl('Dirección:',M+3,yr); val(D.dirR,VX,yr,150); yr+=5.4;
  lbl('Comuna:',M+3,yr); val(D.cmnaR,VX,yr); lbl('Ciudad:',M+98,yr); val(D.ciuR,M+114,yr);
  y+=rh+9;
  p.setFillColor(...NAVY); p.rect(M,y,W-2*M,7.5,'F'); p.setTextColor(255,255,255); p.setFont('helvetica','bold'); p.setFontSize(8);
  const cD=M+3, cQ=128, cP=158, cV=W-M-3;
  p.text('DESCRIPCIÓN',cD,y+5); p.text('CANT.',cQ,y+5,{align:'center'}); p.text('PRECIO UNIT.',cP,y+5,{align:'right'}); p.text('VALOR',cV,y+5,{align:'right'});
  y+=7.5;
  D.items.forEach(it=>{ y+=5.5; p.setTextColor(...GRAF); p.setFont('helvetica','bold'); p.setFontSize(8.5); p.text(it.nmb,cD,y);
    p.text(String(+it.qty),cQ,y,{align:'center'}); p.setFont('helvetica','normal'); p.text(fmtN(it.prc),cP,y,{align:'right'}); p.text(fmtN(it.mnt),cV,y,{align:'right'});
    if(it.dsc){ p.setFontSize(7.5); p.setTextColor(...MUT); it.dsc.split('\n').forEach(l=>{ y+=3.6; p.text(l,cD+1,y) }); } y+=2.5; });
  p.setDrawColor(...BORD); p.setLineWidth(0.3); p.line(M,y,W-M,y);
  y+=6; p.setTextColor(...NAVY); p.setFont('helvetica','bold'); p.setFontSize(8.5); p.text('Forma de pago: ',M,y); p.setTextColor(...GRAF); p.setFont('helvetica','normal'); p.text(fma,M+24,y);
  const ty=240;
  p.setDrawColor(...BORD); p.setLineWidth(0.3); p.line(M,ty-8,W-M,ty-8);
  p.addImage(bc,'PNG',M,ty,44,15.4);
  p.setTextColor(...MUT); p.setFont('helvetica','normal'); p.setFontSize(7);
  p.text('Timbre Electrónico SII',M,ty+19); p.text('Res. 99 de 2014 · Verifique documento: www.sii.cl',M,ty+22.3);
  p.setFontSize(9); p.setTextColor(...GRAF); p.setFont('helvetica','normal');
  p.text('Impuesto adicional',138,ty+1); p.text('$ '+fmtN(0),W-M,ty+1,{align:'right'});
  p.text('Monto exento',138,ty+7.5); p.text('$ '+fmtN(D.exe),W-M,ty+7.5,{align:'right'});
  p.setDrawColor(...NAVY); p.setLineWidth(0.5); p.line(138,ty+10.5,W-M,ty+10.5);
  p.setFont('helvetica','bold'); p.setFontSize(12); p.setTextColor(...NAVY); p.text('TOTAL',138,ty+16.5); p.text('$ '+fmtN(D.total),W-M,ty+16.5,{align:'right'});
  p.setTextColor(...MUT); p.setFontSize(7); p.text('leabogados.cl',W/2,270,{align:'center'});
  return { buf:Buffer.from(p.output('arraybuffer')), folio:D.folio, rzn:D.rznR };
}
(async()=>{
  const dir=process.env.HOME+'/Downloads/Facturas_PDF_respaldo';
  fs.mkdirSync(dir,{recursive:true});
  for(const doc of docs){ const r=await buildOne(doc); const name=`Factura ${r.folio} - ${sanit(r.rzn)}.pdf`; fs.writeFileSync(dir+'/'+name, r.buf); console.log('OK', name); }
  console.log('---', docs.length, 'facturas →', dir);
})().catch(e=>{ console.error('ERR',e.message); process.exit(1) });
