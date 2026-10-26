#!/bin/zsh
# Instala pjud-local en este Mac: copia el programa a ~/Library/Application Support/leabogados (launchd no puede leer Descargas)
# y lo programa con launchd, lo más temprano posible para tener margen (26-10-2026): lunes a viernes 06:30, 08:45, 12:30 y 18:00
# (revisión completa: Programación de Salas, Estado Diario y Monitor) y domingo 19:00 (tabla del lunes); además, de lunes a viernes
# cada 15 minutos entre 09:00 y 14:45, el seguimiento del Monitor (--seguir: solo si hoy hay una causa nuestra en tabla; si no, no
# consulta nada). Si el Mac estaba dormido a esa hora, corre al despertar. Si a las 07:15 no corrió, la app avisa (body.vigilar). Requiere ~/.config/leabogados/pjud-local.json. Registro: ~/Library/Logs/leabogados-pjud-local.log
# Desinstalar: launchctl bootout gui/$(id -u)/cl.leabogados.pjud-local && rm ~/Library/LaunchAgents/cl.leabogados.pjud-local.plist
set -e
DIR="$HOME/Library/Application Support/leabogados"; PLIST="$HOME/Library/LaunchAgents/cl.leabogados.pjud-local.plist"; PLIST2="$HOME/Library/LaunchAgents/cl.leabogados.pjud-local-seguir.plist"
NODE="$(command -v node)"; [ -n "$NODE" ] || { echo "Falta node"; exit 1; }
[ -f "$HOME/.config/leabogados/pjud-local.json" ] || { echo "Falta ~/.config/leabogados/pjud-local.json"; exit 1; }
mkdir -p "$DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp "$(dirname "$0")/pjud-local.mjs" "$DIR/pjud-local.mjs"
hora() { echo "<dict><key>Weekday</key><integer>$1</integer><key>Hour</key><integer>$2</integer><key>Minute</key><integer>$3</integer></dict>"; }
CAL=""; for d in 1 2 3 4 5; do CAL="$CAL$(hora $d 6 30)$(hora $d 8 45)$(hora $d 12 30)$(hora $d 18 0)"; done; CAL="$CAL$(hora 0 19 0)"
SEG=""; for d in 1 2 3 4 5; do for h in 9 10 11 12 13 14; do for m in 0 15 30 45; do SEG="$SEG$(hora $d $h $m)"; done; done; done
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>cl.leabogados.pjud-local</string>
<key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/pjud-local.mjs</string></array>
<key>StartCalendarInterval</key><array>$CAL</array>
<key>StandardOutPath</key><string>$HOME/Library/Logs/leabogados-pjud-local.log</string>
<key>StandardErrorPath</key><string>$HOME/Library/Logs/leabogados-pjud-local.log</string>
</dict></plist>
PL
cat > "$PLIST2" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>cl.leabogados.pjud-local-seguir</string>
<key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/pjud-local.mjs</string><string>--seguir</string></array>
<key>StartCalendarInterval</key><array>$SEG</array>
<key>StandardOutPath</key><string>$HOME/Library/Logs/leabogados-pjud-local.log</string>
<key>StandardErrorPath</key><string>$HOME/Library/Logs/leabogados-pjud-local.log</string>
</dict></plist>
PL
for L in cl.leabogados.pjud-local cl.leabogados.pjud-local-seguir; do launchctl bootout "gui/$(id -u)/$L" 2>/dev/null || true; done
launchctl bootstrap "gui/$(id -u)" "$PLIST"; launchctl bootstrap "gui/$(id -u)" "$PLIST2"
echo "Instalado. Revisión completa: lunes a viernes 06:30, 08:45, 12:30 y 18:00; domingo 19:00. Seguimiento: lunes a viernes cada 15 min de 09:00 a 14:45."
