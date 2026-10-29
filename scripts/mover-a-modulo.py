#!/usr/bin/env python3
"""Mueve bloques de nivel superior de src/App.jsx a un módulo propio, junto con todo lo que necesitan.

Uso:  python3 scripts/mover-a-modulo.py <destino.jsx> <Nombre1> [Nombre2 ...] [--umbral=N] [--prueba]

- Calcula el cierre de dependencias de los nombres dados (sin contar lo que ya está en src/lib/base.jsx).
- --umbral=N agrega además todo lo que usan N o más bloques de App.jsx (los ayudantes populares) y su cierre.
- Escribe el módulo destino con `export` en cada bloque, deduce sus importaciones (react, supabase, base, otros módulos de src/lib)
  y deja en App.jsx una importación con los nombres movidos.
- Se detiene si una variable `let` movida se reasigna desde App.jsx (un import no puede reasignarse).
- --prueba solo informa lo que movería.
"""
import re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'src/App.jsx')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
flags = [a for a in sys.argv[1:] if a.startswith('--')]
prueba = '--prueba' in flags
umbral = next((int(f.split('=')[1]) for f in flags if f.startswith('--umbral=')), None)
destino, semillas = args[0], args[1:]
dest_path = os.path.join(ROOT, 'src', destino)

src = open(APP).read().split('\n')
decl = re.compile(r'^(?:export\s+)?(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var|class)\s+([A-Za-z_$][\w$]*))')
starts = []
for i, l in enumerate(src):
    m = decl.match(l)
    if m: starts.append((i, m.group(1) or m.group(2)))

def own_start(i):
    j = i
    while j - 1 >= 0 and src[j - 1].startswith('//'): j -= 1
    return j
own = [own_start(i) for i, _ in starts]
rng = {}
for k, (i, n) in enumerate(starts):
    end = own[k + 1] if k + 1 < len(starts) else len(src)
    rng[n] = (own[k], end)
# un nombre puede declararse en varias líneas de `let a=..., b=...`: los segundos nombres no se mueven solos
# nombres extra declarados en la misma línea (`let a=1, b=2`, `x; let y`, `const { a, b } = X`): apuntan al mismo bloque
for k, (i, n) in enumerate(starts):
    linea = src[i]
    extra = re.findall(r'(?:^let\s+|,\s*)([A-Za-z_$][\w$]*)\s*=(?![=>])', linea) if linea.startswith('let ') else []
    if len(linea) < 120 and '=>' not in linea and 'function' not in linea:
        extra += re.findall(r';\s*(?:let|const|var)\s+([A-Za-z_$][\w$]*)', linea)
    for e in extra:
        if e != n and e not in rng: rng[e] = rng[n]
for i, l in enumerate(src):
    m = re.match(r'^const\s*\{([^}]*)\}\s*=', l)
    if m:
        for e in re.findall(r'[A-Za-z_$][\w$]*', re.sub(r':\s*[A-Za-z_$][\w$]*', '', m.group(1))):
            rng.setdefault(e, (i, i + 1))
names = set(rng)
text = {n: '\n'.join(src[a:b]) for n, (a, b) in rng.items()}
def sin_comentarios(t):
    t = re.sub(r'/\*.*?\*/', ' ', t, flags=re.S)
    return re.sub(r'(?:(?<=\s)|^)//[^\n]*', ' ', t, flags=re.M)
limpio = {n: sin_comentarios(t) for n, t in text.items()}

def modulos_lib():
    d = os.path.join(ROOT, 'src/lib')
    out = {}
    for f in os.listdir(d):
        if f.endswith(('.jsx', '.js')) and os.path.join(d, f) != dest_path:
            for n in re.findall(r'^export (?:const|function|let|class) ([A-Za-z_$][\w$]*)', open(os.path.join(d, f)).read(), re.M):
                out[n] = f
    return out
ya_en_lib = modulos_lib()
names_app = names - set(ya_en_lib)
dep = {n: set(x for x in names_app if x != n and re.search(r'\b' + re.escape(x) + r'\b', limpio[n])) for n in names_app}

def cierre(seed):
    seen = set(seed); st = list(seed)
    while st:
        c = st.pop()
        for d in dep.get(c, ()):
            if d not in seen: seen.add(d); st.append(d)
    return seen

faltan = [s for s in semillas if s not in names_app]
if faltan: sys.exit('No están en App.jsx (o ya salieron): ' + ', '.join(faltan))
mover = cierre(semillas)
if umbral:
    uso = {}
    for n in names_app:
        for d in dep[n]: uso[d] = uso.get(d, 0) + 1
    def es_vista(n): return n[0].isupper() and len(text[n].split('\n')) >= 120
    pop = set(x for x, c in uso.items() if c >= umbral and not es_vista(x))
    mover |= cierre(pop)

# let reasignadas desde fuera: el bloque que las reasigna se mueve con ellas (un import no puede reasignarse)
def let_nombres(conj):
    out = []
    for n in conj:
        if re.search(r'(?:^|[;\n])\s*(?:export\s+)?let\s+(?:[^;\n]*,\s*)?' + re.escape(n) + r'\s*(?:=|;|,|$)', text[n]): out.append(n)
    return out
