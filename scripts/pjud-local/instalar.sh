#!/bin/zsh
# Instala pjud-local en este Mac: copia el programa a ~/Library/Application Support/leabogados (launchd no puede leer Descargas)
# y lo programa con launchd: lunes a viernes 08:30, 13:30 y 19:30, sábado 10:00. Si el Mac estaba dormido a esa hora, corre al
# despertar. Requiere ~/.config/leabogados/pjud-local.json. Registro: ~/Library/Logs/leabogados-pjud-local.log
# Desinstalar: launchctl bootout gui/$(id -u)/cl.leabogados.pjud-local && rm ~/Library/LaunchAgents/cl.leabogados.pjud-local.plist
set -e
DIR="$HOME/Library/Application Support/leabogados"; PLIST="$HOME/Library/LaunchAgents/cl.leabogados.pjud-local.plist"
NODE="$(command -v node)"; [ -n "$NODE" ] || { echo "Falta node"; exit 1; }
[ -f "$HOME/.config/leabogados/pjud-local.json" ] || { echo "Falta ~/.config/leabogados/pjud-local.json"; exit 1; }
mkdir -p "$DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp "$(dirname "$0")/pjud-local.mjs" "$DIR/pjud-local.mjs"
hora() { echo "<dict><key>Weekday</key><integer>$1</integer><key>Hour</key><integer>$2</integer><key>Minute</key><integer>$3</integer></dict>"; }
CAL=""; for d in 1 2 3 4 5; do CAL="$CAL$(hora $d 8 30)$(hora $d 13 30)$(hora $d 19 30)"; done; CAL="$CAL$(hora 6 10 0)"
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
launchctl bootout "gui/$(id -u)/cl.leabogados.pjud-local" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Instalado. Consultas: lunes a viernes 08:30, 13:30 y 19:30; sábado 10:00."
