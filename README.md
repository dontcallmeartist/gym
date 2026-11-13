# Gym – mi app de registro de entrenos

App sencilla para apuntar los entrenamientos desde el iPhone. Funciona sin
conexión y guarda una copia de todo en una hoja de Google Sheets tuya.

- **Entrenar**: muestra el día que toca, lo que hiciste la última vez y una
  sugerencia para progresar. Marcas ✓ en cada serie y al final «Terminar entreno».
- **Historial**: cada ejercicio con sus sesiones y una gráfica semanal.
- **Rutinas**: crear, editar, duplicar y archivar rutinas; catálogo de ejercicios
  (renombrar, fusionar duplicados, archivar).
- **Ajustes**: conexión con Google, sincronizar, restaurar y exportar a Excel.

> Viene con una **rutina de ejemplo** para que pruebes todo. Puedes editarla o
> crear la tuya (la de ejemplo quedará archivada).

---

## 1. Crear la hoja de Google y el script (una sola vez, ~5 minutos)

Hazlo desde un ordenador.

1. Entra en [sheets.google.com](https://sheets.google.com) y crea una **hoja en
   blanco**. Ponle de nombre, por ejemplo, `Gym`.
2. En el menú: **Extensiones → Apps Script**. Se abre una pestaña nueva con un
   editor de código.
3. Borra todo lo que aparece y **pega el contenido entero** del archivo
   [`Code.gs`](Code.gs) de este proyecto.
4. En la línea que dice `const CLAVE_SECRETA = 'CAMBIA_ESTA_CLAVE';` cambia
   `CAMBIA_ESTA_CLAVE` por una **clave inventada por ti** (por ejemplo
   `pesas-Rojo-2027`). Sin espacios. Apúntala: la necesitarás en el móvil.
5. Pulsa el icono de **guardar** (💾).
6. Arriba a la derecha: **Implementar → Nueva implementación**.
   - En «Seleccionar tipo» (⚙) elige **Aplicación web**.
   - **Ejecutar como:** *Yo*.
   - **Quién tiene acceso:** *Cualquier usuario*.
   - Pulsa **Implementar**.
7. Google te pedirá **autorizar el acceso**: elige tu cuenta → si aparece
   «Google no ha verificado esta aplicación», pulsa **Configuración avanzada →
   Ir a … (no seguro)** → **Permitir**. Es normal: el script es tuyo y solo
   toca esta hoja.
8. Copia la **URL de la aplicación web** (termina en `/exec`). Junto con la
   clave, es lo que pondrás en la app.

> «Cualquier usuario» significa que la URL acepta peticiones, pero sin la clave
> secreta el script no lee ni escribe nada. No compartas la URL ni la clave.

Si algún día cambias el código del script: **Implementar → Gestionar
implementaciones → ✏ → Versión: Nueva versión → Implementar** (así la URL no
cambia).

## 2. Publicar la app en GitHub Pages (una sola vez)

1. Entra en [github.com](https://github.com) con tu cuenta → botón **New**
   (nuevo repositorio).
2. Nombre: por ejemplo `gym`. Márcalo como **Public** → **Create repository**.
3. En la página del repositorio: **Add file → Upload files** y arrastra
   todos los archivos de esta carpeta (`index.html`, `app.js`, `styles.css`,
   `manifest.json`, `service-worker.js`, la carpeta `icons`, etc.) →
   **Commit changes**.
4. Ve a **Settings → Pages**. En «Branch» elige **main** y la carpeta
   **/ (root)** → **Save**.
5. Espera 1–2 minutos. La dirección de tu app será
   `https://TU-USUARIO.github.io/gym/`.

> El repositorio es público, pero en el código **no hay ningún dato tuyo**: la
> URL del script y la clave solo se guardan dentro de tu iPhone.

## 3. Instalar la app en el iPhone

1. Abre la dirección de tu app en **Safari** (tiene que ser Safari).
2. Pulsa el botón **Compartir** (cuadrado con flecha hacia arriba).
3. Elige **Añadir a pantalla de inicio** (si no lo ves, desliza la lista hacia
   abajo). Comprueba que «Abrir como app web» está activado → **Añadir**.
4. Abre la app desde el icono de la pesa. Se abre a pantalla completa y
   funciona aunque no tengas cobertura.

## 4. Conectar la app con tu hoja de Google

1. En la app, ve a **Ajustes**.
2. Pega la **URL del script** (la que termina en `/exec`) y escribe la
   **clave secreta**.
   *Truco:* envíate la URL a ti mismo (Notas, WhatsApp, correo…) y cópiala
   desde el iPhone.
3. Pulsa **Probar conexión**. Debe aparecer «Conexión correcta ✓».
4. Listo. A partir de ahora:
   - Cada vez que pulses **Terminar entreno**, se envía a la hoja.
   - Si no hay cobertura, queda **pendiente** y se envía sola al recuperar la
     conexión o al abrir la app.
   - En Ajustes verás «Todo sincronizado», «X sesiones pendientes» o el error.
   - Si pasan más de 7 días sin copia, la app te avisa arriba.

### Qué verás en la hoja

| Pestaña | Contenido |
|---|---|
| **Registros** | Una fila por serie: fecha, rutina, día, ejercicio, serie, peso, reps, nota… |
| **Ejercicios** | Tu catálogo de ejercicios |
| **Rutinas** | Tus rutinas (activa y archivadas) con días, ejercicios y objetivos |
| **Progreso** | Resumen por ejercicio y semana: peso máximo y volumen (peso × reps). Ideal para hacer una gráfica: selecciona las columnas → Insertar → Gráfico |

No cambies el nombre ni el orden de las columnas de estas pestañas. Sí puedes
añadir pestañas o gráficas tuyas.

## 5. Cambiar de móvil o si se borran los datos de Safari

1. Instala la app en el móvil nuevo (paso 3).
2. En **Ajustes**, pon la URL y la clave y pulsa **Probar conexión**.
3. Pulsa **Restaurar desde Google**. Se reconstruye todo: ejercicios,
   rutinas e historial.

## 6. Copia extra en Excel

En **Ajustes → Exportar CSV** se genera un archivo que se abre directamente
con Excel en español (columnas separadas, decimales con coma, acentos bien).
En el iPhone aparece el menú de compartir: guárdalo en Archivos, mándalo por
correo, etc.

## 7. Pedir cambios en el futuro

Abre Claude Code en la carpeta `C:\AI\projects\gym-tracker` y pide el cambio con
tus palabras, por ejemplo:

> «En la app del gimnasio quiero poder apuntar el tiempo de descanso entre series.»

La especificación completa está en [`SPEC.md`](SPEC.md); conviene que el cambio
quede también anotado allí. Tras publicar una versión nueva, la app del iPhone
se actualiza sola la siguiente vez que la abras con conexión (si no, ciérrala
del todo y vuelve a abrirla).

---

## Para quien mantenga el código

- Sin frameworks ni compilación: `index.html`, `styles.css`, `app.js`,
  `manifest.json`, `service-worker.js`, `icons/`. `Code.gs` va en Apps Script.
- Datos en IndexedDB (base `gym`): `exercises`, `routines`, `sessions`, `sets`,
  `deletions` (borrados pendientes de enviar) y `meta` (ajustes, última sync).
- Al publicar cambios, sube `VERSION` en `service-worker.js` para que los
  móviles descarguen la versión nueva.
- Sincronización: POST `text/plain` con JSON (evita la petición OPTIONS que
  Apps Script no admite). Acciones `ping`, `sync` (upsert por id) y `restore`.
- `tests/`: pruebas automáticas con Chrome. `cd tests && npm install`, arrancar `tools/serve.mjs` y
  `tools/mock-apps-script.mjs 8090 clave-de-prueba`, y luego `npm test`.
- `tools/`: utilidades solo para desarrollo (no las usa la app):
  - `node tools/serve.mjs` → sirve la app en http://localhost:8080
  - `node tools/mock-apps-script.mjs 8090 clave` → ejecuta el `Code.gs` real con
    una hoja simulada (URL `http://localhost:8090/exec`), para probar sin Google.
  - `./tools/make-icons.ps1` (PowerShell) → genera los iconos a partir de `icons/icono_gimnasio_1024.png`.
  - `node tools/cargar-rutina.mjs <rutina.json> [--probar]` → carga una rutina en la hoja (reutiliza
    ejercicios por nombre y archiva la anterior). `node tools/borrar-rutina.mjs "<nombre>"` → borra una
    rutina archivada sin entrenos. Leen la URL y la clave de `.private/conexion.txt` (no está en el repo).
- Fechas en la hoja: se guardan a las 12:00 UTC y se leen en UTC (evita desfases de un día entre zonas horarias).
