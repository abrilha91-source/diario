/* Contenido de la app (genérico, sin datos personales). */
'use strict';
const C = {};
C.MOODS = [['😊', 'Bien'], ['😌', 'Tranquila'], ['😐', 'Normal'], ['😔', 'Triste'], ['😢', 'Con ganas de llorar'], ['😠', 'Enojada'], ['😰', 'Ansiosa'], ['😴', 'Cansada'], ['💪', 'Fuerte'], ['🙏', 'Agradecida']];
C.LOW_MOODS = ['Triste', 'Con ganas de llorar', 'Ansiosa'];
C.SCORES = [[1, '😣', 'Muy mal'], [2, '😔', 'Mal'], [3, '😐', 'Más o menos'], [4, '🙂', 'Bien'], [5, '😊', 'Muy bien']];
C.SCORE_COLORS = { 1: '#c75b7a', 2: '#e39a8f', 3: '#e8cf8a', 4: '#9fcfa6', 5: '#5fae8a' };
C.EMOTIONS = [
  { core: 'Alegría', color: '#f2c14e', subs: ['Contenta', 'Agradecida', 'Esperanzada', 'Orgullosa', 'Aliviada', 'Ilusionada'] },
  { core: 'Calma', color: '#7cc4a4', subs: ['Tranquila', 'En paz', 'Segura', 'Centrada', 'Relajada'] },
  { core: 'Sorpresa', color: '#8fb7e8', subs: ['Confundida', 'Desconcertada', 'Sorprendida', 'En shock'] },
  { core: 'Miedo', color: '#a18ad6', subs: ['Ansiosa', 'Insegura', 'Preocupada', 'Abrumada', 'Nerviosa', 'Rechazada'] },
  { core: 'Tristeza', color: '#6f8fc9', subs: ['Sola', 'Herida', 'Vacía', 'Nostálgica', 'Decepcionada', 'Desanimada'] },
  { core: 'Enojo', color: '#e07a6b', subs: ['Frustrada', 'Resentida', 'Irritada', 'Traicionada', 'Celosa', 'Impotente'] }
];
C.TRIGGERS = ['Recuerdos', 'Redes sociales', 'Mensajes / chats', 'Soledad', 'Trabajo / servicio', 'Familia', 'Amistades', 'Dormí mal', 'Salud', 'Dinero', 'Fechas especiales', 'Lugares', 'Música'];
C.PROMPTS = [
  { cat: 'Cierre y soltar', icon: '🕊️', items: [
    { t: 'Carta que no se envía', carta: true, hint: 'Escribe todo lo que te gustaría decirle a esa persona. Esta carta NUNCA se envía: es para ti, para sacarlo del pecho.' },
    'Lo que aprendí de esta relación es…',
    'En una relación yo merezco…',
    'Lo que extraño y lo que definitivamente NO extraño.',
    'Si pudiera hablarle a la yo de hace un año, le diría…',
    '¿Qué parte de mí quiero recuperar ahora que estoy conmigo?',
    'Hoy decido soltar…',
    'Cosas que ahora puedo hacer solo por mí.'] },
  { cat: 'Gratitud', icon: '🙏', items: [
    'Tres cosas por las que agradezco hoy (aunque sean pequeñas).',
    'Una persona que me hizo bien hoy y por qué.',
    'Algo de mi cuerpo que agradezco hoy.',
    'Un momento de hoy que me sacó una sonrisa.'] },
  { cat: 'Ansiedad', icon: '🌿', items: [
    '¿Qué me preocupa ahora? ¿Qué parte está en mi control y cuál no?',
    'Lo peor que podría pasar, lo mejor, y lo más probable.',
    '¿Qué evidencia tengo de que este pensamiento es cierto? ¿Y de que no lo es?',
    '¿Qué necesito en este momento para sentirme un poquito mejor?'] },
  { cat: 'Amor propio', icon: '💜', items: [
    'Cinco cualidades que me gustan de mí.',
    'Un logro reciente, por pequeño que parezca.',
    '¿Qué le diría a una amiga que estuviera pasando por lo mismo que yo?',
    'Mi vida dentro de un año, si me cuido mucho, se ve así…',
    'Lo que hoy hice bien.'] }
];
C.ALL_PROMPTS = C.PROMPTS.flatMap(c => c.items.filter(i => typeof i === 'string'));
C.AFFIRMATIONS = [
  'Merezco un amor que me dé paz, no ansiedad.',
  'Lo que siento es válido, y también va a pasar.',
  'Elegirme a mí no es egoísmo, es cuidado.',
  'Cada día que me cuido es una victoria.',
  'No necesito respuestas de nadie para cerrar este ciclo.',
  'Soy suficiente tal como soy hoy.',
  'Puedo extrañar y aun así no volver.',
  'Mi valor no depende de quien no supo verlo.',
  'Hoy respiro, hoy avanzo un pasito.',
  'Está bien no estar bien. Está bien pedir ayuda.',
  'Soy fuerte, y también puedo ser suave conmigo.',
  'La paz que estoy construyendo vale más que cualquier mensaje.',
  'Me suelto de lo que me dolió y me abro a lo que me hace bien.',
  'Mi historia no termina aquí; apenas empieza un capítulo para mí.',
  'Me trato con la misma ternura con la que trato a quienes quiero.',
  'Mis emociones son olas: suben, bajan y pasan.',
  'Hoy elijo no buscar donde no hay nada para mí.',
  'Estoy aprendiendo a ser mi lugar seguro.',
  'Lo que es para mí, no me hará dudar de mi valor.',
  'Me doy permiso de sanar a mi ritmo.'
];
C.MILESTONES = [1, 3, 7, 14, 21, 30, 45, 60, 90, 120, 180, 270, 365, 500, 730];
C.URGE_REFLECTIONS = [
  'Está bien sentir ganas. Sentirlas no significa que tengas que actuar.',
  '¿Qué espero que pase si le escribo? ¿Es realista?',
  '¿Cómo me sentí la última vez que busqué contacto?',
  '¿Qué necesito en realidad ahora: consuelo, compañía, cerrar, que me vean?',
  '¿Cómo me voy a sentir mañana si hoy me cuido?',
  'Las ganas son como una ola: suben, llegan a su punto más alto y bajan.',
  'Tú decidiste cuidarte. Esa decisión sigue siendo valiente.',
  'Puedo escribir todo aquí, en una carta que nunca se envía.'
];
C.GROUND = [
  ['👀', '5 cosas que puedes VER', 'Mira a tu alrededor y nombra cinco cosas. Fíjate en colores y formas.', 5],
  ['✋', '4 cosas que puedes TOCAR', 'Siente cuatro texturas: la ropa, la silla, tu piel, el teléfono.', 4],
  ['👂', '3 cosas que puedes OÍR', 'Cierra los ojos un momento. ¿Qué tres sonidos escuchas?', 3],
  ['👃', '2 cosas que puedes OLER', 'Huele dos cosas, o recuerda dos olores que te gusten.', 2],
  ['👅', '1 cosa que puedes SABOREAR', 'Nota un sabor en tu boca, o toma un sorbo de agua despacio.', 1]
];
C.BREATHS = {
  '478': { name: '4‑7‑8 (para dormir y calmar)', cycles: 4, phases: [['Inhala por la nariz', 4, 'big'], ['Sostén el aire', 7, 'big'], ['Exhala por la boca', 8, 'small']] },
  'caja': { name: 'Cuadrada 4‑4‑4‑4 (para enfocarte)', cycles: 6, phases: [['Inhala', 4, 'big'], ['Sostén', 4, 'big'], ['Exhala', 4, 'small'], ['Sostén vacía', 4, 'small']] },
  'coherente': { name: 'Coherente 5‑5 (para equilibrar)', cycles: 12, phases: [['Inhala suave', 5, 'big'], ['Exhala suave', 5, 'small']] }
};
C.GUIDE = {
  usar: { label: 'Usar', steps: [
    ['🤍', 'Tu diario privado', '<p>Todo lo que guardes aquí se queda <strong>solo en este teléfono</strong>: no hay cuentas, ni servidores, ni nadie más lo ve. La app no envía nada a nadie y no tiene botones para compartir.</p><p>Se protege con tu PIN y se bloquea sola al salir.</p>'],
    ['＋', 'El botón ＋', '<p>Desde el botón morado del centro puedes: <strong>escribir</strong>, hacer un <strong>check-in de ánimo</strong>, grabar una <strong>nota de voz</strong>, agregar <strong>fotos</strong>, escribir una <strong>carta que no se envía</strong> o escribir con una <strong>idea guía</strong>.</p>'],
    ['🎙️', 'Audios cuando no puedas escribir', '<ol><li>En una entrada, toca <strong>⏺ Grabar</strong>, habla, y luego <strong>⏹ Detener</strong>.</li><li>O toca <strong>📁 Subir audio</strong> para elegir una nota de voz que ya tengas.</li><li>Toca <strong>Guardar</strong>.</li></ol><p class="muted">Al escucharlo puedes cambiar la velocidad (0.75× a 2×). «Dictar» es opcional; el audio siempre se guarda completo.</p>'],
    ['🏷️', 'Etiquetas, favoritas y búsqueda', '<p>Ponle etiquetas a tus entradas (por ejemplo «logro» o «familia») y márcalas con ⭐ para fijarlas arriba. En Inicio puedes buscar palabras y filtrar por tipo, favoritas, cartas o etiqueta.</p><p>Si editas una entrada, la versión anterior se guarda en <strong>«Versiones anteriores»</strong> y puedes restaurarla.</p>'],
    ['✉️', 'Carta que no se envía', '<p>Escribe todo lo que necesitas decirle a alguien. <strong>Nunca se envía</strong>: no hay botón de enviar ni de compartir. Cuando estés lista, puedes <strong>«Soltar esta carta»</strong> para borrarla como un pequeño ritual.</p>']
  ] },
  animo: { label: 'Ánimo', steps: [
    ['💜', 'Check-in de ánimo', '<p>Una vez al día (o cuando quieras): elige cómo estás del 1 al 5, toca la <strong>rueda de emociones</strong> para nombrar lo que sientes, la intensidad y qué lo detonó.</p>'],
    ['📊', 'Tu pestaña Ánimo', '<p>Verás un <strong>calendario de colores</strong> con tu ánimo de cada día (toca un día para ver lo que escribiste), tu <strong>racha</strong> de días escribiendo, una gráfica de cómo te has sentido y tus emociones y detonantes más frecuentes.</p>'],
    ['🌱', 'Días desde el cierre', '<p>Si quieres, en ⚙️ → «Mi proceso» pon la fecha en que empezaste a cuidarte. En Inicio verás cuántos días llevas y tus próximos logros (7, 14, 30, 90 días…).</p>']
  ] },
  calma: { label: 'Calma', steps: [
    ['🌊', 'Ganas de escribirle', '<p>Si sientes ganas de buscar a alguien que no te hace bien: abre <strong>Calma → Ganas de escribirle</strong>. Pon un temporizador de 10 minutos y deja pasar la ola con preguntas que te ayudan a pensar. Puedes escribir todo en una carta que no se envía.</p>'],
    ['🌬️', 'Respirar y 5‑4‑3‑2‑1', '<p>Hay tres respiraciones (4‑7‑8, cuadrada y coherente) y el ejercicio <strong>5‑4‑3‑2‑1</strong> para volver al presente cuando la ansiedad sube.</p>'],
    ['📞', 'Apoyo', '<p>Si tus check-ins están bajos varios días seguidos, la app te lo dirá con cariño. La <strong>Línea de la Vida: 800 911 2000</strong> (gratis, 24 h) siempre está en Calma. En emergencia, <strong>911</strong>.</p>']
  ] },
  iphone: { label: 'Instalar iPhone', steps: [
    ['🧭', 'Abre en Safari', '<p>En iPhone la instalación funciona desde <strong>Safari</strong> (en iOS 16.4 o más reciente también desde otros navegadores con el botón compartir).</p>'],
    ['⬆️', 'Botón Compartir', '<p>Toca el botón <strong>Compartir</strong> (cuadrito con flecha hacia arriba) en la barra de Safari.</p>'],
    ['➕', 'Añadir a pantalla de inicio', '<p>Desliza y toca <strong>«Añadir a pantalla de inicio»</strong>. Deja el nombre «Mi diario» y toca <strong>Añadir</strong>.</p>'],
    ['📲', 'Ábrela desde el ícono', '<p>Desde ahora abre tu diario con el ícono de tu pantalla de inicio. Así funciona <strong>sin internet</strong> y iOS cuida mejor tus datos.</p><p class="muted">Importante: lo que guardes en Safari y lo que guardes en el ícono son espacios separados en iPhone. Usa siempre el ícono.</p>'],
    ['✨', 'Actualizaciones', '<p>Cuando haya una versión nueva, verás el aviso <strong>«Hay una nueva versión»</strong>. Toca «Actualizar ahora». Tus entradas no se tocan.</p>']
  ] },
  android: { label: 'Instalar Android', steps: [
    ['🌐', 'Abre en Chrome', '<p>Abre el enlace del diario en <strong>Chrome</strong>.</p>'],
    ['⋮', 'Menú', '<p>Toca el menú <strong>⋮</strong> y elige <strong>«Instalar app»</strong> o <strong>«Añadir a pantalla de inicio»</strong>. También puedes usar ⚙️ → «Instalar en este teléfono».</p>'],
    ['📲', 'Listo', '<p>Abre «Mi diario» desde su ícono. Funciona sin internet.</p>']
  ] },
  respaldo: { label: 'Respaldo', steps: [
    ['⚠️', '¿Por qué respaldar?', '<p>Tu diario vive dentro del navegador de este teléfono. Si borras los datos de Safari/Chrome, desinstalas la app o pierdes el teléfono, <strong>se pierde todo</strong>. El respaldo es tu copia segura.</p>'],
    ['☁️', 'Ojo con Fotos de iCloud', '<p>Si usas <strong>Fotos de iCloud</strong>, al borrar una foto del teléfono también se borra de iCloud (queda 30 días en «Eliminado»).</p><p>Por eso el respaldo debe guardarse en <strong>iCloud Drive (app Archivos)</strong> o <strong>Google Drive</strong>, que son independientes de tu galería: <strong>no se borran</strong> cuando borras fotos.</p>'],
    ['⬇️', 'Exportar respaldo', '<ol><li>Ve a <strong>⚙️ → Exportar respaldo</strong>. Verás cuánto pesa antes de crearlo.</li><li>Si quieres, marca <strong>«Proteger con contraseña»</strong> (cifrado). <strong>Si olvidas esa contraseña, el respaldo no se puede abrir.</strong></li><li>En iPhone toca <strong>«Guardar en Archivos»</strong> → <strong>iCloud Drive</strong> → Guardar.</li></ol><p class="muted">Si eliges «Solo descargar», el archivo queda en Archivos → Descargas.</p>'],
    ['✅', 'Verifica antes de borrar fotos', '<ol><li>Toca <strong>⚙️ → Verificar un respaldo</strong> y elige el archivo que guardaste. La app revisa que cada foto y audio esté completo, sin importar nada.</li><li>En Archivos, espera a que termine de subir a iCloud (sin la nubecita con flecha).</li><li>Solo entonces borra las fotos de tu galería.</li></ol>'],
    ['🔁', 'Cada semana', '<p>Haz un respaldo nuevo al menos <strong>cada 7 días</strong> o después de guardar fotos importantes. La app te avisará.</p><p>Para restaurar en un teléfono nuevo: instala la app, crea tu PIN y usa <strong>Importar respaldo</strong> (sirven también los respaldos de la versión anterior).</p>']
  ] }
};
