#!/usr/bin/env python3
# Genera un preview del correo del digest de notaría con datos reales de Cristóbal,
# para diseñar el layout antes de portarlo al edge function notaria-semanal.
import json, datetime, collections, os

HOY = datetime.date(2026, 8, 31)
MES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']

# Datos reales (Cristóbal, dryRun 2026-08-31)
ROWS = [
 ("459863",None,"Notaria",20000,"2026-05-25","2026-06-19","BM Soluciones"),
 ("454629",None,"Notaria",20000,"2026-05-05","2026-06-19","BM Soluciones"),
 ("453855",None,"Notaria",100000,"2026-04-30","2026-06-19","BM Soluciones"),
 ("453855",None,"Notaria",100000,"2026-04-30","2026-06-19","BM Soluciones"),
 ("434675",None,"Notaria",10000,"2026-02-25","2026-06-19","BM Soluciones"),
 ("421841",None,"Notaria",10000,"2026-01-09","2026-06-19","BM Soluciones"),
 ("457660",None,"Notaria",10000,"2026-05-15","2026-06-19","Bravo Silva"),
 ("457483",None,"Notaria",100000,"2026-05-14","2026-06-19","Bravo Silva"),
 (None,None,"Notaria",10000,"2025-11-21","2026-06-25","Familia Schroder"),
 (None,None,"Notaria",120000,"2025-10-03","2026-06-25","Familia Schroder"),
 (None,None,"Notaria",50000,"2025-10-03","2026-06-25","Familia Schroder"),
 (None,None,"Notaria",180000,"2025-10-03","2026-06-25","Familia Schroder"),
 (None,None,"Notaria",120000,"2025-07-24","2026-06-25","Familia Schroder"),
 (None,None,"Notaria",40000,"2025-06-26","2026-06-25","Familia Schroder"),
 (None,None,"Notaria",1300,"2025-02-10","2026-06-25","Familia Schroder"),
 ("450721",None,"CBR",10000,"2026-04-22","2026-06-19","Hugo Figueroa"),
 (None,None,"Notaria",10000,"2025-06-18","2026-06-25","Hugo Figueroa"),
 ("455754",None,"Notaria",10000,"2026-05-08","2026-06-19","Tarragona"),
 ("455788",None,"Notaria",40000,"2026-05-08","2026-06-19","Tarragona"),
 ("449524",None,"Notaria",10000,"2026-04-16","2026-06-19","Tarragona"),
 ("447203",None,"Notaria",10000,"2026-04-09","2026-06-19","Tarragona"),
 ("436302",None,"Notaria",140000,"2026-03-03","2026-06-19","Tarragona"),
 ("426898",None,"Notaria",10000,"2026-01-28","2026-06-19","Toselli"),
 ("400338",None,"Notaria",10000,"2025-11-12","2026-06-19","Toselli"),
 (None,None,"Notaria",20000,"2024-11-13","2026-06-25","Vittorio Stacchetti"),
]

def fmt(n): return "$"+format(int(round(n)),",").replace(",",".")
def dias(iso):
    d=datetime.date.fromisoformat(iso); return (HOY-d).days
def fdia(iso):
    d=datetime.date.fromisoformat(iso); return f"{d.day} {MES[d.month-1]}"

# Tokens (paleta C, email-safe)
NV="#003C50"; INK="#1F2A30"; MUT="#66787F"; FAINT="#9DAEB4"; HAIR="#EAEEF0"
RED="#C0403E"; AMB="#9A6410"; GRN="#147D5C"; PAGE="#ECEFF1"; SOFT="#F5F7F8"

def aging_color(d):
    return (RED, "#FBECEB") if d>=90 else (AMB,"#FAF0DA") if d>=60 else (MUT,"#EEF1F2")

def row_html(ot, cat, monto, fecha_ot, liq):
    d = dias(liq)
    col,bg = aging_color(d)
    # bloque de fecha
    if fecha_ot:
        dd=datetime.date.fromisoformat(fecha_ot)
        dnum=f"{dd.day}"; dmes=f"{MES[dd.month-1]} {dd.year}"
    else:
        dnum="s/f"; dmes=""
    ident = f"OT {ot}" if ot else "OT sin número"
    tag = f'<span style="display:inline-block;font-size:9px;font-weight:700;color:{MUT};background:{SOFT};border:1px solid {HAIR};border-radius:4px;padding:1px 5px;margin-left:6px;vertical-align:middle;">{cat}</span>' if cat and cat.lower()!='notaria' else ""
    identCol = INK if ot else MUT
    return f'''<tr>
      <td valign="top" width="52" style="padding:11px 0;border-top:1px solid {HAIR};">
        <div style="font-size:19px;font-weight:800;color:{INK};line-height:1;">{dnum}</div>
        <div style="font-size:10px;color:{FAINT};text-transform:uppercase;letter-spacing:.4px;margin-top:2px;">{dmes}</div>
      </td>
      <td valign="top" style="padding:11px 0 11px 12px;border-top:1px solid {HAIR};">
        <div style="font-size:14px;font-weight:600;color:{identCol};line-height:1.3;">{ident}{tag}</div>
        <div style="font-size:11.5px;color:{MUT};margin-top:3px;">Pagada a notaría {fdia(liq)} · <span style="color:{col};font-weight:600;">{d} días</span></div>
      </td>
      <td valign="top" align="right" style="padding:11px 0 11px 10px;border-top:1px solid {HAIR};white-space:nowrap;">
        <span style="font-size:14px;font-weight:700;color:{INK};">{fmt(monto)}</span>
      </td>
    </tr>'''

