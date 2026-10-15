# Ingeniería inversa de Notepads → port a Linux

Este documento es la **especificación** sobre la que se ha construido *Notepads for
Linux*. No es un resumen del README del original: es el registro de qué se observó,
cómo se midió, y cómo cada hallazgo se tradujo en código para Linux.

> Aviso legal, para que quede claro desde el principio: el proyecto original
> **Notepads** de Jackie (Jiaqi) Liu está publicado bajo **licencia MIT**. Este port
> es una reimplementación limpia (*clean-room*) escrita desde cero en Rust + HTML/CSS/JS.
> **No se ha copiado ni una línea de código C#/XAML**, entre otras cosas porque sería
> inútil: el original es UWP y este es Tauri + WebKitGTK. Lo que sí se ha hecho es
> estudiar su *comportamiento* y su *diseño visual* como documentación pública, que es
> exactamente lo que la MIT permite y lo que hace que un port tenga sentido. Ver
> `NOTICE` para la atribución completa.

---

## 1. Método

El original es una app UWP: código C# + XAML, cerrada a la inspección de binarios de
forma razonable y, sobre todo, **imposible de ejecutar en Linux**. Así que "ingeniería
inversa" aquí significa trabajar sobre cuatro fuentes públicas y verificables:

| Fuente | Qué se extrae de ella |
|---|---|
| `github.com/0x7c13/Notepads` (README) | Lista de funciones, atajos de teclado, limitaciones declaradas de la plataforma UWP |
| `src/Notepads/Strings/en-US/Resources.resw` | **El texto literal de la interfaz**: etiquetas de menús, botones, diálogos, indicadores. Es la fuente de verdad para nombrar cosas igual |
| `ScreenShots/1..4.png` (1240×950) | La geometría y los colores reales de la UI, medidos píxel a píxel |
| `LICENSE.txt` | MIT, con lo que la reutilización de nombres de UI y el estudio son legítimos |

Todo lo que aparece en este documento está por tanto trazado a una de esas fuentes.

---

## 2. Forense visual: medidas y colores medidos

Las capturas del original `1.png` (oscuro) y `4.png` (claro) tienen un borde de
**30 px** alrededor de una ventana de **1180×890**. Tomando como origen `(30, 30)`,
medí perfiles verticales y horizontales con un muestreo de color y así salieron las
constantes que usa `src/styles.css`:

### Geometría

| Elemento | Medida observada | Dónde se usa |
|---|---|---|
| Barra de pestañas (alto total) | 32 px | `--titlebar-h: 32px` |
| Pestaña individual | 26 px de alto | `--tab-h: 26px` |
| Barra de estado | 27 px de alto | `--statusbar-h: 27px` |
| Botón hamburguesa | ~32×26 px, pegado a la izquierda | `.menu-btn` |
| Ancho mínimo de pestaña | ~104 px (medido entre x=33 y x=265 para dos pestañas) | `.tab { min-width: 104px }` |
| Icono de pestaña | 16 px, separado ~8 px del título | `.tab-icon` |
| Riel de ajustes | 48 px, **a la derecha** | `--settings-rail-w: 48px`, `.settings-rail { order: 2 }` |
| Área del documento (claro) | x=30..1203 → 1173 px → ~234 px de índice de 0.19 | `.gutter`, `--editor-pad-x` |

### Color (medido, no inventado)

Modo oscuro (`1.png`), muestreando zonas grandes para evitar el ruido del antialiasing:

| Zona | Valor medido | Token en el CSS |
|---|---|---|
| Fondo del editor | `#1F2225` (100 % acrílico sobre negro) | `--bg-editor: #1f2225` |
| Franja de pestañas | `#323A3E` → `#292F31` | `--bg-strip: linear-gradient(180deg, #323a3e, #2b3236, #262b2e)` |
| Pestaña activa | `#2F3231` | `--bg-tab-active: #2f3231` |
| Pestaña inactiva | `#3C4446` | `--bg-tab-inactive: #3c4446` |
| Barra de estado | `#2C3338` con borde `#242A2E` | `--bg-statusbar` + `border-top` |
| Menú contextual | `#202022` | `--bg-flyout: #2b2b2b` (el original es más oscuro porque va sobre acrílico opaco) |
| Tarjeta de Find/Replace | `#1F2020` | `--bg-card: #1f2020` |
| Texto del editor | `#E9E9E9` | `--fg: #e9e9e9` |
| Indicador "Modified" | rojo `#B13B41` | `--warn` |

Modo claro (`4.png`):

