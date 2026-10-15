# Compilar, ejecutar y empaquetar

## 0. Forma rápida: probar sin compilar nada

```bash
npm ci                # o: npm install
npm run demo          # genera demo/notepads-for-linux-demo.html
```

Ese HTML **contiene la aplicación entera** (CSS y JS en línea, sin peticiones de red).
Ábrelo con doble clic o con `xdg-open`. Todo funciona salvo el acceso real al sistema
de archivos: en el navegador los archivos viven en memoria o se descargan.

Para el desarrollo con recarga y proxy igual que en Tauri:

```bash
npm run serve         # http://localhost:5178
```

---

## 1. Dependencias del sistema

Tauri en Linux necesita WebKitGTK y GTK 3. Además, para compilar el backend hace falta
Rust y Node.

### Debian / Ubuntu / Linux Mint / Pop!_OS

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf build-essential curl \
  nodejs npm python3-pil

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

Si usas una versión antigua (Ubuntu 22.04 lleva WebKitGTK 4.0), cambia
`libwebkit2gtk-4.1-dev` por `libwebkit2gtk-4.0-dev` y compila con
`--no-default-features` para no necesitar el appindicator:

```bash
npx tauri build --no-default-features
```

### Fedora / RHEL / CentOS Stream

```bash
sudo dnf install -y webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel \
  librsvg2-devel patchelf gcc gcc-c++ make nodejs npm python3-pillow
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Arch / Manjaro / EndeavourOS

```bash
sudo pacman -S --needed webkit2gtk-4.1 gtk3 libayatana-appindicator librsvg \
  patchelf base-devel nodejs npm python-pillow rust
```

### openSUSE

```bash
sudo zypper install webkit2gtk4.1-devel gtk3-devel libappindicator3-devel \
  librsvg-devel patchelf nodejs20 npm20 python3-Pillow
