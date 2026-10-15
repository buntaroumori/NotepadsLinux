# Material de referencia del original

Copias locales de las fuentes públicas sobre las que se hizo la ingeniería inversa,
guardadas para que cualquiera pueda **reproducir las medidas** de
`docs/REVERSE_ENGINEERING.md` sin depender de que el repositorio original siga en pie.

| Archivo | Origen | Para qué se usó |
|---|---|---|
| `original-notepads-dark.png` | `ScreenShots/1.png` | Color y geometría del tema oscuro |
| `original-notepads-light-settings.png` | `ScreenShots/4.png` | Tema claro y panel *Personalization* (opacidad 90 %, rueda de color, hex) |
| `original-notepads-diff.png` | `ScreenShots/3.png` | Estructura del visor de diferencias |
| `original-Resources.en-US.resw` | `src/Notepads/Strings/en-US/Resources.resw` | Textos literales de la interfaz |
| `original-LICENSE.txt` | `LICENSE.txt` | Licencia MIT del original (© 2019-2024 Jackie (Jiaqi) Liu) |

Todo ello proviene de <https://github.com/0x7c13/Notepads> y se conserva aquí bajo su
licencia MIT original, únicamente como documentación de referencia. Las capturas **no** son de este port: las de este port, tomadas ejecutando
`src-tauri/target/debug/notepads-for-linux` sobre un X virtual, están en
`docs/screenshots/` (`native-linux-xvfb.png`, `native-windows1252-decoding.png`).
