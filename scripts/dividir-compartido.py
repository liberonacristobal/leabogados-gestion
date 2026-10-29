#!/usr/bin/env python3
"""Saca de src/lib/compartido.jsx un grupo de bloques a un módulo propio en src/lib/, sin ciclos.

Uso:  python3 scripts/dividir-compartido.py <modulo> <Nombre1> [Nombre2 ...] [--prueba]

- El grupo = los nombres dados + lo que ellos usan y NADA MÁS usa dentro de compartido.jsx (lo que sigue usando el resto de
  compartido se queda ahí y el módulo nuevo lo importa de compartido: la dependencia va en un solo sentido, sin ciclos).
- Un bloque se queda si es una variable `let` o si trae sentencias sueltas de efecto (no se arriesga el orden de carga).
- Reescribe las importaciones de los demás archivos de src/ para que traigan los nombres movidos del módulo nuevo.
- --prueba solo informa.
"""
import re, sys, os, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMP = os.path.join(ROOT, 'src/lib/compartido.jsx')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
prueba = '--prueba' in sys.argv
modulo, semillas = args[0], args[1:]
DEST = os.path.join(ROOT, 'src/lib', modulo + '.jsx')

src = open(COMP).read().split('\n')
# ── importaciones (una por línea) ──
imports = []   # (línea, spec_default, [(importado, local)], origen)
cuerpo_idx = []
for i, l in enumerate(src):
    m = re.match(r"^import\s+(.*?)\s+from\s+'([^']+)'\s*;?\s*$", l)
    if m: imports.append((i, m.group(1), m.group(2)))
    else: cuerpo_idx.append(i)
imp_lines = {i for i, _, _ in imports}

def locales(spec):
    out = []
    mm = re.search(r'\{([^}]*)\}', spec)
    pre = re.sub(r'\{[^}]*\}', '', spec).strip().strip(',').strip()
    if pre:
        if pre.startswith('* as '): out.append(pre[5:].strip())
        else: out.append(pre)
    if mm:
        for p in mm.group(1).split(','):
            p = p.strip()
            if not p: continue
            out.append(p.split(' as ')[-1].strip())
    return out
imp_local = {}   # nombre local -> índice de importación
for k, (i, spec, org) in enumerate(imports):
    for n in locales(spec): imp_local[n] = k

# ── bloques de nivel superior ──
decl = re.compile(r'^(?:export\s+)?(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)|const\s*\{)')
starts = []
for i in cuerpo_idx:
    l = src[i]
    m = decl.match(l)
    if m:
        nm = m.group(1) or m.group(2)
        starts.append((i, nm, l))
def own_start(i):
    j = i
    while j - 1 >= 0 and (src[j - 1].startswith('//') ) : j -= 1
    return j
blocks = []   # (nombre, ini, fin, linea_decl)
for k, (i, nm, l) in enumerate(starts):
    a = own_start(i)
    b = own_start(starts[k + 1][0]) if k + 1 < len(starts) else len(src)
    blocks.append([nm, a, b, l])
# las importaciones intercaladas no pertenecen a ningún bloque
def sin_comentarios(t):
    t = re.sub(r'/\*.*?\*/', ' ', t, flags=re.S)
    return re.sub(r'(?:(?<=\s)|^)//[^\n]*', ' ', t, flags=re.M)
def texto(bl):
    return '\n'.join(src[j] for j in range(bl[1], bl[2]) if j not in imp_lines)
for bl in blocks:
    bl.append(sin_comentarios(texto(bl)))
por_nombre = {}
for bl in blocks:
    if bl[0]: por_nombre.setdefault(bl[0], bl)
# `const { a, b } = X` declara varios nombres
extras = {}
for bl in blocks:
    m = re.match(r'^(?:export\s+)?const\s*\{([^}]*)\}\s*=', bl[3])
    if m:
        for e in re.findall(r'[A-Za-z_$][\w$]*', re.sub(r':\s*[A-Za-z_$][\w$]*', '', m.group(1))): extras[e] = bl
