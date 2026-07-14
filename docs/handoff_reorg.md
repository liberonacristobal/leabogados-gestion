# Handoff para Claude Code — app `leabogados-reorg`

Pega este documento en la sesión de Claude Code del repo **leabogados-reorg** (https://leabogados-reorg.vercel.app/). El objetivo: que esa app quede **idéntica en formato, forma de pensar, guardar y analizar** a la app de gestión del estudio, y que **corrija su identidad visual** (hoy usa un ícono/logo que NO es de la oficina, entre otras divergencias).

Esa app conserva **su propio** proyecto Supabase, su Vercel y su `demoData`; solo se cambian formato, reglas y assets de marca — nunca los IDs de su backend.

---

## Parte 1 — Adoptar el canon (fuente única de reglas)

Copia el archivo **`docs/canon_replicable.md`** de la app de gestión a este repo (idealmente vuélvelo la base de tu `CLAUDE.md`) y constrúyete contra él. Ahí están, con snippets replicables: filosofía (*la herramienta APRENDE y nunca repite trabajo*, menos es más, rigor de cifras, todo clickeable/reversible), arquitectura, modelo de datos + capa de aprendizaje (`learnings`/`usage_events`, `learnPut`/`logEvent`), RLS ON estándar, formato de cifras OVERVIEW vs DETALLE, canon de la foto, navegación, IA con compuerta humana, seguridad, y flujo de trabajo (build verde + demo + changelog).

**No-negociables (resumen):** paleta `C` obligatoria (nunca hex suelto), mobile iPhone primero, single source of truth por cifra, RLS ON + `team_all` (nunca `anon`), español de Chile "tú", **sin emojis**, sin disclaimers, todo reversible, la IA propone y el humano confirma.

---

## Parte 2 — Identidad visual del estudio (ARREGLAR el ícono ajeno)

La marca es **Liberona Escala Abogados ("LE Abogados")**. Estos son los assets y la config exactos de la app de gestión. Replícalos tal cual.

### 2.1 Assets (archivos binarios — hay que COPIARLOS, no se regeneran)
El logo y los íconos son imágenes reales de la oficina; **Claude Code no puede recrearlos**. El usuario debe **copiar estos archivos** desde `public/` de la app de gestión a `public/` de este repo:

```
public/le-logo-blanco.png     ← logo blanco (para fondos navy: headers, correos)
public/le-logo-color.png      ← logo a color (fondos claros)
public/favicon.ico
public/favicon-16.png
public/favicon-32.png
public/apple-touch-icon.png
public/icon-192.png
public/icon-512.png
public/manifest.webmanifest
```
> Si esta app tenía un favicon/ícono genérico (Vite, React, u otro), **bórralo** y reemplázalo por estos. Ese es el "ícono que no es de la oficina".

### 2.2 `index.html` (head exacto)
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
<meta name="apple-mobile-web-app-title" content="LE Abogados"/>
<meta name="theme-color" content="#003C50"/>
<link rel="icon" href="/favicon.ico" sizes="any"/>
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"/>
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png"/>
<link rel="apple-touch-icon" href="/apple-touch-icon.png"/>
<link rel="manifest" href="/manifest.webmanifest"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;1,9..144,300&display=swap" rel="stylesheet"/>
<title>LE Abogados · Gestión</title>
```
> Ajusta el `<title>` si esta app tiene otro nombre de módulo (ej. "LE Abogados · Reorganización"), pero mantén el prefijo **"LE Abogados"** y el `apple-mobile-web-app-title` "LE Abogados".

### 2.3 `manifest.webmanifest`
```json
{
  "name": "LE Abogados · Gestión",
  "short_name": "LE Abogados",
  "lang": "es-CL",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#F5F5F5",
  "theme_color": "#003C50",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" }
  ]
}
```
> El `name` puede llevar el nombre del módulo de esta app; `short_name` siempre "LE Abogados".

### 2.4 Tipografía de marca (OJO — jerarquía exacta)
- **Fraunces** (serif, italic 300): **SOLO** para el acento de **bienvenida/login** ("Bienvenido", "Gestión Oficina"). **NO** en el saludo ("¡Hola, X!") ni en títulos de la app ni en la UI. Se carga por Google Fonts (link de arriba). Uso: `fontFamily:"'Fraunces',serif"`.
- **Saludo y títulos display** ("¡Hola, X!", encabezados de vista): **sans limpia navy bold**. La app de gestión los declara `fontFamily:"'DM Sans',sans-serif"`, peso 600, `color:C.accent` (navy, con el nombre en accent), `letterSpacing:-.4`. Nota: hoy gestión **no carga** DM Sans, así que en la práctica cae a **system sans** — para calzar de verdad, carga DM Sans por Google Fonts en ambas apps (o deja el fallback system, pero **sans upright, no Fraunces italic**).
- **Cuerpo/UI:** system font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`).

### 2.5 Color de marca
- `theme-color` y todo lo corporativo = **navy `#003C50`** (token `C.accent`). Fondo app `#F5F5F5` (`C.bg`). Usa la paleta `C` completa del canon; el logo blanco va sobre navy, el de color sobre claro.

---

## Parte 3 — Autoauditoría rápida ("entre otras cosas")
Revisa y corrige en este repo lo que se haya desviado del canon:
- [ ] **Favicon/ícono** = los de la oficina (Parte 2.1), no el genérico.
- [ ] **Paleta `C`** aplicada (objeto exacto del canon); cero azules genéricos o colores fuera de paleta.
- [ ] **theme-color `#003C50`** + manifest con nombre "LE Abogados".
- [ ] **Fraunces** solo en acentos de marca; system font en UI.
- [ ] **Sin emojis** en toda la UI.
- [ ] **Español de Chile "tú"**, wording coherente, sin disclaimers.
- [ ] **Mobile iPhone** sin romper layout; pills estrechas; sin bottom-sheet.
- [ ] **RLS ON + `team_all`** en toda tabla de su Supabase; nunca `anon`; secretos solo en edge functions.
- [ ] **Diálogos** `appAlert`/`appConfirm`/`appPrompt` (no nativos).
- [ ] **La app aprende** (`learnPut`/`learnings`) y **no hace repetir** trabajo; toda decisión manual se guarda y reutiliza.
- [ ] **Cifras**: single source of truth, redondeo solo al mostrar, formato OVERVIEW vs DETALLE.
- [ ] **Build verde** (`npm run build`) + verificación en demo (`?demo=1`) antes de publicar.

---

*Fuente: app de gestión del estudio (`docs/canon_replicable.md`). Ante cualquier duda de formato/comportamiento, ese canon manda.*
