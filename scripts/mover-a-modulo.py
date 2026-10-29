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
            txt = open(os.path.join(d, f)).read()
            for n in re.findall(r'^export (?:async\s+)?(?:const|function|let|class) ([A-Za-z_$][\w$]*)', txt, re.M): out[n] = f
            for grupo in re.findall(r'^export const \{([^}]*)\}', txt, re.M):
                for n in re.findall(r'[A-Za-z_$][\w$]*', re.sub(r':\s*[A-Za-z_$][\w$]*', '', grupo)): out[n] = f
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
vista = '--vista' in flags
if vista:
    # lo que otros bloques de App.jsx también usan va a lib/compartido.jsx; el resto viaja con la vista
    fuera = [n for n in names_app if n not in mover]
    usados_fuera = set(x for x in mover if x not in semillas and any(x in dep[o] for o in fuera))
    compartido = cierre(usados_fuera) & mover
    compartido -= set(semillas)
    privado = mover - compartido
else:
    compartido, privado = set(), mover
total = sum(rng[n][1] - rng[n][0] for n in mover)
print(f'{len(mover)} bloques, {total} líneas -> src/{destino}' + (f' ({len(privado)} propios, {len(compartido)} a lib/compartido.jsx)' if vista else ''))
if prueba:
    print('propios:', ', '.join(sorted(privado, key=lambda n: rng[n][0]))[:600])
    if vista: print('compartidos:', ', '.join(sorted(compartido, key=lambda n: rng[n][0]))[:800])
    sys.exit(0)

app_txt = '\n'.join(src)
imports = []   # (nombre local, texto del especificador, módulo, es_default)
for m in re.finditer(r'^import\s+(.+?)\s+from\s+[\'"]([^\'"]+)[\'"]', app_txt, re.M | re.S):
    cuerpo, mod = m.group(1), m.group(2)
    if mod.startswith('./lib/') or cuerpo.strip().startswith('*'): continue
    c = cuerpo.strip()
    mdef = re.match(r'^([A-Za-z_$][\w$]*)\s*(?:,|$)', c)
    if mdef:
        imports.append((mdef.group(1), mdef.group(1), mod, True))
    llaves = re.search(r'\{([^}]*)\}', c, re.S)
    if llaves:
        for part in re.findall(r'[A-Za-z_$][\w$]*(?:\s+as\s+[A-Za-z_$][\w$]*)?', llaves.group(1)):
            imports.append((part.split(' as ')[-1].strip(), part.strip(), mod, False))
nss = re.findall(r'^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+[\'"]([^\'"]+)[\'"]', app_txt, re.M)

def ident(n, t): return re.search(r'(?<![\w$])(?:(?<=\.\.\.)|(?<!\.))' + re.escape(n) + r'(?![\w$])', t)

def reescribir(mod):
    if mod.startswith('./'): return '../' + mod[2:] + ('.js' if mod in ('./cartola',) else '')
    if mod.startswith('../'): return '../' + mod
    return mod