# `export const a = ..., b = ...` en una línea: nombres extra
for bl in blocks:
    l = bl[3]
    if re.match(r'^export const [A-Za-z_$][\w$]*\s*=', l) and len(l) < 200 and '=>' not in l:
        for e in re.findall(r',\s*([A-Za-z_$][\w$]*)\s*=(?![=>])', l): extras.setdefault(e, bl)
todos = dict(por_nombre); todos.update({e: b for e, b in extras.items() if e not in todos})
def ids(t): return set(re.findall(r'[A-Za-z_$][\w$]*', t))

usa = {}   # id de bloque -> nombres (de bloques) que usa
bid = lambda bl: id(bl)
for bl in blocks:
    usados = ids(bl[4])
    usa[bid(bl)] = {n for n in usados if n in todos and todos[n] is not bl}
# ── cierre: semillas + dependencias que nadie más usa ──
faltan = [s for s in semillas if s not in todos]
if faltan: sys.exit('No encontré en compartido.jsx: ' + ', '.join(faltan))
M = {id(todos[s]): todos[s] for s in semillas}
_otros = {f: sin_comentarios(open(f).read()) for f in glob.glob(os.path.join(ROOT, 'src/**/*.js*'), recursive=True) if f != COMP}
def usado_en_otros(bl):
    nombres = {n for n, b in todos.items() if b is bl}
    return any(ids(t) & nombres for t in _otros.values())
def usado_fuera(bl, M):
    if usado_en_otros(bl): return True
    # ¿algún bloque que se queda usa algún nombre de este bloque?
    nombres = {n for n, b in todos.items() if b is bl}
    for o in blocks:
        if id(o) in M: continue
        if usa[id(o)] & nombres: return True
    # `export { ... }` y líneas sueltas del cuerpo que lo nombran
    sueltas = '\n'.join(src[i] for i in cuerpo_idx if not any(b[1] <= i < b[2] for b in blocks))
    return bool(ids(sin_comentarios(sueltas)) & nombres)
# agrega dependencias (ampliando) y luego quita las que el resto usa
cambio = True
while cambio:
    cambio = False
    for b in list(M.values()):
        for n in usa[id(b)]:
            d = todos[n]
            if id(d) not in M: M[id(d)] = d; cambio = True
# quita lo que el resto usa (salvo las semillas, que siempre se mueven)
sem_ids = {id(todos[s]) for s in semillas}
cambio = True
while cambio:
    cambio = False
    for k, b in list(M.items()):
        if k in sem_ids: continue
        if usado_fuera(b, M): del M[k]; cambio = True
# bloques que no se pueden mover
def no_mover(bl):
    t = texto(bl)
    if re.match(r'^(?:export\s+)?let\s', bl[3]): return 'let'
    for l in t.split('\n')[1:]:
        if re.match(r'^(if\s*\(|[A-Za-z_$][\w$.]*\s*\(|window\.|document\.)', l) and not re.match(r'^(function|async|const|let|var|class|export)\b', l): return 'sentencia suelta: ' + l[:50]
    return None
mal = []
for k, b in list(M.items()):
    r = no_mover(b)
    if r:
        if k in sem_ids: mal.append((b[0], r))
        del M[k]
# si se quitó algo que otro movido usa, ese otro movido se vuelve dependiente de compartido (se importa): válido
if mal: sys.exit('No se pueden mover: ' + str(mal))
# un movido que usa algo que NO se mueve y es `let` reasignado… se importa como valor vivo: ok en ESM
mov = sorted(M.values(), key=lambda b: b[1])
nombres_mov = sorted({n for n, b in todos.items() if id(b) in M and re.match(r'^[A-Za-z_$]', n)})
print(f'{len(mov)} bloques, {sum(b[2]-b[1] for b in mov)} líneas se moverían a src/lib/{modulo}.jsx')
print('Nombres:', ', '.join(nombres_mov))
if prueba: sys.exit(0)

