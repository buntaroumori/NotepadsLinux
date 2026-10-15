# Contribuir a Notepads for Linux

Gracias por pasarte. Este proyecto es un port de escritorio, así que la vara de medir es
simple: **que la ventana abra al instante y que el teclado nunca mienta.**

## Antes de nada

* Busca en los *issues* existentes; puede que ya esté reportado.
* Para bugs de la interfaz, adjunta la captura del estado roto **y** la URL que lo
  reproduce. Los parámetros de URL ayudan mucho:
  `index.html?theme=light&accent=%23b15782&find=hola&replace=1&wrap=1&settings=1`
* Di versión de distro, escritorio (X11 o Wayland) y si usas `npm run dev`, el paquete
  o el AppImage. En Linux eso suele ser la mitad del diagnóstico.

## Reglas del código

* **Idioma.** El código y los comentarios van en **inglés** (es un repositorio abierto);
  la documentación de `docs/` va en español. Los textos de la interfaz se quedan en
  inglés a propósito, para coincidir con el original que se está replicando.
* **Sin dependencias de frontend.** Nada de frameworks ni bundlers: módulos ES nativos,
  DOM a mano y `scripts/serve.mjs` como servidor. Un editor de texto no necesita 200 MB
  de `node_modules`.
* **Sin llamadas al sistema fuera de `bridge.js`.** Si necesitas algo del sistema
  operativo, añade un comando en `src-tauri/src/lib.rs` y expónlo en `bridge.js` con su
  versión de respaldo para el navegador.
* **Accesibilidad.** Todo botón nuevo necesita `aria-label` o texto, y foco visible.
* **Rendimiento.** `editor.js` se ejecuta en cada pulsación de tecla. Si tu cambio añade
  un `querySelectorAll` en el camino caliente, coméntalo en el PR o búscate otra vía.

## Flujo

```bash
git checkout -b fix/nombre-corto
npm test                                   # debe pasar
cargo test --manifest-path src-tauri/Cargo.toml
npm run lint                               # cargo fmt --check + clippy -D warnings
```

Si tocas `editor.js`, `diff.js` o los códecs de Rust, **añade un test**. Los tests
existentes están en `tests/smoke.test.mjs` (jsdom) y en el módulo `tests` de
`src-tauri/src/lib.rs`.

## Ideas donde hace falta ayuda

* Previsualización Markdown en split view (`Alt+P`) sin dependencias de red.
* Impresión con CSS de impresión propio.
* Arrastrar pestañas entre ventanas.
* Traducción de la interfaz: el original está en 25 idiomas, este port solo en inglés.
* Empaquetado para Flatpak y Snap.
* Soporte de `xdg-desktop-portal` para el selector de color de acento del sistema.

## Importante

No mandes PRs que copien código de otros editores. Este proyecto se construyó a partir
de especificaciones y medidas, y queremos que siga siendo así.
