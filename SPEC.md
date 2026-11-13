# Proyecto: App personal de registro de gimnasio (PWA + Google Sheets)

## Contexto
Soy un usuario sin experiencia en programación. Quiero una app muy sencilla para
registrar mis entrenamientos de gimnasio desde mi iPhone. He probado apps de las
tiendas y no me gustan: quiero algo poco más ordenado que un bloc de notas, pero
no mucho más complicado. Toda la interfaz debe estar en español y usar kg.

Antes de escribir código: guarda esta especificación como `SPEC.md` en el
repositorio, propón un plan breve por fases y espera mi confirmación. Después
construye fase a fase, comprobando que cada una funciona antes de seguir.
No añadas funciones que no estén aquí sin preguntarme.

## Arquitectura decidida
- **Web app instalable (PWA)**, no app nativa. Se instalará en el iPhone desde
  Safari con "Compartir → Añadir a pantalla de inicio" y debe abrirse a pantalla
  completa, con icono propio.
- **HTML, CSS y JavaScript sin frameworks ni paso de compilación.** Pocos
  archivos: `index.html`, `app.js`, `styles.css`, `manifest.json`,
  `service-worker.js` e iconos. Sin dependencias externas salvo que sea
  imprescindible (las gráficas se pueden dibujar con SVG o canvas propio).
- **Funciona sin conexión** gracias al service worker (en el gimnasio puede no
  haber cobertura).
- **Datos locales en IndexedDB.** Solicitar almacenamiento persistente con
  `navigator.storage.persist()`.
- **Copia de seguridad y fuente de verdad en Google Sheets**, a través de un
  script de Google Apps Script en mi propia hoja de cálculo (detalles abajo).
- **Alojamiento gratuito en GitHub Pages** (repositorio público). Por eso
  NUNCA debe haber datos personales, URLs privadas ni claves en el código: la URL
  del script y la clave secreta se introducen una sola vez en la pantalla de
  Ajustes de la app y se guardan solo en el dispositivo.
- Incluir las meta etiquetas necesarias para iOS (apple-mobile-web-app-capable,
  apple-touch-icon, theme-color, etc.). Verifica el soporte actual de PWA en
  iOS Safari antes de implementarlo.

## Modelo de datos
Usar IDs internos estables (UUID) para todo; los nombres solo se muestran.

1. **Ejercicios (catálogo):** id, nombre, notas opcionales, archivado (sí/no).
   - Al crear una rutina, los ejercicios se ELIGEN del catálogo (con opción de
     crear uno nuevo); nunca se escriben a mano en cada rutina. Así el
     historial no se fragmenta por nombres escritos distinto.
   - Opción "Renombrar" (cambia el nombre en todo el historial, porque el id no
     cambia) y opción "Fusionar" dos ejercicios duplicados.
2. **Rutinas:** id, nombre, fecha de inicio, fecha de fin (vacía si es la
   activa), lista de días.
   - Cada día: nombre (p. ej. "Día 1 – Pierna"), día de la semana opcional y
     lista ordenada de ejercicios con series objetivo, rango de repeticiones
     objetivo (p. ej. 8–12) e incremento de peso propio (por defecto 2,5 kg).
   - Solo una rutina activa a la vez. Al crear una nueva, la anterior se
     archiva (consultable, no editable).
3. **Sesiones:** id, fecha, rutina, día, estado (en curso / terminada),
   sincronizada (sí/no).
4. **Series registradas:** id, sesión, ejercicio, número de serie, peso (kg,
   admite decimales y 0 para peso corporal), repeticiones, nota opcional.

**Regla clave:** el historial y la progresión van ligados al EJERCICIO, no a
la rutina. Si una rutina nueva reutiliza ejercicios de la anterior, conservan
todo su historial; los ejercicios nuevos empiezan de cero.

## Funcionalidades
### Entrenar (pantalla principal)
- Muestra el día que toca hoy (según el día de la semana asignado, o el
  siguiente en orden respecto al último entrenado) y permite elegir otro.
- Para cada ejercicio: nombre, objetivo (series × reps) y, muy visible, lo que
  hice la última vez (peso y reps de cada serie, con su fecha).
- Al entrar, los campos vienen prerrellenados con lo de la última vez (o con la
  sugerencia de progresión) para apuntar con el mínimo de toques.
- Botones grandes, fáciles de pulsar con los dedos sudados; teclado numérico
  para peso y reps.
- Botón "Terminar entreno" que cierra la sesión y lanza la sincronización.
- Si cierro la app a medias, la sesión en curso no se pierde.