# ── módulo nuevo ──
usados_mov = set()
for b in mov: usados_mov |= ids(b[4])
lineas_imp = []
for k, (i, spec, org) in enumerate(imports):
    if any(n in usados_mov for n in locales(spec)):
        # recorta la especificación a lo usado
        mm = re.search(r'\{([^}]*)\}', spec)
        pre = re.sub(r'\{[^}]*\}', '', spec).strip().strip(',').strip()
        parts = []
        if pre and any(n == (pre[5:].strip() if pre.startswith('* as ') else pre) and n in usados_mov for n in [pre[5:].strip() if pre.startswith('* as ') else pre]): parts.append(pre)
        if mm:
            sel = [p.strip() for p in mm.group(1).split(',') if p.strip() and p.strip().split(' as ')[-1].strip() in usados_mov]
            if sel: parts.append('{ ' + ', '.join(sel) + ' }')
        if parts:
            org2 = org if not org.startswith('./') else org  # mismo directorio
            lineas_imp.append(f"import {', '.join(parts)} from '{org2}'")
# lo que sigue en compartido y el módulo usa
comp_resto = {n for n, b in todos.items() if id(b) not in M and n in usados_mov}
comp_resto = {n for n in comp_resto if n not in imp_local}
if comp_resto:
    lineas_imp.append("import { " + ', '.join(sorted(comp_resto)) + " } from './compartido.jsx'")
out = [f"// Movido de compartido.jsx por scripts/dividir-compartido.py. Sin cambios de comportamiento.", *lineas_imp, '']
for b in mov:
    t = texto(b)
    ls = t.split('\n')
    for j, l in enumerate(ls):
        if decl.match(l) and not l.startswith('export'):
            ls[j] = 'export ' + l; break
        if l.startswith('export'): break
    out.append('\n'.join(ls))
open(DEST, 'w').write('\n'.join(out) + '\n')

# ── compartido.jsx sin los bloques movidos ──
quitar = set()
for b in mov:
    for j in range(b[1], b[2]):
        if j not in imp_lines: quitar.add(j)
nuevo = [l for j, l in enumerate(src) if j not in quitar]
open(COMP, 'w').write('\n'.join(nuevo))

# ── importadores (un archivo puede tener varias importaciones de compartido.jsx) ──
destnames = set(nombres_mov)
pat = re.compile(r"import\s*\{([^}]*)\}\s*from\s*'((?:\.\./lib|\./lib|\.)/compartido\.jsx)'")
for f in glob.glob(os.path.join(ROOT, 'src/**/*.js*'), recursive=True):
    if f in (COMP, DEST): continue
    s = open(f).read()
    sacados = []
    def reemplazo(m):
        esp = [p.strip() for p in m.group(1).split(',') if p.strip()]
        sacar = [p for p in esp if p.split(' as ')[0].strip() in destnames]
        if not sacar: return m.group(0)
        sacados.append((sacar, m.group(2).replace('compartido.jsx', modulo + '.jsx')))
        quedan = [p for p in esp if p not in sacar]
        return ("import { " + ', '.join(quedan) + " } from '" + m.group(2) + "'") if quedan else ''
    s2 = pat.sub(reemplazo, s)
    if not sacados: continue
    ruta = sacados[0][1]
    todo = [n for sc, _ in sacados for n in sc]
    # la importación nueva va tras la última importación de compartido que quede, o al inicio de las importaciones
    linea = "import { " + ', '.join(todo) + " } from '" + ruta + "'"
    ms = list(re.finditer(r"^import .*$", s2, flags=re.M))
    pos = ms[-1].end() if ms else 0
    s2 = s2[:pos] + '\n' + linea + s2[pos:]
    open(f, 'w').write(s2)
print('Listo. Revisa: npm run lint && npm run build')