for _ in range(10):
    fuera = [n for n in names_app if n not in mover]
    agregar = set()
    for n in let_nombres(mover):
        pat = re.compile(r'(?<![\w$.])' + re.escape(n) + r'\s*=(?![=>])')
        for o in fuera:
            if pat.search(text[o]):
                if rng[o][1] - rng[o][0] > 120:
                    sys.exit(f'La variable `let` {n} se reasigna desde {o} (bloque grande): hay que resolverlo a mano.')
                agregar.add(o)
    if not agregar: break
    mover |= cierre(agregar)
total = sum(rng[n][1] - rng[n][0] for n in mover)
print(f'{len(mover)} bloques, {total} líneas -> src/{destino}')
if prueba:
    print(', '.join(sorted(mover, key=lambda n: rng[n][0]))[:1500]); sys.exit(0)

# importaciones de App.jsx (para deducir cuáles necesita el módulo nuevo)
app_txt = '\n'.join(src)
imports = []  # (nombre local, línea de origen especificador, módulo)
for m in re.finditer(r'^import\s+(.+?)\s+from\s+[\'"]([^\'"]+)[\'"]', app_txt, re.M | re.S):
    cuerpo, mod = m.group(1), m.group(2)
    if mod.startswith('./lib/') or cuerpo.strip().startswith('*'): continue
    for part in re.findall(r'[A-Za-z_$][\w$]*(?:\s+as\s+[A-Za-z_$][\w$]*)?', cuerpo.replace('{', ' ').replace('}', ' ')):
        loc = part.split(' as ')[-1].strip()
        imports.append((loc, part.strip(), mod))

cuerpo_nuevo = []
orden = sorted(mover, key=lambda n: rng[n][0])
vistos = set(); unicos = []
for n in orden:
    if rng[n] in vistos: continue
    vistos.add(rng[n]); unicos.append(n)
orden_imp = orden
orden = unicos
for n in orden:
    a, b = rng[n]
    blk = src[a:b]
    while blk and not blk[-1].strip(): blk.pop()
    for t, l in enumerate(blk):
        if decl.match(l) or re.match(r'^const\s*\{', l):
            if not l.startswith('export '): blk[t] = 'export ' + l
            break
    cuerpo_nuevo += blk + ['']
nuevo_txt = '\n'.join(cuerpo_nuevo)

def reescribir(mod):
    if mod.startswith('./'): return '../' + mod[2:] + ('.js' if mod in ('./cartola',) else '')
    if mod.startswith('../'): return '../' + mod
    return mod
por_modulo = {}
for loc, part, mod in imports:
    if re.search(r'(?<![\w$])(?:(?<=\.\.\.)|(?<!\.))' + re.escape(loc) + r'(?![\w$])', nuevo_txt):
        por_modulo.setdefault(mod, []).append(part)
lineas_imp = []
for mod, partes in por_modulo.items():
    default = [p for p in partes if p in ('React',)]
    named = [p for p in partes if p not in default]
    if mod in ('react', 'react-dom') or not mod.startswith('.'):
        if default and not named: lineas_imp.append(f"import {default[0]} from '{mod}'")
        else: lineas_imp.append(f"import {{ {', '.join(named)} }} from '{reescribir(mod)}'")
    elif mod.startswith('../') or mod.startswith('./'):
        # la base de lib/ vive en src/lib: './x' -> '../x'
        lineas_imp.append(f"import {{ {', '.join(named)} }} from '{reescribir(mod)}'" if named else f"import '{reescribir(mod)}'")
# base y otros módulos lib
usados_lib = {}
for n, f in ya_en_lib.items():
    if re.search(r'(?<![\w$])(?:(?<=\.\.\.)|(?<!\.))' + re.escape(n) + r'(?![\w$])', nuevo_txt):
        usados_lib.setdefault(f, []).append(n)
for f, ns in sorted(usados_lib.items()):
    lineas_imp.append(f"import {{ {', '.join(sorted(ns))} }} from '{'./' if destino.startswith('lib/') else '../lib/'}{f}'")
# import * as (SD) y similares
for m in re.finditer(r'^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+[\'"]([^\'"]+)[\'"]', app_txt, re.M):
    if re.search(r'(?<![\w$.])' + re.escape(m.group(1)) + r'\.', nuevo_txt):
        lineas_imp.append(f"import * as {m.group(1)} from '{reescribir(m.group(2))}'")

cab = f"// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.\n" + '\n'.join(lineas_imp) + '\n\n'
modo = 'a' if os.path.exists(dest_path) else 'w'
with open(dest_path, modo) as f:
    f.write(('\n' if modo == 'a' else '') + (cab if modo == 'w' else '') + nuevo_txt + '\n')

# quitar de App.jsx y agregar la importación
quitar = set()
for n in mover:
    a, b = rng[n]
    quitar.update(range(a, b))
rest = [l for i, l in enumerate(src) if i not in quitar]
s = '\n'.join(rest)
nombres_imp = list(dict.fromkeys(orden_imp))
imp = "import { " + ', '.join(nombres_imp) + " } from './" + destino.replace('src/', '') + "'\n"
s = s.replace("import { createPortal } from 'react-dom'\n", "import { createPortal } from 'react-dom'\n" + imp, 1)
open(APP, 'w').write(s)
print('listo:', len(src), '->', len(rest), 'líneas en App.jsx')