```

> **Bandeja del sistema.** Si tu distro no tiene `libayatana-appindicator`, compila sin
> la feature `tray`. La aplicación funciona igual; simplemente no aparece el icono de
> bandeja con "New window" y "Quit".

---

## 2. Desarrollo

```bash
npm install
npm run dev          # tauri dev: abre la ventana con recarga en caliente
```

Bajo el capó `npm run dev` arranca `scripts/serve.mjs` (un servidor estático sin
dependencias) y apunta el webview ahí, así que los cambios en `src/*.js` y
`src/styles.css` se ven con solo recargar (`F5` o `Ctrl+R` dentro del webview).

### Tests

```bash
npm test                                        # jsdom: editor, búsqueda, diff, sesión
cargo test --manifest-path src-tauri/Cargo.toml  # códecs de encoding, CRLF/LF
npm run lint                                    # cargo fmt --check + clippy -D warnings
```

---

## 3. Compilar

```bash
npm run build        # binario optimizado: src-tauri/target/release/notepads-for-linux
npm run bundle       # y además .deb + .rpm + .AppImage en src-tauri/target/release/bundle/
```

El perfil de release usa `opt-level = "s"`, LTO, `codegen-units = 1`, `panic = "abort"`
y `strip`: el binario ronda los 10-14 MB y no arrastra runtime de Node, porque Tauri
usa el WebKitGTK del sistema.

### Solo un formato

```bash
npx tauri build --bundles deb
npx tauri build --bundles appimage
```

### Paquetes específicos de distro

```bash
# Debian/Ubuntu: instalar el .deb generado
sudo apt install ./src-tauri/target/release/bundle/deb/*.deb

# AppImage: sin instalación
chmod +x src-tauri/target/release/bundle/appimage/*.AppImage
./Notepads*.AppImage

# Extraer el AppImage (útil en distros sin FUSE)
./Notepads*.AppImage --appimage-extract
```

### Arch (AUR, receta de referencia)

Un `PKGBUILD` mínimo, por si quieres publicarlo:

```bash
pkgname=notepads-for-linux
pkgver=1.0.0
pkgrel=1
pkgdesc="A modern, lightweight text editor with a minimalist design (Linux remake of Notepads)"
arch=('x86_64' 'aarch64')
depends=('webkit2gtk-4.1' 'gtk3' 'libayatana-appindicator' 'librsvg')
makedepends=('rust' 'cargo' 'nodejs' 'npm' 'pkgconf')
source=("$pkgname-$pkgver.tar.gz::$url/archive/v$pkgver.tar.gz")
build() { cd "$pkgname-$pkgver"; npm ci; npx tauri build --bundles none; }
package() { install -Dm755 src-tauri/target/release/notepads-for-linux "$pkgdir/usr/bin/notepads-for-linux"; }
```

---

## 4. Instalar en el sistema

```bash
./scripts/install.sh              # usuario actual: ~/.local/bin + .desktop + iconos
./scripts/install.sh --system     # /usr/local (pide sudo)
./scripts/install.sh --uninstall  # desinstala
```

Instala también la asociación de archivos (`MimeType=text/plain;text/markdown;…`), el
icono en los tamaños de la caché de iconos, y acciones de escritorio para "New window"
y "New document".

---

## 5. Integración con CLI y "Open with"

```bash
notepads-for-linux                     # una ventana vacía
notepads-for-linux notas.md            # abre el archivo (o lo añade a la instancia abierta)
notepads-for-linux a.txt b.txt c.txt   # una pestaña por archivo
notepads-for-linux --new-window x.txt  # fuerza una ventana nueva
```

Para que sea el editor por defecto:

```bash
xdg-mime default io.github.notepads-linux.desktop text/plain
xdg-mime default io.github.notepads-linux.desktop text/markdown
xdg-settings set default-text-editor io.github.notepads-linux.desktop
```

---

## 6. Problemas conocidos y soluciones

| Síntoma | Causa y solución |
|---|---|
| La ventana aparece en blanco | WebKitGTK antiguo. Fuerza renderizado por software: `WEBKIT_DISABLE_COMPOSITING_MODE=1 notepads-for-linux`. También prueba `LIBGL_ALWAYS_SOFTWARE=1` |
| Pantalla negra con GPU NVIDIA propietaria | `__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia` o cambia a Wayland |
| Faltan los bordes redondeados o el tinte | Wayland sin compositor; en X11 instala `picom` con `--backend glx` |
| No aparece el icono de bandeja | Falta `libayatana-appindicator`; instálalo o compila con `--no-default-features` |
| `error: failed to run custom build command ... Permission ... not found` | Los permisos de `capabilities/default.json` no existen en tu versión de Tauri; revisa la lista que imprime el error y ajusta |
| `pattern ... not found` al compilar con Wayland+GTK4 | Asegúrate de usar WebKitGTK **4.1**, no 4.0 |
| Arranque lento la primera vez | WebKit compila su caché de shaders; a partir de la segunda apertura es instantáneo |

---

## 7. Estructura del repositorio

```
notepads-linux/
├── src/                     frontend: HTML + CSS + ES modules (sin bundler)
│   ├── index.html           estructura: barra de pestañas, tarjeta de búsqueda, barra de estado
│   ├── styles.css           Fluent Design, temas claro/oscuro y acento
│   ├── app.js               shell: pestañas, menús, diálogos, ajustes, sesión, atajos
│   ├── editor.js            superficie de texto: textarea + capa espejo + gutter
│   ├── bridge.js            puerta única al sistema (Tauri ⇄ navegador)
│   ├── diff.js              diff por líneas para el visor Alt+D
│   └── icons.js             set de iconos de 16 px
├── src-tauri/               backend nativo
│   ├── src/lib.rs           comandos: ficheros, encodings, ventanas, sesión, ajustes
│   ├── src/main.rs          punto de entrada
│   ├── tauri.conf.json      ventana, bundle, asociaciones de archivos
│   ├── capabilities/        permisos de la webview (mínimos)
│   └── icons/               iconos generados
├── scripts/                 serve, build-demo, make-icons, install
├── tests/smoke.test.mjs     tests funcionales en jsdom
├── docs/                    este documento, ingeniería inversa, inventario, capturas
└── demo/                    HTML autocontenido generado
```

---

## 8. Publicar tu propio fork (GitHub / GitLab / Codeberg)

El repositorio no viene con `.git` inicializado a propósito. Para publicarlo:

```bash
cd notepads-for-linux
git init -b main
git add .
git commit -m "Notepads for Linux 1.0.0 — port inicial"

# Con la CLI de GitHub ya autenticada:
gh repo create notepads-for-linux --public --source=. --push \
  --description "A modern, lightweight text editor with a minimalist design — Linux remake of Notepads (Tauri)"

# O a mano:
git remote add origin git@github.com:TU_USUARIO/notepads-for-linux.git
git push -u origin main
```

En cuanto subas el primer commit, `.github/workflows/ci.yml` se encarga de todo:
tests de frontend en jsdom, `cargo fmt`/`clippy`/`test` del backend y la matriz de
empaquetado `.deb`, `.rpm` y `.AppImage`, dejando los artefactos descargables en cada
ejecución. Para publicar una release con los binarios adjuntos:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Si quieres que la demo de un solo archivo esté siempre disponible, activa GitHub Pages
apuntando a la carpeta `demo/` de la rama `main`: el HTML funciona tal cual, sin build.

---

## 9. Verificar el binario real sin pantalla (Xvfb)

Los tests de jsdom cubren la lógica, pero el binario nativo se puede comprobar de
verdad en una máquina sin escritorio (CI, servidor, contenedor). Es la forma de
detectar los fallos que solo aparecen con WebKitGTK y con el backend Rust de por medio:

```bash
sudo apt install xvfb x11-utils imagemagick

cargo build --manifest-path src-tauri/Cargo.toml --bin notepads-for-linux   # depuración: rápido

Xvfb :99 -screen 0 1400x1000x24 &
export DISPLAY=:99
export WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 GDK_BACKEND=x11

./src-tauri/target/debug/notepads-for-linux archivo1.md archivo2.txt &
sleep 15

# Comprobar que la ventana existe y que el título es el del archivo activo:
xwininfo -root -children | grep -i notepads

import -window root /tmp/captura.png     # capturar la pantalla virtual
```

Señales de que algo va mal, y qué significan:

| Señal | Significado |
|---|---|
| No aparece la ventana en `xwininfo` | El webview no ha arrancado (falta WebKitGTK 4.1 o el frontend no carga) |
| El título sigue siendo `Untitled - Notepads` con archivos por CLI | El comando `take_launch_files` no llegó o el evento no se emitió |
| La ventana está en blanco | WebKit no puede componer: usa `WEBKIT_DISABLE_COMPOSITING_MODE=1` |

Esta comprobación encontró dos fallos reales durante el desarrollo, y por eso forma
parte de la rutina antes de cada release:

1. **UTF-16 detectado como binario.** La heurística de "densidad de bytes NUL" rechazaba
   los archivos UTF-16 (la mitad de sus bytes son `00`) antes de mirar el códec. Ahora
   la detección de encoding decide primero, y `is_binary()` respeta esa decisión.
2. **El botón `+` centrado.** La franja de pestañas usaba `flex: 1 1 auto` y el botón
   quedaba flotando en medio de la barra en vez de ir pegado a la última pestaña.