# agrupar por cliente preservando orden de aparición
grupos = collections.OrderedDict()
for r in ROWS:
    ot,mat,cat,monto,fot,liq,cli = r
    grupos.setdefault(cli, []).append(r)

# ordenar clientes por su OT más antigua (fecha_ot más vieja arriba = más histórico/urgente de revisar)
def cli_oldest(items):
    fs=[x[4] for x in items if x[4]]
    return min(fs) if fs else "9999"
clientes = sorted(grupos.items(), key=lambda kv: cli_oldest(kv[1]))

total = sum(x[3] for x in ROWS)
nOt=len(ROWS); nCli=len(grupos)

bloques=""
for cli, items in clientes:
    sub=sum(x[3] for x in items)
    items_sorted=sorted(items, key=lambda x:(x[4] or "9999"), reverse=True)  # dentro del cliente, más nueva primero
    filas="".join(row_html(x[0],x[2],x[3],x[4],x[5]) for x in items_sorted)
    bloques+=f'''<div style="margin-bottom:22px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:15.5px;font-weight:800;color:{INK};letter-spacing:-.1px;">{cli}</td>
          <td align="right" style="white-space:nowrap;"><span style="font-size:10.5px;color:{FAINT};text-transform:uppercase;letter-spacing:.5px;margin-right:8px;">{len(items)} OT</span><span style="font-size:15px;font-weight:800;color:{NV};">{fmt(sub)}</span></td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">{filas}</table>
    </div>'''

html=f'''<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:{PAGE};margin:0;padding:22px 12px;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 26px rgba(0,44,64,.09);">
  <div style="background:{NV};padding:20px 28px;text-align:center;"><img src="https://gestion.leabogados.cl/le-logo-blanco.png" alt="Liberona Escala Abogados" height="28" style="height:28px;display:inline-block;border:0;"/></div>
  <div style="padding:26px 26px 20px;">
    <div style="font-size:19px;color:{INK};font-weight:800;letter-spacing:-.3px;">Hola, Cristóbal</div>
    <div style="font-size:12.5px;color:{MUT};margin-top:6px;line-height:1.55;"><span style="text-transform:uppercase;letter-spacing:.7px;font-size:10px;color:{FAINT};font-weight:700;">Gastos de notaría por cobrar · agosto 2026</span><br>Tienes <b style="color:{INK};">{nOt} OT</b> pagadas a la notaría y sin cobrar a tus clientes, por <b style="color:{NV};">{fmt(total)}</b>.</div>
  </div>
  <div style="height:1px;background:{HAIR};margin:0 26px;"></div>
  <div style="padding:22px 26px 8px;">
    {bloques}
  </div>
  <div style="padding:6px 26px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{SOFT};border-radius:12px;">
      <tr><td style="padding:15px 18px;font-size:12.5px;color:{MUT};">{nCli} clientes · {nOt} OT</td>
      <td align="right" style="padding:15px 18px;white-space:nowrap;"><span style="font-size:10.5px;color:{FAINT};text-transform:uppercase;letter-spacing:.6px;">Total por cobrar</span> <span style="font-size:17px;font-weight:800;color:{NV};margin-left:8px;">{fmt(total)}</span></td></tr>
    </table>
    <div style="margin-top:18px;text-align:center;"><a href="https://gestion.leabogados.cl" style="display:inline-block;background:{NV};color:#fff;text-decoration:none;padding:11px 22px;border-radius:9px;font-size:12.5px;font-weight:700;letter-spacing:.2px;">Rendir estos gastos &rarr;</a></div>
  </div>
  <div style="padding:18px 26px;border-top:1px solid {HAIR};text-align:center;"><div style="font-size:11px;color:{FAINT};">gestion.leabogados.cl · Liberona Escala Abogados</div></div>
</div></body></html>'''

out=os.path.join(os.path.dirname(__file__),"..","public","_notaria_preview.html")
open(out,"w").write(html)
print("escrito:", os.path.abspath(out), "| OT:", nOt, "| total:", fmt(total))
