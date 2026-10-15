#!/usr/bin/env bash
#
# scripts/personalize.sh — adapta el repositorio a tu cuenta antes de publicarlo.
#
#   ./scripts/personalize.sh <usuario-o-org> <nombre-del-repo> [--name "Tu Nombre"]
#
#   ./scripts/personalize.sh alice notepads-for-linux
#   ./scripts/personalize.sh alice notepads-linux --name "Alice Pérez"
#
# Qué hace:
#   1. Sustituye el propietario/repositorio de ejemplo en README, landing page,
#      Cargo.toml, tauri.conf.json, docs y NOTICE.
#   2. Activa los badges del README (CI, Release, Licencia, Descargas) apuntando a
#      tu repositorio real.
#   3. Fija el identificador de la aplicación y las URLs de los enlaces.
#
# Es idempotente: puedes ejecutarlo varias veces y con distintos nombres.
# Antes de tocar nada crea copias .bak de los archivos que modifica.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

OWNER="${1:-}"
REPO="${2:-}"
AUTHOR_NAME=""

shift 2 || true
while [ $# -gt 0 ]; do
  case "$1" in
    --name) AUTHOR_NAME="${2:-}"; shift 2;;
    *) echo "opción desconocida: $1" >&2; exit 2;;
  esac
done

if [ -z "$OWNER" ] || [ -z "$REPO" ]; then
  cat >&2 <<EOF
Uso: ./scripts/personalize.sh <usuario-o-org> <nombre-del-repo> [--name "Tu Nombre"]

Ejemplo:
  ./scripts/personalize.sh alice notepads-for-linux --name "Alice Pérez"
EOF
  exit 2
fi

URL="https://github.com/${OWNER}/${REPO}"
echo "==> personalizando para ${OWNER}/${REPO}"
echo "    URL: ${URL}"

# Cadena de sustituciones: [patrón de búsqueda, reemplazo]
files=(
  "README.md"
  "docs/landing/index.html"
  "src-tauri/Cargo.toml"
  "src-tauri/tauri.conf.json"
  "docs/BUILD.md"
  "CHANGELOG.md"
  "NOTICE"
)

for rel in "${files[@]}"; do
  f="${ROOT}/${rel}"
  [ -f "$f" ] || continue
  cp -n "$f" "${f}.bak" 2>/dev/null || true
done

replace_in() {
  local file="$1"; shift
  for pair in "$@"; do
    local from="${pair%%|*}"
    local to="${pair##*|}"
    # -i con patrón literal: escapamos sólo para sed
    python3 - "$file" "$from" "$to" <<'PY'
import sys, pathlib, re
path, frm, to = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
if not path.exists():
    sys.exit(0)
text = path.read_text(encoding="utf-8")
new = text.replace(frm, to)
if new != text:
    path.write_text(new, encoding="utf-8")
    print(f"    actualizado {path.name}: {frm[:48]}")
PY
  done
}

PAIRS=(
  "github.com/notepads-linux/notepads-for-linux|github.com/${OWNER}/${REPO}"
  "https://github.com/notepads-linux|https://github.com/${OWNER}"
  "TU_USUARIO.github.io/TU_REPO|${OWNER}.github.io/${REPO}"
  "TU_USUARIO/TU_REPO|${OWNER}/${REPO}"
)

echo "==> sustituyendo referencias al repositorio de ejemplo"
for rel in "${files[@]}"; do
  replace_in "${ROOT}/${rel}" "${PAIRS[@]}"
done

# Cargo.toml: campo repository
if [ -f "${ROOT}/src-tauri/Cargo.toml" ]; then
  python3 - "${ROOT}/src-tauri/Cargo.toml" "$URL" <<'PY'
import sys, pathlib, re
path, url = pathlib.Path(sys.argv[1]), sys.argv[2]
text = path.read_text(encoding="utf-8")
text = re.sub(r'^repository = ".*"$', f'repository = "{url}"', text, flags=re.M)
if 'repository =' not in text:
    text = text.replace('[package]', f'[package]\nrepository = "{url}"', 1)
path.write_text(text, encoding="utf-8")
print(f"    Cargo.toml: repository = {url}")
PY
fi

# tauri.conf.json: identificador inverso (dominio/usuario)
if [ -f "${ROOT}/src-tauri/tauri.conf.json" ]; then
  python3 - "${ROOT}/src-tauri/tauri.conf.json" "$OWNER" <<'PY'
import json, sys, pathlib
path, owner = pathlib.Path(sys.argv[1]), sys.argv[2].lower()
data = json.loads(path.read_text(encoding="utf-8"))
data["identifier"] = f"io.github.{owner}.notepads"
path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"    tauri.conf.json: identifier = {data['identifier']}")
PY
fi

# README: badges reales
if [ -f "${ROOT}/README.md" ]; then
  python3 - "${ROOT}/README.md" "$OWNER" "$REPO" <<'PY'
import sys, pathlib, re
path, owner, repo = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
text = path.read_text(encoding="utf-8")

badges = f"""[![CI](https://github.com/{owner}/{repo}/actions/workflows/ci.yml/badge.svg)](https://github.com/{owner}/{repo}/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/{owner}/{repo}?label=última%20versión&sort=semver)](https://github.com/{owner}/{repo}/releases)
[![Descargas](https://img.shields.io/github/downloads/{owner}/{repo}/total)](https://github.com/{owner}/{repo}/releases)
[![Licencia](https://img.shields.io/github/license/{owner}/{repo})](LICENSE)
[![Plataforma](https://img.shields.io/badge/plataforma-Linux-blue)](#requisitos)
"""

# Reemplaza el bloque de badges del README original (todo lo que hay entre el
# cierre de la descripción y la línea del separador).
pattern = re.compile(
    r"\[!\[Plataforma\].*?\n(?:\s*&nbsp;\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)\n?)+",
    re.S,
)
if pattern.search(text):
    text = pattern.sub(badges, text, count=1)
    print("    README.md: badges actualizados")
else:
    # Inserta los badges justo antes del primer separador horizontal
    parts = text.split("\n---\n", 1)
    if len(parts) == 2:
        parts[0] = parts[0].rstrip() + "\n\n" + badges
        text = "\n---\n".join(parts)
        print("    README.md: badges insertados")

path.write_text(text, encoding="utf-8")
PY
fi

if [ -n "$AUTHOR_NAME" ]; then
  python3 - "${ROOT}/LICENSE" "$AUTHOR_NAME" <<'PY'
import sys, pathlib, datetime
path, name = pathlib.Path(sys.argv[1]), sys.argv[2]
text = path.read_text(encoding="utf-8")
year = datetime.date.today().year
text = text.replace("Copyright (c) 2026 Notepads for Linux contributors",
                    f"Copyright (c) {year} {name}")
path.write_text(text, encoding="utf-8")
print(f"    LICENSE: copyright de {name}")
PY
fi

cat <<EOF

==> hecho.

Siguientes pasos:
  1. Revisa los cambios:      git diff --stat
  2. Comprueba los badges:    grep -n "img.shields.io" README.md
  3. Borra las copias:        find . -name '*.bak' -delete
  4. Commit y push:
       git add -A && git commit -m "Personalizar repositorio para ${OWNER}/${REPO}"
       git push

No ha tocado el código fuente, así que los tests siguen siendo válidos:
  npm test && cargo test --manifest-path src-tauri/Cargo.toml
EOF