| Zona | Valor medido | Token |
|---|---|---|
| Fondo del editor | `#F5F5F5` | `--bg-editor: #f5f5f5` |
| Franja de pestañas | `#E3E7E8` → `#D8DCDE` | `--bg-strip` |
| Pestaña activa | `#EBEDED` | `--bg-tab-active` |
| Pestaña inactiva | `#E8ECED` | `--bg-tab-inactive` |
| Barra de estado | `#DFE3E6` con borde `#D6D8DC` | `--bg-statusbar` |
| Texto del editor | `#1B1B1B` | `--fg: #1b1b1b` |
| Acento del usuario (en esa captura) | `#B15782` | `--accent` (configurable) |

**Comprobación cruzada:** en las capturas generadas por este port los mismos píxeles
dan `#1F2225`/`#E9E9E9` (oscuro) y `#F5F5F5`/`#1B1B1B` (claro). Ver
`docs/screenshots/`.

### Un hallazgo que corrige una suposición habitual

Leyendo el panel de ajustes (`4.png`) se ve que la opacidad de acrílico por defecto
es **90 %**, y que la ventana sigue siendo opaca. Es decir: en el original,
`BackgroundTintOpacity` **no** altera la transparencia de la ventana, solo el tinte
del material. Por eso en este port el ajuste se llama igual, se guarda igual, y el
control que sí hace algo en Linux ("Transparent window") está separado y marcado como
"Requires restart".

---

## 3. Inventario de la interfaz (textos literales)

Extraído de `Resources.resw`. Se usa el mismo texto para que la memoria muscular y las
búsquedas en Google ("how to X in notepads") sigan funcionando:

**Menú principal**
`New`, `New Window`, `Open`, `Open Recent`, `Save`, `Save As`, `Save All`, `Print`,
`Settings`, `Find`, `Replace`, `Revert All Changes`, `Close Tab`, `Close Window`.

**Menú contextual del editor**
`Cut`, `Copy`, `Paste`, `Undo`, `Redo`, `Select All`, `Right-to-Left Reading order`,
`Word Wrap`, `Search in web`, `Toggle Preview`, `Share Selected`,
`Reload File From Disk`, `Preview Text Changes`.

**Menú contextual de la pestaña**
`Rename`, `Close`, `Close Others`, `Close Right`, `Close Saved`,
`Copy Full Path`, `Open Containing Folder`.

**Barra de estado (de izquierda a derecha)** — el orden importa, y es el que replica
este port:
1. ruta completa del archivo (izquierda, truncada con elipsis)
2. `Modified` en rojo cuando hay cambios sin guardar
3. `Ln 49, Col 1 (66 selected)` — con el singular/plural real
   (`LineColumnIndicator_FullText_SingularSelectedWord` / `..._PluralSelectedWord`)
4. `100%` — zoom de fuente, con flyout `Zoom in` / `Zoom out` / `Restore default zoom`
5. `Windows (CRLF)` — finales de línea
6. `UTF-8` — encoding, con flyout `Auto guess encoding`, `Reopen with encoding`,
   `Save with encoding` y la lista de codificaciones

**Diálogos y avisos**
`Save your changes?`, `File modified outside of Notepads` (con
`Reload File From Disk`), `Encoding cannot be determined`,
`Reopen with encoding`, `Rename file`, `Session snapshot corrupted`.

**Find & Replace**
`Find` / `Replace` como *placeholder*, opciones `Match case`, `Match whole word`,
`Use regex`, mensajes `No results` e `Invalid regex`, botones replace / replace all,
navegación arriba/abajo y un botón `...` que despliega las opciones.

---

## 4. Atajos de teclado (del README del original)

| Atajo | Acción | Estado en el port |
|---|---|---|
| `Ctrl+N` / `Ctrl+T` | Nueva pestaña | ✅ |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Pestaña siguiente / anterior | ✅ |
| `Ctrl+1..9` | Ir a la pestaña N | ✅ |
| `Ctrl++` / `Ctrl+-` / `Ctrl+0` | Zoom / restaurar | ✅ (zoom propio, escala 100 % = 13 px) |
| `Ctrl+L` / `Ctrl+R` | Dirección del texto LTR/RTL | ✅ |
| `Alt+P` | Split view de previsualización Markdown | 🟡 declarado, no implementado (ver roadmap) |
| `Alt+D` | Diff viewer lado a lado | ✅ |
| `Alt+Z` | Word wrap | ✅ |
| `F3` / `Shift+F3` | Buscar siguiente / anterior | ✅ (añadido, coherente con el original) |
| `Ctrl+E` | Buscar la selección en la web | ✅ |

Añadidos propios de Linux (no existen en el original, pero se esperan en el escritorio
de Linux): `Ctrl+,` para ajustes, `Ctrl+Shift+N` nueva ventana, `F2` renombrar,
`Ctrl+0..9`, cierre de pestaña con clic central, arrastrar y soltar archivos, y
reordenar pestañas arrastrando.

---

## 5. De función original a implementación en Linux