def escribir_modulo(path, nombres, extra_lib=()):
    orden = sorted(nombres, key=lambda n: rng[n][0])
    vistos = set(); unicos = []
    for n in orden:
        if rng[n] in vistos: continue
        vistos.add(rng[n]); unicos.append(n)
    cuerpo = []
    for n in unicos:
        a, b = rng[n]
        blk = src[a:b]
        while blk and not blk[-1].strip(): blk.pop()
        for t, l in enumerate(blk):
            if decl.match(l) or re.match(r'^const\s*\{', l):
                if not l.startswith('export '): blk[t] = 'export ' + l
                break
        cuerpo += blk + ['']
    txt = '\n'.join(cuerpo)
    por_modulo = {}
    for loc, part, mod, es_def in imports:
        if ident(loc, txt): por_modulo.setdefault(mod, {'def': [], 'named': []})['def' if es_def else 'named'].append(part)
    lin = []
    for mod, d in por_modulo.items():
        ref = reescribir(mod)
        partes = []
        if d['def']: partes.append(d['def'][0] if isinstance(d['def'], list) else d['def'])
        if d['named']: partes.append('{ ' + ', '.join(d['named']) + ' }')
        lin.append(f"import {', '.join(partes)} from '{ref}'")
    for loc, mod in nss:
        if ident(loc, txt): lin.append(f"import * as {loc} from '{reescribir(mod)}'")
    pre = './' if path.startswith('lib/') else '../lib/'
    usados = {}
    for n, f in ya_en_lib.items():
        if ident(n, txt): usados.setdefault(f, []).append(n)
    for n in extra_lib:
        if ident(n, txt): usados.setdefault('compartido.jsx', []).append(n)
    for f, ns in sorted(usados.items()):
        if path == 'lib/' + f: continue
        lin.append(f"import {{ {', '.join(sorted(set(ns)))} }} from '{pre}{f}'")
    full = os.path.join(ROOT, 'src', path)
    if os.path.exists(full):
        # módulo existente: solo se agregan las importaciones que le faltan, justo después de las que ya tiene
        actual = open(full).read()
        ya = set()
        for m in re.finditer(r'^import\s+(.+?)\s+from\s+[\'"][^\'"]+[\'"]', actual, re.M | re.S):
            for part in re.findall(r'[A-Za-z_$][\w$]*(?:\s+as\s+[A-Za-z_$][\w$]*)?', m.group(1).replace('{', ' ').replace('}', ' ').replace('*', ' ')):
                ya.add(part.split(' as ')[-1].strip())
        faltan_imp = []
        for l in lin:
            if l.startswith('import * as '):
                if l.split()[3] not in ya: faltan_imp.append(l)
                continue
            m = re.match(r"import (?:([A-Za-z_$][\w$]*))?(?:,\s*)?(?:\{ (.+) \})? from '(.+)'$", l)
            if not m: faltan_imp.append(l); continue
            dflt, nombrados, modref = m.group(1), m.group(2), m.group(3)
            partes = []
            if dflt and dflt not in ya: partes.append(dflt)
            nm = [x.strip() for x in (nombrados or '').split(',') if x.strip() and x.strip().split(' as ')[-1] not in ya]
            if nm: partes.append('{ ' + ', '.join(nm) + ' }')
            if partes: faltan_imp.append(f"import {', '.join(partes)} from '{modref}'")
        ultimo = 0
        for m in re.finditer(r'^import\s+.+?\s+from\s+[\'"][^\'"]+[\'"][^\n]*\n', actual, re.M | re.S): ultimo = m.end()
        actual = actual[:ultimo] + ''.join(l + '\n' for l in faltan_imp) + actual[ultimo:]
        with open(full, 'w') as f: f.write(actual.rstrip('\n') + '\n\n' + txt + '\n')
    else:
        cab = '// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.\n' + '\n'.join(lin) + '\n\n'
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, 'w') as f: f.write(cab + txt + '\n')
    # solo se importan desde App los nombres que el módulo realmente exporta (las variables `let` de una línea compartida no)
    exportados = set(re.findall(r'^export (?:async\s+)?(?:const|function|let|class) ([A-Za-z_$][\w$]*)', open(full).read(), re.M))
    for grupo in re.findall(r'^export const \{([^}]*)\}', open(full).read(), re.M):
        exportados |= set(re.findall(r'[A-Za-z_$][\w$]*', re.sub(r':\s*[A-Za-z_$][\w$]*', '', grupo)))
    return [n for n in dict.fromkeys(orden) if n in exportados]

nombres_comp = []
if compartido: nombres_comp = escribir_modulo('lib/compartido.jsx', compartido)
nombres_priv = escribir_modulo(destino, privado, extra_lib=nombres_comp)

quitar = set()
for n in mover:
    a, b = rng[n]; quitar.update(range(a, b))
rest = [l for i, l in enumerate(src) if i not in quitar]
s = '\n'.join(rest)
ancla = "import { createPortal } from 'react-dom'\n"
nuevo = ''
if vista:
    nuevo_imp = "import { " + ', '.join(nombres_comp) + " } from './lib/compartido.jsx'\n" if nombres_comp else ''
    nuevo_lazy = ''.join(f"const {comp} = lazyVista(() => import('./{destino}'), '{comp}')\n" for comp in semillas)
    s = s.replace(ancla, ancla + nuevo_imp, 1)
    ult = 0
    for m in re.finditer(r"^import\s+.+?\s+from\s+['\"][^'\"]+['\"][^\n]*\n|^\} from '[^']+'\n", s, re.M | re.S): ult = max(ult, m.end())
    s = s[:ult] + nuevo_lazy + s[ult:]
else:
    s = s.replace(ancla, ancla + "import { " + ', '.join(dict.fromkeys(nombres_priv)) + " } from './" + destino + "'\n", 1)
open(APP, 'w').write(s)
print('listo:', len(src), '->', len(rest), 'líneas en App.jsx')