### Progresión (doble progresión)
- Si en la última sesión completé las repeticiones máximas del rango en TODAS
  las series → sugerir subir el peso con el incremento del ejercicio.
- Si no → sugerir el mismo peso e intentar más repeticiones.
- Mostrar la sugerencia como un indicador discreto (p. ej. "↑ Sube a 62,5 kg"),
  nunca obligatoria.

### Historial y gráfica
- Por ejercicio: lista de sesiones pasadas y una gráfica sencilla semana a
  semana (peso máximo y, opcional, volumen total = peso × reps). Debe
  funcionar con años de datos sin volverse lenta.

### Rutinas
- Crear, editar la activa, duplicar una antigua como base para la nueva,
  archivar.

### Ajustes y copias
- Configurar la URL del script de Google y la clave secreta, con un botón
  "Probar conexión".
- Indicador de estado: todo sincronizado / X sesiones pendientes / error.
- Botón "Sincronizar ahora".
- Botón "Restaurar desde Google": reconstruye TODO (catálogo, rutinas e
  historial) leyendo la hoja. Pensado para cambio de móvil o borrado de Safari.
- Botón "Exportar CSV" (compatible con Excel en español: separador `;`,
  decimales con coma, UTF-8 con BOM) como copia manual extra.

## Sincronización con Google Sheets (Google Apps Script)
- Entregar el código `.gs` para pegar en *Extensiones → Apps Script* de una
  hoja de Google nueva, desplegado como *Aplicación web* (ejecutar como yo,
  acceso: cualquiera), protegido con una clave secreta que yo defino y que se
  comprueba en cada petición.
- Pestañas que crea y mantiene el script automáticamente:
  - `Registros`: una fila por serie → id_serie, fecha, rutina, día,
    ejercicio_id, ejercicio, serie, peso, reps, nota, id_sesion.
  - `Ejercicios`: catálogo.
  - `Rutinas`: rutinas activas y archivadas con sus días y objetivos (en un
    formato que se pueda leer y también reconstruir).
  - `Progreso`: resumen por ejercicio y semana (peso máximo y volumen),
    generado con fórmulas o por el script, listo para hacer una gráfica
    sencilla en Sheets o Excel.
- Formato legible para una persona: aunque la app dejara de existir, los datos
  deben entenderse solo mirando la hoja.
- **Sin duplicados:** las escrituras usan el id de cada serie (upsert); si
  edito una sesión pasada, se actualiza la fila correspondiente.
- **Cola offline:** si no hay conexión al terminar, la sesión queda pendiente
  y se envía automáticamente al recuperar la conexión o al abrir la app.
- Tener en cuenta las limitaciones de CORS de Apps Script (por ejemplo, enviar
  con `Content-Type: text/plain` para evitar la petición previa OPTIONS) y
  documentarlo en el código.
- Además, si han pasado más de 7 días sin sincronizar, la app debe avisarme.

## Diseño
- Minimalista, móvil primero, modo oscuro automático según el sistema.
- Tipografía legible, poco texto, nada de pantallas recargadas.
- Navegación con 3–4 pestañas abajo: Entrenar · Historial · Rutinas · Ajustes.
- Las imágenes de ejercicios NO son necesarias.

## Entregables
1. El código completo de la app en el repositorio.
2. El archivo `Code.gs` del script de Google.
3. Un `README.md` en español, paso a paso y para alguien sin conocimientos
   técnicos, que explique:
   - crear la hoja de Google y pegar/desplegar el script;
   - crear el repositorio y activar GitHub Pages;
   - instalar la app en el iPhone desde Safari;
   - configurar la conexión en Ajustes y probarla;
   - restaurar los datos en un móvil nuevo;
   - cómo pedirte cambios en el futuro.
4. Una rutina de ejemplo precargada (editable desde la app) para poder probar
   todo antes de introducir la mía.

## Pruebas antes de dar el trabajo por terminado
- Registrar una sesión completa sin conexión y comprobar que se sincroniza al
  volver la conexión, sin duplicados.
- Borrar los datos locales y restaurar desde Google: todo debe volver igual.
- Cambiar de rutina conservando dos ejercicios y comprobar que mantienen su
  historial y su sugerencia de progresión.
- Renombrar un ejercicio y comprobar que el historial sigue unido.
- Exportar el CSV y comprobar que se abre bien en Excel en español.
- Generar datos falsos de un año y comprobar que la app sigue siendo rápida.
