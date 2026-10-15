# Inventario de funciones y estado real

Leyenda: ✅ implementado y probado · 🟡 parcial o con matices · ❌ no implementado (roadmap)

## Núcleo del editor

| Función | Estado | Detalle |
|---|---|---|
| Edición de texto plano con cursor, selección e IME nativos | ✅ | `<textarea>` real; nada de editores de juguete |
| Pestañas múltiples | ✅ | `Ctrl+N`, `Ctrl+T`, `Ctrl+W`, `Ctrl+Tab`, `Ctrl+1..9`, clic central para cerrar |
| Reordenar pestañas arrastrando | ✅ | Con indicador de inserción |
| Menú contextual de pestaña | ✅ | Close, Close others, Close right, Close saved, Copy full path, Open containing folder, Rename |
| Pestaña modificada | ✅ | Punto en lugar de la X; la X reaparece al pasar el ratón |
| Undo / Redo | ✅ | Pila propia con agrupación por tiempo (700 ms) para no deshacer letra a letra |
| Números de línea | ✅ | Exactos sin wrap; medidos con wrap activo |
| Resaltado de línea actual | ✅ | Banda sutil detrás del texto |
| Word wrap | ✅ | `Alt+Z`; el índice y la capa de resaltado se mantienen alineados |
| Zoom de fuente | ✅ | `Ctrl++`, `Ctrl+-`, `Ctrl+0`, indicador `100%` en la barra de estado |
| Tab = tabulación real | ✅ | Inserta un carácter de tabulación, no mueve el foco |
| Dirección del texto LTR/RTL | ✅ | `Ctrl+L` / `Ctrl+R`, en el menú contextual |
| Modo solo lectura | ✅ | Para archivos abiertos como binarios o de solo lectura en disco |

## Búsqueda y reemplazo

| Función | Estado | Detalle |
|---|---|---|
| Buscar | ✅ | `Ctrl+F`, tarjeta flotante igual que el original |
| Reemplazar / Reemplazar todo | ✅ | `Ctrl+H`, con contador de reemplazos |
| Match case | ✅ | Chip conmutador |
| Match whole word | ✅ | Respeta límites de palabra Unicode |
| Use regex | ✅ | Con aviso `Invalid regex` sin lanzar excepción |
| Siguiente / anterior | ✅ | `Enter`, `Shift+Enter`, `F3`, `Shift+F3`, flechas de la tarjeta |
| Resaltado de coincidencias | ✅ | Todas las coincidencias visibles; la activa en ámbar más intenso |
| Contador `n/total` | ✅ | Como en el original |
| Ir a línea | ✅ | `Ctrl+G` |

## Archivos y codificaciones

| Función | Estado | Detalle |
|---|---|---|
| Abrir y guardar | ✅ | `Ctrl+O`, `Ctrl+S`, `Ctrl+Shift+S`, `Ctrl+Alt+S` (guardar todo) |
| Detección automática de encoding | ✅ | BOM → UTF-8 estricto → heurística UTF-16 → ANSI |
| Reabrir con encoding | ✅ | Menú del indicador de la barra de estado |
| Guardar con otro encoding | ✅ | Idem |
| Codificaciones soportadas | ✅ | UTF-8, UTF-8 BOM, UTF-16 LE/BE, ASCII, Windows-1252 (ANSI), Windows-1251, ISO-8859-1, ISO-8859-15, KOI8-R |
| Finales de línea Windows/Unix/Macintosh | ✅ | Detección al abrir, conversión al guardar, indicador conmutable |
| Renombrar en disco | ✅ | `F2` |
| Recargar desde disco | ✅ | Detecta cambios externos y ofrece `Reload File From Disk` |
| Revertir todos los cambios | ✅ | Con confirmación |
| Archivos recientes | ✅ | Menú `Open Recent` + limpiar la lista |
| Detección de archivos binarios | ✅ | No los carga; ofrece abrirlos en solo lectura |
| Archivos grandes | 🟡 | Límite de 64 MB (frente a 1 MB del original) y aviso a partir de 8 MB; por encima de ~400 000 caracteres se desactiva la capa de resaltado para no gastar memoria |

## Ventanas, sesión y ajustes

| Función | Estado | Detalle |
|---|---|---|
| Multi-ventana | ✅ | `Ctrl+Shift+N`, bandeja del sistema |
| Instancia única + CLI | ✅ | `notepads archivo.txt` en una instancia ya abierta abre una pestaña |
| Snapshot de sesión | ✅ | Restaura pestañas (incluido texto sin guardar) al arrancar; omitir al salir |
| Aviso de guardado al cerrar | ✅ | Por pestaña y por ventana, con `Save all` / `Don't save` / `Cancel` |
| Ajustes persistentes | ✅ | `settings.json` en la carpeta de configuración |
| Tema claro / oscuro / sistema | ✅ | Con reacción en vivo al cambio de tema del escritorio |
| Color de acento | ✅ | Paleta, rueda de color y hex `#RRGGBB`, como el original |
| Opacidad del tinte de acrílico | ✅ | El ajuste existe y se guarda; requiere compositor RGBA para efecto real |
| Ajustes de tipografía | ✅ | Familia, tamaño, interlineado, ancho de tabulación |
| Barra de estado conmutable | ✅ | |
| Atajos documentados en la propia app | ✅ | Sección "About" de los ajustes |

## Extras del original

| Función | Estado | Detalle |
|---|---|---|
| Diff viewer lado a lado | ✅ | `Alt+D`, comparación contra la última versión guardada |
| Aviso de archivo modificado fuera de la app | ✅ | Pregunta antes de sobrescribir |
| Búsqueda web de la selección | ✅ | `Ctrl+E` (abre el navegador del sistema) |
| Impresión | ❌ | Roadmap. La vía limpia en Tauri es `window.print()` con una hoja de estilos de impresión |
| Split view de Markdown (`Alt+P`) | ❌ | Roadmap: renderizador Markdown local, sin dependencias de red |
| Entrada de tinta / handwriting | ❌ | Fuera de alcance (ver `REVERSE_ENGINEERING.md` §6) |
| Multi-ventana con arrastrar pestañas entre ventanas | 🟡 | Se pueden abrir ventanas nuevas, pero no arrastrar una pestaña de una a otra |

## Cosas que este port hace y el original no

* **Web demo de un solo archivo** (`npm run demo`): la app entera en un HTML
  autocontenido, útil para capturas, demos y para probar cambios sin compilar Rust.
* **Parámetros de URL** para forzar estados (`?theme=light&accent=%23b15782&find=foo`),
  que es lo que usan los tests visuales y las capturas de la documentación.
* **Cero telemetría** y **cero peticiones de red** salvo la búsqueda web que pidas.
* **CLI real**: `notepads-for-linux archivo1 archivo2` y `--new-window`.

## Deuda técnica conocida

* Los archivos binarios grandes se leen enteros en memoria antes de descartarse; habría
  que leer solo la cabecera para decidir.
* El diff es O(n·m) con guardia a 6000 líneas; por encima cae a una comparación
  línea a línea sin LCS.
* No hay resaltado de sintaxis en el editor (tampoco lo tiene el original); es una
  decisión consciente, no un olvido.
* La capa de resaltado se reconstruye entera en cada pulsación de tecla; con archivos
  de más de ~200 000 caracteres conviene pasar a un render por ventana visible.