| Función del original | Cómo se implementa aquí | Archivo |
|---|---|---|
| Tab system de WinUI | Modelo de pestañas propio + `EditorView` que hace `load()`/`save()` del estado por documento, con cierre por clic central, drag-reorder y menú contextual | `src/app.js`, `src/editor.js` |
| Editor `RichEditBox` + `Win2D` | `<textarea>` nativo (cursor, selección, IME, scroll nativos) + **capa espejo** ("backdrop") para resaltar coincidencias y la línea actual | `src/editor.js` |
| Números de línea | Aritmética exacta (`y = pad + línea * lineHeight`) cuando no hay wrap; medida real de bloques cuando hay wrap | `src/editor.js#renderGutter` |
| Encoding (UTF-unknown) | Detección de BOM → UTF-8 estricto → heurística UTF-16 → Windows-1252; códecs manuales para 1252/1251/KOI8-R/ISO-8859-1/15 | `src-tauri/src/lib.rs` |
| Line endings (CRLF/LF/CR) | Se normaliza **a LF en memoria** y se expande al guardar, así el buffer y el undo no arrastran `\r` | `src-tauri/src/lib.rs#normalize_line_endings` |
| Diff viewer (DiffPlex) | Diff por líneas con LCS propio, vista lado a lado con bandas verde/rojo y contador `+n / -n` | `src/diff.js`, `.diff-view` |
| Session snapshot | `session.json` con ventanas → pestañas → rutas, más el texto de los documentos sin guardar; solo se restauran rutas que siguen existiendo | `src-tauri/src/lib.rs#restore_session`, `src/app.js#saveSession` |
| Multi-instancia + CLI | `tauri-plugin-single-instance`: una segunda ejecución de `notepads archivo.txt` inyecta el archivo en la ventana en curso vía evento | `src-tauri/src/lib.rs` |
| Acrílico y Tema | Variables CSS por tema + `transparent(true)` opcional + opacidad de tinte, que en Linux exige compositor con RGBA | `src/styles.css`, `create_window` |
| Aceleradores WinUI | Tabla de atajos propia que intercepta en captura y respeta el `readOnly` del buffer | `src/app.js#handleShortcut` |
| Iconos *Codicons* | Set propio de 16 px (`stroke: currentColor`) inspirado en Codicons, definido como trazados SVG | `src/icons.js` |

---

## 6. Diferencias inevitables (y decisiones tomadas)

1. **Handwriting / Ink.** El original soporta entrada de tinta multi-línea con
   `InkCanvas` + reconocimiento de escritura de Windows. En Linux no hay API de tinta
   equivalente y portable. Decisión: fuera del alcance, documentado en el roadmap. La
   vía razonable sería `libinput` + un motor de reconocimiento en línea, que no aporta
   valor suficiente para el coste.
2. **Integración shell UWP.** Las limitaciones que el README declara (no poder guardar
   en carpetas del sistema, límite de 1 MB) **son restricciones de UWP**, no del
   diseño. Aquí desaparecen: se escribe donde el usuario tenga permiso y el límite sube
   a 64 MB de lectura (con aviso a partir de 8 MB).
3. **Telemetría.** El original usa AppCenter. Aquí es **cero**: no hay red de salida
   salvo la búsqueda web explícita que pide el usuario (`Ctrl+E`), que abre el
   navegador. Es una mejora, no una carencia.
4. **Ajustes del sistema.** "Use my Windows accent color" se traduce a leer el acento
   de GTK/portal cuando se puede; el resto del tiempo el usuario elige un color, y el
   panel ofrece la misma rueda de color + hex `#RRGGBB` que el original.
5. **Fonts.** El original envía Segoe UI Variable y Cascadia Code. Aquí no se empaqueta
   ninguna fuente: la UI pide `Segoe UI Variable → Inter → Cantarell → Noto Sans` y el
   editor pide `Cascadia Mono → Consolas → JetBrains Mono → DejaVu Sans Mono`, con lo
   que cada distro usa lo mejor que tenga instalado sin aumentar el tamaño del paquete.

---

## 7. Cómo verificar que el port hace lo que dice

```bash
# Comportamiento del editor y del shell (jsdom, sin navegador)
npm test

# Códecs de encoding y finales de línea (Rust puro)
cargo test --manifest-path src-tauri/Cargo.toml

# Y a ojo: los mismos estados están capturados en docs/screenshots/
#   dark-theme.png, light-theme-accent.png, find-and-replace.png,
#   settings-personalization.png, diff-viewer.png
```

Los tests cubren justo lo que es fácil romper sin darse cuenta: LCS del diff,
redondeo de `Ln/Col`, búsqueda con regex/whole word/match case, ida y vuelta de cada
encoding (incluido el cirílico), normalización CRLF/LF y el snapshot de sesión.
