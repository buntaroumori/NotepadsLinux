# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versionado [SemVer](https://semver.org/lang/es/).

## [1.0.0] — 2026-10-15

Primera versión estable del port a Linux. El alcance es el **núcleo del editor** del
Notepads original, replicado con la misma estructura de interfaz, y el backend nativo
completo para Linux.

### Añadido

**Editor**
- Sistema de pestañas completo: nueva, cerrar, cambiar (`Ctrl+Tab`, `Ctrl+1..9`), cerrar
  con clic central, reordenar arrastrando, menú contextual por pestaña.
- Superficie de edición sobre `<textarea>` nativo con capa espejo para resaltados y
  banda de línea actual.
- Números de línea exactos en ambos modos (con y sin *word wrap*).
- Undo/redo con agrupación temporal, zoom de fuente (`Ctrl++`/`Ctrl+-`/`Ctrl+0`),
  tabulación real, dirección LTR/RTL.

**Buscar y reemplazar**
- Tarjeta flotante con buscar, reemplazar y reemplazar todo.
- Opciones *Match case*, *Match whole word* y *Use regex*, con aviso de regex inválida.
- Resaltado de todas las coincidencias, contador `n/total`, navegación con `F3`.

**Archivos**
- Detección automática de encoding y códecs UTF-8, UTF-8 BOM, UTF-16 LE/BE, ASCII,
  Windows-1252, Windows-1251, ISO-8859-1, ISO-8859-15 y KOI8-R, con conversión en ambos
  sentidos y `Reopen with encoding` / `Save with encoding`.
- Finales de línea CRLF, LF y CR con detección y conversión al guardar.
- Detección de cambios externos con oferta de recarga, revertir cambios, renombrar (`F2`),
  archivos recientes, aviso de archivo binario.
- Diálogos propios de guardado («Save your changes?» con Guardar / No guardar / Cancelar).

**Escritorio**
- Tema claro, oscuro y sistema, color de acento con paleta, rueda y hex, opacidad del
  tinte de acrílico y ventana transparente opcional.
- Snapshot de sesión con restauración de pestañas y de texto sin guardar.
- Multi-ventana, instancia única, CLI con rutas, bandeja del sistema (opcional).
- Ajustes persistentes en `settings.json`.

**Extras**
- Visor de diferencias lado a lado (`Alt+D`) con diff por líneas LCS propio.
- Arrastrar y soltar archivos sobre la ventana, con indicador visual.
- Demo de un solo archivo HTML (`npm run demo`) y parámetros de URL para forzar estados.
- `scripts/install.sh` para instalar/desinstalar por usuario o en `/usr/local`.
- Salida de empaquetado `.deb`, `.rpm` y `.AppImage` vía Tauri.

### Documentación
- `docs/REVERSE_ENGINEERING.md`: método, fuentes, medidas en píxeles y tabla de
  trazabilidad función original → implementación.
- `docs/FEATURES.md`: inventario con estado real, incluido lo no implementado.
- `docs/BUILD.md`: dependencias por distro, empaquetado, AUR, CLI y problemas conocidos.
- `NOTICE`: atribución y licencias.

### Notas
- No incluye: entrada de tinta (*handwriting*), previsualización Markdown en split view
  e impresión. Ver el roadmap en `README.md`.
- El original declara un límite de 1 MB por archivo por restricciones de UWP; aquí el
  límite es de 64 MB con aviso a partir de 8 MB.

### Correcciones (encontradas por los propios tests durante el desarrollo)
- Codificador Windows-1252: la banda alta (0xA0–0xFF) no se mapeaba y los caracteres
  acentuados se escribían como `?`.
- ISO-8859-15: ocho posiciones cedidas a otros glifos se colaban por el *fallback*
  Latin-1 y producían bytes incorrectos.
- `doReplace` no existía: el botón de reemplazar del panel lanzaba un `ReferenceError`.
- Los archivos UTF-16 se rechazaban como binarios: la heurística de bytes NUL se
  aplicaba antes de mirar el códec. Detectado ejecutando el binario nativo bajo Xvfb.
- El botón `+` de nueva pestaña aparecía centrado en la barra en lugar de ir pegado a
  la última pestaña (la franja de pestañas crecía en vez de encogerse).

[1.0.0]: https://github.com/TU_USUARIO/TU_REPO/releases/tag/v1.0.0
