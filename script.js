// ==========================================================
// 1. CONFIGURACIÓN: URL /exec DE GOOGLE APPS SCRIPT
// ==========================================================
const SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbx5VZ0HkBDLsgp8xuJod4ousnSlOViWQv0h67mb3_6ORpR9AO1druVo-C8edZjkWkNA/exec'

const STORAGE_KEY_USER = 'IBEROTECA_TOTH_USER_SESSION'
const STORAGE_KEY_SUPERVISORES = 'IBEROTECA_SUPERVISORES_CACHE'

let appState = {
  tabActual: 'hoy',
  supervisoresDisponibles: [],
  supervisor: null,
  practicantes: [],
  feriado: { esFeriado: false, motivo: '' },
  forzarFeriado: false,
  pendienteAnular: null,
  pendienteIncidencia: null,
  semanasDisponibles: [],
  semanaSeleccionadaLunes: null,
  practicantesReporteSemana: null,
  cacheReporteSemanal: {},
  precargaEnCurso: false,
  historicoCompletoCargado: false,
  vistaReporte: 'puntualidad', // 'puntualidad' | 'horarios'
}

// ==========================================================
// CONTROL DE SPLASH SCREEN
// ==========================================================
function mostrarSplashScreen(texto = 'Iniciando sistema...') {
  const splash = document.getElementById('splash-screen')
  const status = document.getElementById('splash-status-text')
  if (status && texto) status.textContent = texto
  if (splash) {
    splash.classList.remove('hidden')
    splash.classList.remove('fade-out')
  }
}

function ocultarSplashScreen(delayMs = 300) {
  const splash = document.getElementById('splash-screen')
  if (!splash) return
  setTimeout(() => {
    splash.classList.add('fade-out')
    setTimeout(() => {
      splash.classList.add('hidden')
    }, 450)
  }, delayMs)
}

window.addEventListener('DOMContentLoaded', () => {
  iniciarReloj()

  // Cargar lista desde caché local si existe para mostrar inmediatamente
  const supervisoresCached = localStorage.getItem(STORAGE_KEY_SUPERVISORES)
  if (supervisoresCached) {
    try {
      appState.supervisoresDisponibles = JSON.parse(supervisoresCached)
    } catch (e) {}
  }
  const promesaSupervisores = cargarListaSupervisores()

  document.addEventListener('click', (e) => {
    const searchWrapper = document.querySelector('.search-wrapper')
    if (searchWrapper && !searchWrapper.contains(e.target)) {
      ocultarDropdownSugerencias()
    }
  })

  setInterval(actualizarMinutosEnVivo, 30000)

  const sesionGuardada = localStorage.getItem(STORAGE_KEY_USER)
  if (sesionGuardada) {
    try {
      appState.supervisor = JSON.parse(sesionGuardada)
      mostrarSplashScreen('Cargando panel de asistencia...')
      mostrarDashboard()
      recargarDatos().finally(() => {
        ocultarSplashScreen(350)
      })
    } catch (e) {
      localStorage.removeItem(STORAGE_KEY_USER)
      mostrarSplashScreen('Cargando lista de usuarios...')
      mostrarLogin()
      Promise.allSettled([
        promesaSupervisores,
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]).then(() => {
        ocultarSplashScreen(300)
      })
    }
  } else {
    mostrarSplashScreen('Cargando lista de usuarios...')
    mostrarLogin()
    // El splash screen del login dura al menos 2 segundos para dar tiempo a los usuarios de cargar
    Promise.allSettled([
      promesaSupervisores,
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]).then(() => {
      ocultarSplashScreen(300)
    })
  }

  // Listener para validación en tiempo real de coincidencia de contraseñas
  const inputConfirmar = document.getElementById('password-confirmar')
  const inputNueva = document.getElementById('password-nueva')
  const errMatch = document.getElementById('password-match-error')
  if (inputConfirmar && inputNueva && errMatch) {
    const verificarCoincidencia = () => {
      if (inputConfirmar.value && inputNueva.value !== inputConfirmar.value) {
        errMatch.classList.remove('hidden')
      } else {
        errMatch.classList.add('hidden')
      }
    }
    inputConfirmar.addEventListener('input', verificarCoincidencia)
    inputNueva.addEventListener('input', verificarCoincidencia)
  }
})

function iniciarReloj() {
  const elHora = document.getElementById('reloj-hora')
  const elFecha = document.getElementById('reloj-fecha')

  function actualizar() {
    const ahora = new Date()
    elHora.textContent = ahora.toLocaleTimeString('es-PE', {
      hour12: false,
    })
    elFecha.textContent = ahora.toLocaleDateString('es-PE', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
  }

  actualizar()
  setInterval(actualizar, 1000)
}

function cambiarTab(nombreTab) {
  appState.tabActual = nombreTab

  const btnHoy = document.getElementById('tab-btn-hoy')
  const btnReporte = document.getElementById('tab-btn-reporte')
  const panelHoy = document.getElementById('panel-hoy')
  const panelReporte = document.getElementById('panel-reporte')

  if (nombreTab === 'hoy') {
    btnHoy.classList.add('active')
    btnReporte.classList.remove('active')
    panelHoy.classList.remove('hidden')
    panelReporte.classList.add('hidden')
    renderizarPanelHoy()
  } else {
    btnReporte.classList.add('active')
    btnHoy.classList.remove('active')
    panelReporte.classList.remove('hidden')
    panelHoy.classList.add('hidden')
    renderizarPanelReporte()
  }
}

async function llamarAppsScript(datos, conLoading = true) {
  if (!SCRIPT_URL || SCRIPT_URL.includes('AKfycbz...')) {
    alert(
      'Por favor abre index.html y coloca tu URL /exec de Google Apps Script en la constante SCRIPT_URL (línea 448).',
    )
    throw new Error('URL de Apps Script no configurada.')
  }

  if (conLoading) mostrarLoading('Sincronizando...')

  // Función interna con 1 reintento automático para mitigar parpadeos de DNS o red (ERR_NAME_NOT_RESOLVED)
  const ejecutarConReintento = async (intento = 1) => {
    try {
      const respuesta = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(datos),
      })

      if (!respuesta.ok) throw new Error(`Error HTTP: ${respuesta.status}`)

      const data = await respuesta.json()
      if (!data.success) throw new Error(data.error || 'Error en la operación.')
      return data
    } catch (err) {
      const msg = String(err.message || '').toLowerCase()
      const esFalloRed =
        err.name === 'TypeError' ||
        msg.includes('failed to fetch') ||
        msg.includes('network') ||
        msg.includes('net::')

      if (intento === 1 && esFalloRed) {
        console.warn(
          'Reintento automático tras fallo de conexión o DNS...',
          err,
        )
        await new Promise((resolve) => setTimeout(resolve, 1200))
        return ejecutarConReintento(2)
      }
      throw err
    }
  }

  try {
    const data = await ejecutarConReintento(1)
    if (conLoading) ocultarLoading()
    return data
  } catch (err) {
    if (conLoading) ocultarLoading()
    console.warn('Error en comunicación con Apps Script:', err)
    throw err
  }
}

let syncTimer = null
function setSyncStatus(estado, texto) {
  const badge = document.getElementById('sync-status')
  const textEl = document.getElementById('sync-status-text')
  if (!badge || !textEl) return

  if (syncTimer) clearTimeout(syncTimer)

  badge.className = `sync-badge ${estado}`
  textEl.textContent = texto
  badge.classList.remove('hidden')

  if (estado === 'success') {
    syncTimer = setTimeout(() => badge.classList.add('hidden'), 2500)
  }
}

async function cargarListaSupervisores() {
  if (!SCRIPT_URL || SCRIPT_URL.includes('AKfycbz...')) return
  try {
    const res = await llamarAppsScript(
      { accion: 'obtener_supervisores' },
      false,
    )
    if (res && res.supervisores && res.supervisores.length > 0) {
      appState.supervisoresDisponibles = res.supervisores
      localStorage.setItem(
        STORAGE_KEY_SUPERVISORES,
        JSON.stringify(res.supervisores),
      )
      // Si el desplegable de login está abierto en pantalla, refrescarlo con la data real
      const dropdown = document.getElementById('sugerencias-usuarios')
      if (dropdown && dropdown.style.display === 'block') {
        const inputVal = document.getElementById('login-usuario')
          ? document.getElementById('login-usuario').value
          : ''
        filtrarSupervisores(inputVal)
      }
    }
  } catch (e) {
    console.warn('No se pudo precargar lista:', e)
  }
}

function mostrarDropdownSugerencias() {
  const val = document.getElementById('login-usuario').value.trim()
  if (val.length > 0) {
    filtrarSupervisores(val)
  }
}

function ocultarDropdownSugerencias() {
  const dropdown = document.getElementById('sugerencias-usuarios')
  if (dropdown) dropdown.style.display = 'none'
  indiceSugerenciaActiva = -1
}

function resaltarCoincidencia(texto, query) {
  if (!texto || !query) return texto || ''
  const regex = new RegExp(
    `(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`,
    'gi',
  )
  return texto.replace(regex, '<strong>$1</strong>')
}

let indiceSugerenciaActiva = -1

function filtrarSupervisores(texto) {
  const dropdown = document.getElementById('sugerencias-usuarios')
  const btnClear = document.getElementById('btn-clear-search')
  const query = (texto || '').trim().toLowerCase()

  if (btnClear) btnClear.style.display = query ? 'block' : 'none'

  // COMPORTAMIENTO NAVEGADOR: Si no hay texto, no mostrar lista desplegable
  if (!query) {
    dropdown.innerHTML = ''
    dropdown.style.display = 'none'
    indiceSugerenciaActiva = -1
    return
  }

  let lista = appState.supervisoresDisponibles || []
  if (lista.length === 0) {
    dropdown.innerHTML = `
      <div style="padding: 12px 14px; font-size: 0.82rem; color: var(--slate-500); text-align: center; display: flex; align-items: center; justify-content: center; gap: 8px;">
        <span class="sync-spinner"></span>
        <span>Cargando lista de supervisores...</span>
      </div>
    `
    dropdown.style.display = 'block'
    return
  }

  const resultados = lista.filter(
    (s) =>
      (s.usuario && s.usuario.toLowerCase().includes(query)) ||
      (s.nombre && s.nombre.toLowerCase().includes(query)) ||
      (s.idSupervisor && s.idSupervisor.toLowerCase().includes(query)),
  )

  dropdown.innerHTML = ''
  indiceSugerenciaActiva = -1

  if (resultados.length === 0) {
    dropdown.innerHTML = `
      <div style="padding: 12px 14px; font-size: 0.82rem; color: var(--slate-400); text-align: center;">
        No hay coincidencias para "<strong>${texto}</strong>"
      </div>
    `
    dropdown.style.display = 'block'
    return
  }

  resultados.forEach((sup, idx) => {
    const item = document.createElement('div')
    item.className = 'suggestion-item'
    item.dataset.index = idx

    const nombreResaltado = resaltarCoincidencia(
      sup.nombre || sup.usuario,
      query,
    )
    const usuarioResaltado = resaltarCoincidencia(sup.usuario, query)

    item.innerHTML = `
      <div class="suggestion-left">
        <div class="suggestion-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </div>
        <div class="suggestion-text">
          <div class="suggestion-user-title">${nombreResaltado} <span class="suggestion-id">(${usuarioResaltado})</span></div>
          <div class="suggestion-sub">${sup.oficina || 'Innovación y Desarrollo'}</div>
        </div>
      </div>
      <span class="suggestion-tag">${sup.rol || 'Supervisor'}</span>
    `

    item.onmousedown = (e) => {
      e.preventDefault()
      seleccionarSupervisorSugerido(sup)
    }

    dropdown.appendChild(item)
  })

  dropdown.style.display = 'block'
}

function seleccionarSupervisorSugerido(sup) {
  const input = document.getElementById('login-usuario')
  input.value = sup.usuario
  ocultarDropdownSugerencias()
  const btnClear = document.getElementById('btn-clear-search')
  if (btnClear) btnClear.style.display = 'block'
  const passInput = document.getElementById('login-password')
  if (passInput) passInput.focus()
}

function manejarKeydownSugerencias(e) {
  const dropdown = document.getElementById('sugerencias-usuarios')
  if (!dropdown || dropdown.style.display !== 'block') return

  const items = dropdown.querySelectorAll('.suggestion-item')
  if (items.length === 0) return

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    indiceSugerenciaActiva = (indiceSugerenciaActiva + 1) % items.length
    actualizarSugerenciaActiva(items)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    indiceSugerenciaActiva =
      (indiceSugerenciaActiva - 1 + items.length) % items.length
    actualizarSugerenciaActiva(items)
  } else if (e.key === 'Enter') {
    if (indiceSugerenciaActiva >= 0 && indiceSugerenciaActiva < items.length) {
      e.preventDefault()
      items[indiceSugerenciaActiva].dispatchEvent(new MouseEvent('mousedown'))
    }
  } else if (e.key === 'Escape') {
    ocultarDropdownSugerencias()
  }
}

function actualizarSugerenciaActiva(items) {
  items.forEach((it, idx) => {
    if (idx === indiceSugerenciaActiva) {
      it.classList.add('active')
      it.scrollIntoView({ block: 'nearest' })
    } else {
      it.classList.remove('active')
    }
  })
}

function limpiarBuscador() {
  const input = document.getElementById('login-usuario')
  input.value = ''
  const btnClear = document.getElementById('btn-clear-search')
  if (btnClear) btnClear.style.display = 'none'
  ocultarDropdownSugerencias()
  input.focus()
}

async function iniciarSesion(e) {
  e.preventDefault()
  const usuario = document.getElementById('login-usuario').value.trim()
  const contrasena = document.getElementById('login-password').value.trim()

  mostrarSplashScreen('Autenticando supervisor y cargando registros...')

  try {
    const res = await llamarAppsScript(
      { accion: 'login', usuario, contrasena },
      true,
    )
    appState.supervisor = res.supervisor
    appState.practicantes = res.practicantes || []
    appState.feriado = res.feriado || { esFeriado: false }
    if (res.semanasDisponibles && res.semanasDisponibles.length > 0) {
      appState.semanasDisponibles = res.semanasDisponibles
    } else {
      appState.semanasDisponibles = generarSemanasLocales()
    }
    const semActual =
      appState.semanasDisponibles.find((s) => s.esActual) ||
      appState.semanasDisponibles[0]
    appState.semanaSeleccionadaLunes = semActual.lunes
    appState.cacheReporteSemanal = {}
    appState.cacheReporteSemanal[semActual.lunes] = res.practicantes || []
    appState.practicantesReporteSemana = null
    appState.historicoCompletoCargado = false

    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(res.supervisor))

    mostrarToast(`¡Bienvenido/a, ${res.supervisor.usuario}!`, 'success')
    mostrarDashboard()
    poblarSelectorSemanas()
    renderizarTodo()

    ocultarSplashScreen(350)

    // Iniciar precarga silenciosa de las últimas 12 semanas en segundo plano
    iniciarPrecargaSemanasRecientes()
  } catch (err) {
    ocultarSplashScreen(100)
    mostrarToast(err.message || 'Error al iniciar sesión', 'error')
  }
}

function cerrarSesion() {
  mostrarSplashScreen('Cerrando sesión...')
  appState.supervisor = null
  appState.practicantes = []
  appState.semanasDisponibles = []
  appState.semanaSeleccionadaLunes = null
  appState.practicantesReporteSemana = null
  appState.cacheReporteSemanal = {}
  appState.precargaEnCurso = false
  appState.historicoCompletoCargado = false
  localStorage.removeItem(STORAGE_KEY_USER)
  mostrarLogin()
  setTimeout(() => {
    ocultarSplashScreen(300)
  }, 1500)
  mostrarToast('Sesión cerrada.', 'warning')
}

async function recargarDatos() {
  if (!appState.supervisor) return
  try {
    // Vaciar la caché en memoria para garantizar datos 100% actualizados desde Sheets
    appState.cacheReporteSemanal = {}
    appState.historicoCompletoCargado = false

    const res = await llamarAppsScript(
      { accion: 'recargar', usuario: appState.supervisor.usuario },
      true,
    )
    appState.practicantes = res.practicantes || []
    appState.feriado = res.feriado || { esFeriado: false }
    if (res.semanasDisponibles && res.semanasDisponibles.length > 0) {
      appState.semanasDisponibles = res.semanasDisponibles
    }
    const semActual =
      appState.semanasDisponibles.find((s) => s.esActual) ||
      appState.semanasDisponibles[0]
    if (semActual) {
      appState.cacheReporteSemanal[semActual.lunes] = res.practicantes || []
    }
    poblarSelectorSemanas()
    renderizarTodo()
    mostrarToast('Datos actualizados.', 'success')

    // Disparar precarga silenciosa de las últimas 12 semanas
    iniciarPrecargaSemanasRecientes()
  } catch (err) {
    mostrarToast(err.message || 'Error al sincronizar con Sheets', 'error')
  }
}

function mostrarLogin() {
  document.getElementById('vista-login').classList.remove('hidden')
  document.getElementById('vista-dashboard').classList.add('hidden')
  document.getElementById('login-password').value = ''
  ocultarDropdownSugerencias()
  cargarListaSupervisores()
}

function mostrarDashboard() {
  document.getElementById('vista-login').classList.add('hidden')
  document.getElementById('vista-dashboard').classList.remove('hidden')

  if (appState.supervisor) {
    document.getElementById('user-nombre').textContent =
      appState.supervisor.usuario
    document.getElementById('label-oficina').textContent =
      appState.supervisor.oficina
    document.getElementById('avatar-inicial').textContent =
      appState.supervisor.usuario.charAt(0).toUpperCase()
  }

  const bannerFeriado = document.getElementById('banner-feriado')
  if (appState.feriado && appState.feriado.esFeriado) {
    bannerFeriado.classList.remove('hidden')
    document.getElementById('motivo-feriado').textContent =
      appState.feriado.motivo
  } else {
    bannerFeriado.classList.add('hidden')
  }
}

function toggleForzarFeriado() {
  appState.forzarFeriado = !appState.forzarFeriado
  const btn = document.getElementById('btn-toggle-feriado')
  if (appState.forzarFeriado) {
    btn.textContent = 'Deshabilitar modo extraordinario'
    btn.classList.add('btn-danger')
    btn.classList.remove('btn-outline')
  } else {
    btn.textContent = 'Habilitar marcación extraordinaria'
    btn.classList.remove('btn-danger')
    btn.classList.add('btn-outline')
  }
  renderizarTodo()
}

function formatearMinutos(mins) {
  if (mins === undefined || mins === null) return '0h 00m'
  const abs = Math.abs(mins)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `${mins < 0 ? '-' : ''}${h}h ${m < 10 ? '0' : ''}${m}m`
}

// Cálculo blindado con regex para cualquier string o formato de hora
function calcularMinutosEntreHoras(horaFin, horaInicio) {
  if (!horaFin || !horaInicio) return 0

  const extraerMin = (val) => {
    const match = String(val).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
    if (!match) return 0
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10)
  }

  const diff = extraerMin(horaFin) - extraerMin(horaInicio)
  return diff > 0 ? diff : 0
}

function actualizarMinutosEnVivo() {
  let huboCambios = false
  const ahoraStr = new Date().toLocaleTimeString('es-PE', {
    hour12: false,
  })

  // Obtener fecha de hoy en ISO para localizar el día actual en desgloseSemanal
  const ahora = new Date()
  const y = ahora.getFullYear()
  const m = String(ahora.getMonth() + 1).padStart(2, '0')
  const d = String(ahora.getDate()).padStart(2, '0')
  const hoyISO = appState.fechaHoy || `${y}-${m}-${d}`
  const diaSemanaNum = ahora.getDay()
  const diaIndexFallback =
    diaSemanaNum >= 1 && diaSemanaNum <= 5 ? diaSemanaNum - 1 : 0

  const listasAActualizar = []
  if (appState.practicantes && Array.isArray(appState.practicantes)) {
    listasAActualizar.push(appState.practicantes)
  }
  const semActualInfo =
    appState.semanasDisponibles &&
    appState.semanasDisponibles.find((s) => s.esActual)
  const esSemanaActual =
    !appState.semanaSeleccionadaLunes ||
    (semActualInfo && appState.semanaSeleccionadaLunes === semActualInfo.lunes)
  if (
    esSemanaActual &&
    appState.practicantesReporteSemana &&
    Array.isArray(appState.practicantesReporteSemana) &&
    appState.practicantesReporteSemana !== appState.practicantes
  ) {
    listasAActualizar.push(appState.practicantesReporteSemana)
  }

  listasAActualizar.forEach((lista) => {
    lista.forEach((p) => {
      if (p.entrada && !p.salida) {
        const transcurridos = calcularMinutosEntreHoras(
          ahoraStr,
          p.entrada.hora,
        )
        if (p.minutosHoy !== transcurridos) {
          p.minutosHoy = transcurridos
          huboCambios = true
        }
        if (p.desgloseSemanal && Array.isArray(p.desgloseSemanal)) {
          let diaObj = p.desgloseSemanal.find((dia) => dia.fecha === hoyISO)
          if (!diaObj && p.desgloseSemanal[diaIndexFallback]) {
            diaObj = p.desgloseSemanal[diaIndexFallback]
          }
          if (diaObj && diaObj.estado === 'EN_CURSO') {
            if (diaObj.minutos !== transcurridos) {
              diaObj.minutos = transcurridos
              huboCambios = true
            }
          }
        }
      }
    })
  })

  if (huboCambios) renderizarTodo()
}

// ==========================================================
// SINCRONIZADOR INLIVE: DESGLOSE SEMANAL EN MEMORIA (0ms)
// ==========================================================
function actualizarDesgloseSemanalEnMemoria(
  usuarioPracticante,
  tipoAccion,
  datos = {},
) {
  if (!usuarioPracticante) return

  const ahora = new Date()
  const y = ahora.getFullYear()
  const m = String(ahora.getMonth() + 1).padStart(2, '0')
  const d = String(ahora.getDate()).padStart(2, '0')
  const hoyISO = appState.fechaHoy || `${y}-${m}-${d}`

  const diaSemanaNum = ahora.getDay() // 0=Dom, 1=Lun, ..., 5=Vie
  const diaIndexFallback =
    diaSemanaNum >= 1 && diaSemanaNum <= 5 ? diaSemanaNum - 1 : 0

  // Colecciones de practicantes que deben mantenerse sincronizadas
  const colecciones = []
  if (appState.practicantes && Array.isArray(appState.practicantes)) {
    colecciones.push(appState.practicantes)
  }
  if (
    appState.practicantesReporteSemana &&
    Array.isArray(appState.practicantesReporteSemana)
  ) {
    if (appState.practicantesReporteSemana !== appState.practicantes) {
      colecciones.push(appState.practicantesReporteSemana)
    }
  }

  // Sincronizar únicamente la lista en caché correspondiente a la semana actual
  if (appState.cacheReporteSemanal) {
    const semActual =
      appState.semanasDisponibles &&
      appState.semanasDisponibles.find((s) => s.esActual)
    const claveActual = semActual ? semActual.lunes : null
    if (claveActual && appState.cacheReporteSemanal[claveActual]) {
      const listaActual = appState.cacheReporteSemanal[claveActual]
      if (Array.isArray(listaActual) && !colecciones.includes(listaActual)) {
        colecciones.push(listaActual)
      }
    }
  }

  colecciones.forEach((lista) => {
    const p = lista.find(
      (item) =>
        (item.idPracticante &&
          String(item.idPracticante).trim().toLowerCase() ===
            usuarioPracticante.trim().toLowerCase()) ||
        String(item.usuario || '')
          .trim()
          .toLowerCase() === usuarioPracticante.trim().toLowerCase() ||
        String(item.nombre || '')
          .trim()
          .toLowerCase() === usuarioPracticante.trim().toLowerCase(),
    )
    if (!p) return

    if (!p.desgloseSemanal || p.desgloseSemanal.length === 0) {
      p.desgloseSemanal = [
        {
          diaNombre: 'Lun',
          fecha: '',
          estado: 'PENDIENTE',
          minutos: 0,
          horasFormateadas: '--',
        },
        {
          diaNombre: 'Mar',
          fecha: '',
          estado: 'PENDIENTE',
          minutos: 0,
          horasFormateadas: '--',
        },
        {
          diaNombre: 'Mié',
          fecha: '',
          estado: 'PENDIENTE',
          minutos: 0,
          horasFormateadas: '--',
        },
        {
          diaNombre: 'Jue',
          fecha: '',
          estado: 'PENDIENTE',
          minutos: 0,
          horasFormateadas: '--',
        },
        {
          diaNombre: 'Vie',
          fecha: '',
          estado: 'PENDIENTE',
          minutos: 0,
          horasFormateadas: '--',
        },
      ]
    }

    let diaObj = p.desgloseSemanal.find((dia) => dia.fecha === hoyISO)
    if (!diaObj && p.desgloseSemanal[diaIndexFallback]) {
      const tieneFechas = p.desgloseSemanal.some(
        (dia) => dia.fecha && dia.fecha.length >= 10,
      )
      if (!tieneFechas) {
        diaObj = p.desgloseSemanal[diaIndexFallback]
      }
    }
    if (!diaObj) return

    const metaDiariaMin = p.metaDiariaMinutos || 240
    const metaSemanalMin = p.metaSemanalMinutos || 1200

    if (tipoAccion === 'ENTRADA') {
      const horaMarcada =
        datos.hora || new Date().toLocaleTimeString('es-PE', { hour12: false })
      const ahoraStr = new Date().toLocaleTimeString('es-PE', { hour12: false })
      const transcurridos = calcularMinutosEntreHoras(ahoraStr, horaMarcada)
      diaObj.estado = 'EN_CURSO'
      diaObj.horaEntradaReal = horaMarcada
      diaObj.horaSalidaReal = null
      diaObj.minutos = transcurridos
      p.minutosHoy = transcurridos
      diaObj.horasFormateadas = '--'
      diaObj.puntualidad = obtenerPuntualidad(diaObj, p, 5)
    } else if (tipoAccion === 'SALIDA') {
      diaObj.estado = 'COMPLETADO'
      diaObj.horaSalidaReal =
        datos.hora || new Date().toLocaleTimeString('es-PE', { hour12: false })
      diaObj.minutos = datos.minutosSesion || 0
      diaObj.horasFormateadas = formatearMinutos(diaObj.minutos)
      diaObj.cumplioMeta = diaObj.minutos >= metaDiariaMin
    } else if (tipoAccion === 'ANULAR_SALIDA') {
      const horaEntrada =
        (p.entrada ? p.entrada.hora : null) || diaObj.horaEntradaReal || ''
      const ahoraStr = new Date().toLocaleTimeString('es-PE', { hour12: false })
      const transcurridos = horaEntrada
        ? calcularMinutosEntreHoras(ahoraStr, horaEntrada)
        : 0
      diaObj.estado = 'EN_CURSO'
      diaObj.horaSalidaReal = null
      diaObj.minutos = transcurridos
      p.minutosHoy = transcurridos
      diaObj.horasFormateadas = '--'
      diaObj.cumplioMeta = false
    } else if (tipoAccion === 'ANULAR_ENTRADA') {
      diaObj.estado = 'PENDIENTE'
      diaObj.horaEntradaReal = null
      diaObj.horaSalidaReal = null
      diaObj.minutos = 0
      diaObj.horasFormateadas = '--'
      diaObj.puntualidad = null
      diaObj.cumplioMeta = false
    } else if (tipoAccion === 'INCIDENCIA') {
      const esPermiso =
        datos.tipo === 'PERMISO_AUTORIZADO' ||
        datos.tipo === 'DESCANSO_MEDICO' ||
        datos.tipo === 'PERMISO'
      diaObj.estado = esPermiso ? 'PERMISO_COMPUTADO' : 'FALTA'
      diaObj.minutos = esPermiso ? metaDiariaMin : 0
      diaObj.horasFormateadas = formatearMinutos(diaObj.minutos)
      diaObj.horaEntradaReal = null
      diaObj.horaSalidaReal = null
      diaObj.puntualidad = null
      diaObj.cumplioMeta = esPermiso
    } else if (tipoAccion === 'ANULAR_INCIDENCIA') {
      diaObj.estado = 'PENDIENTE'
      diaObj.minutos = 0
      diaObj.horasFormateadas = '--'
      diaObj.cumplioMeta = false
    }

    // Recalcular minutos de la semana sumando días computados
    let totalSemana = 0
    p.desgloseSemanal.forEach((d) => {
      if (
        d.estado === 'COMPLETADO' ||
        d.estado === 'FERIADO' ||
        d.estado === 'PERMISO_COMPUTADO'
      ) {
        totalSemana += d.minutos || 0
      }
    })
    p.minutosSemanaTotal = totalSemana

    // Recalcular saldo semanal
    const diaHoyIdx = p.desgloseSemanal.findIndex((d) => d.fecha === hoyISO)
    if (diaHoyIdx >= 0) {
      p.saldoSemanalMinutos = totalSemana - metaDiariaMin * (diaHoyIdx + 1)
    } else {
      p.saldoSemanalMinutos = totalSemana - metaSemanalMin
    }
  })
}

function renderizarTodo() {
  if (appState.tabActual === 'hoy') {
    renderizarPanelHoy()
  } else {
    renderizarPanelReporte()
  }
}

// ==========================================================
// RENDERIZADO: PANEL 1 - ASISTENCIA DE HOY (COMPACTO & NÍTIDO)
// ==========================================================
function formatearHoraSinSegundos(horaStr) {
  if (!horaStr || horaStr === '--') return '--'
  const m = String(horaStr).match(/(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : horaStr
}

function renderizarPanelHoy() {
  const contenedor = document.getElementById('grid-practicantes')
  contenedor.innerHTML = ''

  if (!appState.practicantes || appState.practicantes.length === 0) {
    contenedor.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; background: white; border-radius: var(--radius-lg); border: 1px dashed var(--slate-300);">
            <h3 style="color: var(--slate-700); margin-bottom: 4px;">No hay practicantes asignados</h3>
            <p style="color: var(--slate-500); font-size: 0.85rem;">Verifica la columna Supervisor_Asignado en tu Google Sheet.</p>
          </div>
        `
    return
  }

  const esFeriadoBloqueante =
    appState.feriado && appState.feriado.esFeriado && !appState.forzarFeriado

  appState.practicantes.forEach((p, idx) => {
    const tieneEntrada = !!p.entrada
    const tieneSalida = !!p.salida
    const tieneIncidencia = !!p.incidencia
    const metaDiariaMin = p.metaDiariaMinutos || 240

    // TAGS LIMPIOS CON BORDE (SIN LA HORA ESTÁTICA DENTRO DEL TAG)
    let badgeHtml = `
          <span class="badge badge-pending">
            <span class="badge-dot"></span>
            En espera
          </span>
        `
    if (tieneIncidencia) {
      badgeHtml = `
            <span class="badge badge-incident">
              <span class="badge-dot"></span>
              ${p.incidencia.tipo.replace('_', ' ')}
            </span>
          `
    } else if (tieneSalida) {
      badgeHtml = `
            <span class="badge badge-finished">
              <span class="badge-dot"></span>
              Finalizado
            </span>
          `
    } else if (tieneEntrada) {
      badgeHtml = `
            <span class="badge badge-present">
              <span class="badge-dot"></span>
              En Oficina
            </span>
          `
    }

    // Fila informativa de la jornada de hoy
    let statusRowHtml = ''
    if (tieneSalida) {
      statusRowHtml = `
            <div class="card-today-status completed">
              <div class="status-primary-line">
                <span>✔ Jornada completada: ${formatearMinutos(p.minutosHoy)}</span>
              </div>
              <div class="status-sub-line">
                Horario realizado: ${p.entrada.hora} a ${p.salida.hora}
              </div>
            </div>
          `
    } else if (tieneEntrada) {
      const faltaMin = Math.max(0, metaDiariaMin - (p.minutosHoy || 0))
      const cumplido = (p.minutosHoy || 0) >= metaDiariaMin
      statusRowHtml = `
            <div class="card-today-status in-office">
              <div class="status-primary-line">
                <span>⏱ Lleva transcurridos: ${formatearMinutos(p.minutosHoy)}</span>
                <span style="font-size: 0.74rem;">${cumplido ? '¡Meta 4h cumplida!' : `Faltan ${formatearMinutos(faltaMin)}`}</span>
              </div>
              <div class="status-sub-line">
                Entrada registrada a las ${p.entrada.hora} (Meta: ${formatearMinutos(metaDiariaMin)})
              </div>
            </div>
          `
    } else if (tieneIncidencia) {
      statusRowHtml = `
            <div class="card-today-status incident">
              <div class="status-primary-line">
                <span>Inasistencia / Permiso asentado</span>
              </div>
              <div class="status-sub-line">
                ${p.incidencia.observacion || 'Registrado por supervisor'}
              </div>
            </div>
          `
    } else {
      statusRowHtml = `
            <div class="card-today-status">
              <div class="status-primary-line">
                <span>Jornada pendiente de hoy</span>
                <span style="font-size: 0.74rem;">Meta: ${formatearMinutos(metaDiariaMin)}</span>
              </div>
              <div class="status-sub-line">
                Horario habitual: ${formatearHoraSinSegundos(p.horaEntradaOficial)} a ${formatearHoraSinSegundos(p.horaSalidaOficial)}
              </div>
            </div>
          `
    }

    // Cuerpo: Acción única contextual
    let actionBoxHtml = ''
    if (tieneSalida) {
      actionBoxHtml = `
            <div class="finished-state-box">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color: #10b981;">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>Jornada de hoy completada exitosamente</span>
            </div>
          `
    } else if (tieneEntrada) {
      const hSalidaCorta = formatearHoraSinSegundos(p.horaSalidaOficial)
      actionBoxHtml = `
            <div class="action-contextual-box">
              <div class="action-row-main">
                <button class="btn btn-danger btn-action-main" onclick="ejecutarMarcacion('${p.idPracticante || p.usuario}', 'SALIDA', ${idx})" ${esFeriadoBloqueante ? 'disabled' : ''}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                  </svg>
                  MARCAR SALIDA
                </button>
                <label class="checkbox-pill-subtle" title="Marcar a la hora programada (${hSalidaCorta})">
                  <input type="checkbox" id="chk-salida-${idx}">
                  <span>A horario (${hSalidaCorta})</span>
                </label>
              </div>
              <div class="obs-wrapper-always">
                <input type="text" id="obs-salida-${idx}" class="form-control form-control-sm" placeholder="Comentario u observación (opcional)...">
              </div>
            </div>
          `
    } else if (!tieneIncidencia) {
      const hEntradaCorta = formatearHoraSinSegundos(p.horaEntradaOficial)
      actionBoxHtml = `
            <div class="action-contextual-box">
              <div class="action-row-main">
                <button class="btn btn-success btn-action-main" onclick="ejecutarMarcacion('${p.idPracticante || p.usuario}', 'ENTRADA', ${idx})" ${esFeriadoBloqueante ? 'disabled' : ''}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                    <polyline points="10 17 15 12 10 7"></polyline>
                    <line x1="15" y1="12" x2="3" y2="12"></line>
                  </svg>
                  MARCAR ENTRADA
                </button>
                <label class="checkbox-pill-subtle" title="Marcar a la hora programada (${hEntradaCorta})">
                  <input type="checkbox" id="chk-entrada-${idx}">
                  <span>A horario (${hEntradaCorta})</span>
                </label>
              </div>
              <div class="obs-wrapper-always">
                <input type="text" id="obs-entrada-${idx}" class="form-control form-control-sm" placeholder="Comentario u observación (opcional)...">
              </div>
            </div>
          `
    } else {
      actionBoxHtml = `
            <div class="finished-state-box">
              <span>Inasistencia registrada para hoy</span>
            </div>
          `
    }

    let footerHtml = ''
    if (tieneSalida) {
      footerHtml = `
            <button class="btn-footer-action danger" onclick="solicitarAnulacion('${p.idPracticante || p.usuario}', '${p.salida.idRegistro || ''}', 'Salida de las ${p.salida.hora}', ${idx}, 'SALIDA', '${p.nombre || p.usuario}')" title="Revertir la salida de hoy">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
                <polyline points="1 4 1 10 7 10"></polyline>
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
              </svg>
              <span>Deshacer salida</span>
            </button>
          `
    } else if (tieneEntrada) {
      footerHtml = `
            <button class="btn-footer-action danger" onclick="solicitarAnulacion('${p.idPracticante || p.usuario}', '${p.entrada.idRegistro || ''}', 'Entrada de las ${p.entrada.hora}', ${idx}, 'ENTRADA', '${p.nombre || p.usuario}')" title="Revertir la entrada de hoy">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
                <polyline points="1 4 1 10 7 10"></polyline>
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
              </svg>
              <span>Deshacer entrada</span>
            </button>
          `
    } else if (tieneIncidencia) {
      footerHtml = `
            <button class="btn-footer-action danger" onclick="solicitarAnulacion('${p.idPracticante || p.usuario}', '${p.incidencia.idRegistro || ''}', 'Inasistencia', ${idx}, 'INCIDENCIA', '${p.nombre || p.usuario}')" title="Eliminar registro de inasistencia">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
              <span>Anular inasistencia</span>
            </button>
          `
    } else {
      footerHtml = `
            <button class="btn-footer-action secondary" onclick="abrirModalIncidencia('${p.idPracticante || p.usuario}', ${idx}, '${p.nombre || p.usuario}')" title="Registrar permiso o inasistencia">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <span>Reportar ausencia o permiso</span>
            </button>
          `
    }

    const card = document.createElement('div')
    card.className = 'card-practicante'
    card.innerHTML = `
            <div class="card-header">
              <div class="card-header-top">
                <h3 class="card-name" title="${p.nombre || p.usuario}">${p.nombre || p.usuario}</h3>
                ${badgeHtml}
              </div>
              <div class="card-meta">
                <span class="card-meta-horario">
                  Horario: <strong>${formatearHoraSinSegundos(p.horaEntradaOficial)} - ${formatearHoraSinSegundos(p.horaSalidaOficial)}</strong>
                </span>
                <span style="opacity: 0.4;">•</span>
                <span class="card-meta-oficina" title="${p.oficina}">${p.oficina}</span>
              </div>
            </div>

            ${statusRowHtml}

            <div class="card-body">
              ${actionBoxHtml}
            </div>

            <div class="card-footer">
              ${footerHtml}
            </div>
          `

    contenedor.appendChild(card)
  })
}

// ==========================================================
// RENDERIZADO: PANEL 2 - REPORTE Y BALANCE SEMANAL
// ==========================================================

function obtenerLunesActualISO() {
  const ahora = new Date()
  const diaSemana = ahora.getDay()
  const diffAlLunes = ahora.getDate() - diaSemana + (diaSemana === 0 ? -6 : 1)
  const lunes = new Date(ahora.setDate(diffAlLunes))
  const y = lunes.getFullYear()
  const m = String(lunes.getMonth() + 1).padStart(2, '0')
  const d = String(lunes.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function generarSemanasLocales() {
  const semanas = []
  const ahora = new Date()
  const diaSemana = ahora.getDay()
  const diffAlLunesActual =
    ahora.getDate() - diaSemana + (diaSemana === 0 ? -6 : 1)
  const lunesActual = new Date(new Date().setDate(diffAlLunesActual))
  lunesActual.setHours(12, 0, 0, 0)

  // Generar semanas desde el 1 de enero del año actual hasta la semana actual
  const inicioAno = new Date(lunesActual.getFullYear(), 0, 1, 12, 0, 0)
  const diaSemIni = inicioAno.getDay()
  const diffIni = inicioAno.getDate() - diaSemIni + (diaSemIni === 0 ? -6 : 1)
  const cursor = new Date(inicioAno.setDate(diffIni))
  cursor.setHours(12, 0, 0, 0)

  const mesesNombres = [
    'Ene',
    'Feb',
    'Mar',
    'Abr',
    'May',
    'Jun',
    'Jul',
    'Ago',
    'Set',
    'Oct',
    'Nov',
    'Dic',
  ]
  const pad = (n) => String(n).padStart(2, '0')

  while (cursor <= lunesActual) {
    const lStr = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`
    const vDate = new Date(cursor)
    vDate.setDate(cursor.getDate() + 4)
    const vStr = `${vDate.getFullYear()}-${pad(vDate.getMonth() + 1)}-${pad(vDate.getDate())}`
    const esActual = cursor.getTime() === lunesActual.getTime()

    const etiqueta = `${cursor.getDate()} ${mesesNombres[cursor.getMonth()]} - ${vDate.getDate()} ${mesesNombres[vDate.getMonth()]} ${vDate.getFullYear()}${esActual ? ' (Esta semana)' : ''}`

    semanas.push({
      lunes: lStr,
      viernes: vStr,
      etiqueta: etiqueta,
      esActual: esActual,
    })

    cursor.setDate(cursor.getDate() + 7)
  }

  return semanas.reverse()
}

function toggleDropdownSemanas(e) {
  if (e) e.stopPropagation()
  if (appState.precargaEnCurso) return
  const container = document.getElementById('dropdown-semanas-container')
  const menu = document.getElementById('menu-semanas-dropdown')
  const trigger = document.getElementById('btn-dropdown-semanas')
  if (!container || !menu) return

  const isOpen = container.classList.contains('open')
  if (isOpen) {
    cerrarDropdownSemanas()
  } else {
    container.classList.add('open')
    menu.classList.remove('hidden')
    if (trigger) trigger.setAttribute('aria-expanded', 'true')
  }
}

function cerrarDropdownSemanas() {
  const container = document.getElementById('dropdown-semanas-container')
  const menu = document.getElementById('menu-semanas-dropdown')
  const trigger = document.getElementById('btn-dropdown-semanas')
  if (container) container.classList.remove('open')
  if (menu) menu.classList.add('hidden')
  if (trigger) trigger.setAttribute('aria-expanded', 'false')
}

// Cierre automático al hacer clic en cualquier lugar fuera del dropdown
document.addEventListener('click', (e) => {
  const container = document.getElementById('dropdown-semanas-container')
  if (container && !container.contains(e.target)) {
    cerrarDropdownSemanas()
  }
})

function poblarSelectorSemanas() {
  const menu = document.getElementById('menu-semanas-dropdown')
  const labelActiva = document.getElementById('label-semana-activa')

  if (
    !appState.semanasDisponibles ||
    appState.semanasDisponibles.length === 0
  ) {
    appState.semanasDisponibles = generarSemanasLocales()
  }

  if (!appState.semanaSeleccionadaLunes) {
    const semActual = appState.semanasDisponibles.find((s) => s.esActual)
    appState.semanaSeleccionadaLunes = semActual
      ? semActual.lunes
      : appState.semanasDisponibles[0].lunes
  }

  const semSeleccionada = appState.semanasDisponibles.find(
    (s) => s.lunes === appState.semanaSeleccionadaLunes,
  )
  if (labelActiva && semSeleccionada) {
    labelActiva.textContent = semSeleccionada.etiqueta
  }

  if (!menu) return
  menu.innerHTML = ''

  appState.semanasDisponibles.forEach((sem) => {
    const item = document.createElement('div')
    const esActivo = sem.lunes === appState.semanaSeleccionadaLunes
    item.className = `custom-dropdown-item ${esActivo ? 'active' : ''}`

    let badgeHtml = ''
    if (sem.esActual) {
      badgeHtml = `<span class="item-badge-actual">Esta semana</span>`
    }

    let checkHtml = esActivo ? `<span class="item-check-icon">✓</span>` : ''

    item.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span>${sem.etiqueta.replace(' (Esta semana)', '')}</span>
        ${badgeHtml}
      </div>
      ${checkHtml}
    `

    item.onclick = (e) => {
      e.stopPropagation()
      cerrarDropdownSemanas()
      seleccionarSemana(sem.lunes)
    }

    menu.appendChild(item)
  })

  actualizarEstadoBotonesNavegacion()
}

function actualizarEstadoBotonesNavegacion() {
  const btnAnt = document.getElementById('btn-semana-ant')
  const btnSig = document.getElementById('btn-semana-sig')
  const btnHoy = document.getElementById('btn-semana-hoy')
  const btnDropdown = document.getElementById('btn-dropdown-semanas')
  const spinnerDropdown = document.getElementById('spinner-dropdown-semanas')
  const caretDropdown = document.getElementById('caret-dropdown-semanas')

  if (!btnAnt || !btnSig || !appState.semanasDisponibles) return

  const idxActual = appState.semanasDisponibles.findIndex(
    (s) => s.lunes === appState.semanaSeleccionadaLunes,
  )

  if (appState.precargaEnCurso) {
    btnAnt.disabled = true
    btnSig.disabled = true
    if (btnDropdown) {
      btnDropdown.disabled = true
      btnDropdown.classList.add('dropdown-disabled-loading')
      btnDropdown.setAttribute(
        'title',
        'Sincronizando últimas 12 semanas en segundo plano...',
      )
    }
    if (spinnerDropdown) spinnerDropdown.classList.remove('hidden')
    if (caretDropdown) caretDropdown.classList.add('hidden')
  } else {
    btnSig.disabled = idxActual <= 0
    btnAnt.disabled = idxActual >= appState.semanasDisponibles.length - 1
    if (btnDropdown) {
      btnDropdown.disabled = false
      btnDropdown.classList.remove('dropdown-disabled-loading')
      btnDropdown.setAttribute('title', 'Seleccionar semana')
    }
    if (spinnerDropdown) spinnerDropdown.classList.add('hidden')
    if (caretDropdown) caretDropdown.classList.remove('hidden')
  }

  const semActual = appState.semanasDisponibles.find((s) => s.esActual)
  const esEstaSemana =
    semActual && semActual.lunes === appState.semanaSeleccionadaLunes
  if (btnHoy) {
    btnHoy.style.display = esEstaSemana ? 'none' : 'inline-flex'
  }
}

async function seleccionarSemana(fechaLunes) {
  if (!fechaLunes) return
  appState.semanaSeleccionadaLunes = fechaLunes

  // 1. Si está en caché local (RAM), actualizar de inmediato (0ms)
  if (appState.cacheReporteSemanal[fechaLunes]) {
    appState.practicantesReporteSemana =
      appState.cacheReporteSemanal[fechaLunes]
    renderizarPanelReporte()
    poblarSelectorSemanas()
    actualizarEstadoBotonesNavegacion()
    return
  }

  // 2. Si es la semana actual y ya tenemos los practicantes cargados
  const semActual = appState.semanasDisponibles.find((s) => s.esActual)
  if (
    semActual &&
    semActual.lunes === fechaLunes &&
    appState.practicantes &&
    appState.practicantes.length > 0
  ) {
    appState.practicantesReporteSemana = appState.practicantes
    appState.cacheReporteSemanal[fechaLunes] = appState.practicantes
    renderizarPanelReporte()
    poblarSelectorSemanas()
    actualizarEstadoBotonesNavegacion()
    return
  }

  // 3. Si no está en caché (semana histórica > 12 semanas), cargar todo el archivo histórico restante del supervisor de una sola vez
  mostrarLoading('Descargando archivo histórico completo...')
  try {
    const res = await llamarAppsScript(
      {
        accion: 'obtener_reporte_historico_completo',
        usuario: appState.supervisor.usuario,
        excluirFechasLunes: Object.keys(appState.cacheReporteSemanal),
      },
      false,
    )

    ocultarLoading()

    if (res && res.success) {
      if (res.semanas) {
        Object.assign(appState.cacheReporteSemanal, res.semanas)
      }
      if (res.semanasDisponibles && res.semanasDisponibles.length > 0) {
        appState.semanasDisponibles = res.semanasDisponibles
      }
      appState.historicoCompletoCargado = true

      if (appState.cacheReporteSemanal[fechaLunes]) {
        appState.practicantesReporteSemana =
          appState.cacheReporteSemanal[fechaLunes]
      } else {
        appState.practicantesReporteSemana = []
      }

      renderizarPanelReporte()
      poblarSelectorSemanas()
      actualizarEstadoBotonesNavegacion()
    }
  } catch (err) {
    ocultarLoading()
    console.warn('Fallo al obtener archivo histórico:', err)
    mostrarToast(
      'No se pudo descargar el archivo histórico por conexión o red.',
      'warning',
    )
  }
}

async function iniciarPrecargaSemanasRecientes() {
  if (
    !appState.supervisor ||
    !appState.semanasDisponibles ||
    appState.semanasDisponibles.length <= 1
  ) {
    return
  }

  // Tomar hasta las últimas 12 semanas (~3 meses)
  const limiteSemanas = appState.semanasDisponibles.slice(0, 12)
  const fechasLunesAPedir = limiteSemanas
    .map((s) => s.lunes)
    .filter((lunes) => !appState.cacheReporteSemanal[lunes])

  if (fechasLunesAPedir.length === 0) {
    return
  }

  appState.precargaEnCurso = true
  actualizarEstadoBotonesNavegacion()

  try {
    const res = await llamarAppsScript(
      {
        accion: 'obtener_reporte_lote_semanas',
        usuario: appState.supervisor.usuario,
        fechasLunes: fechasLunesAPedir,
      },
      false,
    )

    if (res && res.success && res.semanas) {
      Object.assign(appState.cacheReporteSemanal, res.semanas)
    }
  } catch (err) {
    console.warn('Fallo silencioso al precargar lote de semanas:', err)
  } finally {
    appState.precargaEnCurso = false
    actualizarEstadoBotonesNavegacion()
  }
}

function navegarSemana(delta) {
  if (appState.precargaEnCurso) return
  if (!appState.semanasDisponibles || appState.semanasDisponibles.length === 0)
    return
  const idxActual = appState.semanasDisponibles.findIndex(
    (s) => s.lunes === appState.semanaSeleccionadaLunes,
  )
  const nuevoIdx = idxActual - delta
  if (nuevoIdx >= 0 && nuevoIdx < appState.semanasDisponibles.length) {
    seleccionarSemana(appState.semanasDisponibles[nuevoIdx].lunes)
  }
}

function irASemanaActual() {
  if (!appState.semanasDisponibles || appState.semanasDisponibles.length === 0)
    return
  const semActual =
    appState.semanasDisponibles.find((s) => s.esActual) ||
    appState.semanasDisponibles[0]
  if (semActual) {
    seleccionarSemana(semActual.lunes)
  }
}

function obtenerPuntualidad(d, p, toleranciaMin = 5) {
  if (d.puntualidad) return d.puntualidad
  const horaEntrada = d.horaEntradaReal || (d.entrada && d.entrada.hora)
  const horaOficial = p.horaEntradaOficial
  if (!horaEntrada || !horaOficial) return null

  const extraerMin = (val) => {
    const match = String(val).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
    if (!match) return 0
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10)
  }

  const realMin = extraerMin(horaEntrada)
  const oficialMin = extraerMin(horaOficial)
  const diff = realMin - oficialMin

  if (diff <= 0) {
    return {
      estado: 'TEMPRANO',
      texto: 'TEMPRANO',
      nivel: 'verde',
      minutosTarde: 0,
    }
  } else if (diff <= toleranciaMin) {
    return {
      estado: 'TOLERANCIA',
      texto: 'TEMPRANO',
      nivel: 'naranja',
      minutosTarde: diff,
    }
  } else {
    return {
      estado: 'TARDE',
      texto: 'TARDE',
      nivel: 'rojo',
      minutosTarde: diff,
    }
  }
}

function cambiarVistaReporte(nuevaVista) {
  if (nuevaVista !== 'puntualidad' && nuevaVista !== 'horarios') return
  appState.vistaReporte = nuevaVista

  const btnPunt = document.getElementById('btn-vista-puntualidad')
  const btnHorarios = document.getElementById('btn-vista-horarios')
  if (btnPunt && btnHorarios) {
    if (nuevaVista === 'horarios') {
      btnHorarios.classList.add('active')
      btnPunt.classList.remove('active')
    } else {
      btnPunt.classList.add('active')
      btnHorarios.classList.remove('active')
    }
  }

  renderizarPanelReporte()
}

function asegurarSegundos(horaStr) {
  if (!horaStr) return ''
  const partes = String(horaStr).trim().split(':')
  if (partes.length === 2) {
    return `${partes[0].padStart(2, '0')}:${partes[1]}:00`
  }
  if (partes.length >= 3) {
    return `${partes[0].padStart(2, '0')}:${partes[1]}:${partes[2].padStart(2, '0')}`
  }
  return horaStr
}

function renderizarPanelReporte() {
  const tbody = document.getElementById('tabla-semanal-body')
  tbody.innerHTML = ''

  poblarSelectorSemanas()

  // Sincronizar estado visual de los botones del control segmentado
  const btnPunt = document.getElementById('btn-vista-puntualidad')
  const btnHorarios = document.getElementById('btn-vista-horarios')
  if (btnPunt && btnHorarios) {
    if (appState.vistaReporte === 'horarios') {
      btnHorarios.classList.add('active')
      btnPunt.classList.remove('active')
    } else {
      btnPunt.classList.add('active')
      btnHorarios.classList.remove('active')
    }
  }

  const esVistaHorarios = appState.vistaReporte === 'horarios'

  const listaPracticantes =
    appState.practicantesReporteSemana || appState.practicantes
  if (!listaPracticantes || listaPracticantes.length === 0) return

  // Actualizar los encabezados de los días con sus fechas
  const primerDesglose = listaPracticantes[0]?.desgloseSemanal
  if (primerDesglose && primerDesglose.length === 5) {
    const nombresDiasBase = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie']
    primerDesglose.forEach((dia, i) => {
      const thEl = document.getElementById(`th-dia-${i}`)
      if (thEl) {
        let diaNum = ''
        if (dia.fecha) {
          const partes = dia.fecha.split('-')
          diaNum = partes[2] ? ` ${parseInt(partes[2], 10)}` : ''
        }
        thEl.textContent = `${nombresDiasBase[i]}${diaNum}`
      }
    })
  }

  let sumaMinutosEquipo = 0
  let sumaMetasEquipo = 0

  listaPracticantes.forEach((p) => {
    const totalSemanaMin = p.minutosSemanaTotal || 0
    const metaSemanalMin = p.metaSemanalMinutos || 1200
    const saldoMin = p.saldoSemanalMinutos || 0
    const metaDiariaMin = p.metaDiariaMinutos || 240

    sumaMinutosEquipo += totalSemanaMin
    sumaMetasEquipo += metaSemanalMin

    let celdasDiasHtml = ''
    if (p.desgloseSemanal && p.desgloseSemanal.length > 0) {
      celdasDiasHtml = p.desgloseSemanal
        .map((d) => {
          const punt = obtenerPuntualidad(d, p, 5)
          let tagPuntHtml = ''
          let claseDotPunt = 'dot-verde'

          if (punt) {
            const clasePunt =
              punt.nivel === 'verde'
                ? 'temprano-verde'
                : punt.nivel === 'naranja'
                  ? 'temprano-naranja'
                  : 'tarde-rojo'
            claseDotPunt =
              punt.nivel === 'verde'
                ? 'dot-verde'
                : punt.nivel === 'naranja'
                  ? 'dot-naranja'
                  : 'dot-rojo'
            const titlePunt =
              punt.nivel === 'naranja'
                ? `Ingresó dentro del margen de tolerancia (${punt.minutosTarde}m)`
                : punt.nivel === 'rojo'
                  ? `Llegó tarde (${punt.minutosTarde}m)`
                  : 'Llegó a tiempo'
            tagPuntHtml = `<span class="tag-puntualidad ${clasePunt}" title="${titlePunt}">${punt.texto}</span>`
          }

          // ========================================================
          // VISTA 2: HORARIOS E/S MINIMALISTA (PUNTOS Y SEGUNDOS)
          // ========================================================
          if (esVistaHorarios) {
            if (d.estado === 'COMPLETADO') {
              const hEntradaRaw =
                d.horaEntradaReal || (d.entrada && d.entrada.hora)
              const hSalidaRaw = d.horaSalidaReal || (d.salida && d.salida.hora)
              const hEntrada = asegurarSegundos(hEntradaRaw)
              const hSalida = asegurarSegundos(hSalidaRaw)
              const cumplioMeta = (d.minutos || 0) >= metaDiariaMin
              const claseDotSalida = cumplioMeta ? 'dot-verde' : 'dot-rojo'
              const titleSalida = hSalida
                ? `Salida: ${hSalida} (${cumplioMeta ? 'Meta cumplida' : 'Horas incompletas'})`
                : 'Sin salida registrada'

              return `
                <td>
                  <div class="celda-horario-minimal">
                    <div class="linea-horario" title="Entrada: ${hEntrada || '--'} (${punt ? punt.texto : 'A tiempo'})">
                      <span class="dot-horario ${claseDotPunt}"></span>
                      <span>${hEntrada || '--'}</span>
                    </div>
                    <div class="linea-horario" title="${titleSalida}">
                      <span class="dot-horario ${claseDotSalida}"></span>
                      ${hSalida ? `<span>${hSalida}</span>` : `<span class="hora-no-salida">Sin salida</span>`}
                    </div>
                  </div>
                </td>
              `
            } else if (d.estado === 'EN_CURSO') {
              const hEntradaRaw =
                d.horaEntradaReal || (p.entrada ? p.entrada.hora : null)
              const hEntrada = asegurarSegundos(hEntradaRaw)
              let minutosEnCurso = d.minutos || 0
              if (minutosEnCurso === 0 && hEntradaRaw) {
                const ahoraStr = new Date().toLocaleTimeString('es-PE', {
                  hour12: false,
                })
                minutosEnCurso = calcularMinutosEntreHoras(
                  ahoraStr,
                  hEntradaRaw,
                )
                d.minutos = minutosEnCurso
              }
              return `
                <td>
                  <div class="celda-horario-minimal">
                    <div class="linea-horario" title="Entrada: ${hEntrada || '--'}">
                      <span class="dot-horario ${claseDotPunt}"></span>
                      <span>${hEntrada || '--'}</span>
                    </div>
                    <div class="linea-horario" title="Jornada en curso (${formatearMinutos(minutosEnCurso)})">
                      <span class="dot-horario dot-azul pulse"></span>
                      <span class="hora-en-curso">En curso</span>
                    </div>
                  </div>
                </td>
              `
            } else if (d.estado === 'FERIADO') {
              return `
                <td>
                  <div class="celda-horario-minimal">
                    <span class="cell-pill cell-holiday">Feriado</span>
                  </div>
                </td>
              `
            } else if (d.estado === 'PERMISO_COMPUTADO') {
              return `
                <td>
                  <div class="celda-horario-minimal">
                    <span class="cell-pill cell-completed">Permiso</span>
                  </div>
                </td>
              `
            } else if (d.estado === 'FALTA') {
              return `
                <td>
                  <div class="celda-horario-minimal">
                    <span class="cell-pill cell-incident">Falta</span>
                  </div>
                </td>
              `
            } else if (d.estado === 'NO_REGISTRADO') {
              return `
                <td>
                  <div class="celda-horario-minimal">
                    <span class="cell-pill cell-pending">Sin registro</span>
                  </div>
                </td>
              `
            } else {
              return `
                <td>
                  <div class="celda-horario-minimal">
                    <span class="hora-texto-muted">--</span>
                  </div>
                </td>
              `
            }
          }

          // ========================================================
          // VISTA 1: RESUMEN Y PUNTUALIDAD (VISTA ORIGINAL)
          // ========================================================
          if (d.estado === 'COMPLETADO') {
            const cumplioMeta = (d.minutos || 0) >= metaDiariaMin
            const claseTiempo = cumplioMeta ? 'cumplido' : 'no-cumplido'
            return `
              <td>
                <div class="celda-dia-stack">
                  ${tagPuntHtml}
                  <span class="tiempo-dia ${claseTiempo}">${d.horasFormateadas || formatearMinutos(d.minutos)}</span>
                </div>
              </td>
            `
          } else if (d.estado === 'EN_CURSO') {
            let minutosEnCurso = d.minutos || 0
            if (minutosEnCurso === 0) {
              const hEntrada =
                d.horaEntradaReal || (p.entrada ? p.entrada.hora : null)
              if (hEntrada) {
                const ahoraStr = new Date().toLocaleTimeString('es-PE', {
                  hour12: false,
                })
                minutosEnCurso = calcularMinutosEntreHoras(ahoraStr, hEntrada)
                d.minutos = minutosEnCurso
              }
            }
            return `
              <td>
                <div class="celda-dia-stack">
                  ${tagPuntHtml}
                  <span class="cell-pill cell-current">En curso (${formatearMinutos(minutosEnCurso)})</span>
                </div>
              </td>
            `
          } else if (d.estado === 'FERIADO') {
            return `
              <td>
                <div class="celda-dia-stack">
                  <span class="cell-pill cell-holiday">Feriado</span>
                  <span class="tiempo-dia cumplido">${formatearMinutos(d.minutos)}</span>
                </div>
              </td>
            `
          } else if (d.estado === 'PERMISO_COMPUTADO') {
            return `
              <td>
                <div class="celda-dia-stack">
                  <span class="cell-pill cell-completed">Permiso</span>
                  <span class="tiempo-dia cumplido">${formatearMinutos(d.minutos)}</span>
                </div>
              </td>
            `
          } else if (d.estado === 'FALTA') {
            return `
              <td>
                <div class="celda-dia-stack">
                  <span class="cell-pill cell-incident">Falta</span>
                  <span class="tiempo-dia no-cumplido">0h 00m</span>
                </div>
              </td>
            `
          } else {
            return `
              <td>
                <div class="celda-dia-stack">
                  <span class="cell-pill cell-pending">--</span>
                </div>
              </td>
            `
          }
        })
        .join('')
    } else {
      celdasDiasHtml = '<td>--</td><td>--</td><td>--</td><td>--</td><td>--</td>'
    }

    let saldoHtml = ''
    if (saldoMin > 0) {
      saldoHtml = `<span class="cell-balance-pos">+${formatearMinutos(saldoMin)}</span>`
    } else if (saldoMin < 0) {
      saldoHtml = `<span class="cell-balance-neg">${formatearMinutos(saldoMin)}</span>`
    } else {
      saldoHtml = `<span class="cell-balance-zero">Al día</span>`
    }

    const tr = document.createElement('tr')
    tr.innerHTML = `
          <td><strong>${p.nombre || p.usuario}</strong></td>
          <td style="color: var(--slate-500);">${formatearHoraSinSegundos(p.horaEntradaOficial)} - ${formatearHoraSinSegundos(p.horaSalidaOficial)}</td>
          ${celdasDiasHtml}
          <td><strong>${formatearMinutos(totalSemanaMin)}</strong></td>
          <td style="color: var(--slate-500);">${formatearMinutos(metaSemanalMin)}</td>
          <td>${saldoHtml}</td>
        `

    tbody.appendChild(tr)
  })

  document.getElementById('kpi-horas-equipo').textContent =
    formatearMinutos(sumaMinutosEquipo)
  document.getElementById('kpi-practicantes-activos').textContent =
    listaPracticantes.length
  const pctGlobal =
    sumaMetasEquipo > 0
      ? Math.round((sumaMinutosEquipo / sumaMetasEquipo) * 100)
      : 0
  document.getElementById('kpi-cumplimiento-pct').textContent = `${pctGlobal}%`
}

// ==========================================================
// EJECUTAR MARCACIÓN INLIVE (0ms DE ESPERA CON ROLLBACK)
// ==========================================================
async function ejecutarMarcacion(idPracticante, tipo, idx) {
  const chkId = tipo === 'ENTRADA' ? `chk-entrada-${idx}` : `chk-salida-${idx}`
  const obsId = tipo === 'ENTRADA' ? `obs-entrada-${idx}` : `obs-salida-${idx}`

  const checkbox = document.getElementById(chkId)
  const obsInput = document.getElementById(obsId)

  const usarHoraOficial = checkbox ? checkbox.checked : false
  const observacion = obsInput ? obsInput.value.trim() : ''

  const practicante = appState.practicantes[idx]
  if (!practicante) return

  const estadoAnterior = JSON.parse(JSON.stringify(practicante))

  let horaVisual = new Date().toLocaleTimeString('es-PE', {
    hour12: false,
  })
  if (usarHoraOficial) {
    horaVisual =
      tipo === 'ENTRADA'
        ? practicante.horaEntradaOficial
        : practicante.horaSalidaOficial
  }

  const supervisorId =
    appState.supervisor && appState.supervisor.idSupervisor
      ? appState.supervisor.idSupervisor
      : appState.supervisor
        ? appState.supervisor.usuario
        : 'Supervisor'
  const supervisorNombre =
    appState.supervisor && appState.supervisor.nombre
      ? appState.supervisor.nombre
      : appState.supervisor
        ? appState.supervisor.usuario
        : supervisorId

  const detalle = {
    idRegistro: 'TEMP-' + Date.now(),
    hora: horaVisual,
    modo: usarHoraOficial ? 'HORA_OFICIAL' : 'REAL',
    registradoPor: supervisorId,
    observacion: observacion,
  }

  // 1. ACTUALIZACIÓN VISUAL INMEDIATA EN MEMORIA (0 ms)
  if (tipo === 'ENTRADA') {
    practicante.entrada = detalle
    practicante.minutosHoy = 0
    actualizarDesgloseSemanalEnMemoria(idPracticante, 'ENTRADA', {
      hora: horaVisual,
    })
  } else {
    practicante.salida = detalle
    if (practicante.entrada) {
      const minutosSesion = calcularMinutosEntreHoras(
        horaVisual,
        practicante.entrada.hora,
      )
      practicante.minutosHoy = minutosSesion
      practicante.minutosSemanaTotal =
        (practicante.minutosSemanaTotal || 0) + minutosSesion
      actualizarDesgloseSemanalEnMemoria(idPracticante, 'SALIDA', {
        hora: horaVisual,
        minutosSesion: minutosSesion,
      })
    }
  }

  renderizarTodo()
  setSyncStatus('syncing', 'Guardando...')

  // 2. Envío en segundo plano
  try {
    const res = await llamarAppsScript(
      {
        accion: 'marcar',
        idPracticante: idPracticante,
        usuarioPracticante: idPracticante,
        tipo: tipo,
        usarHoraOficial: usarHoraOficial,
        observacion: observacion,
        registradoPor: supervisorId,
        nombreSupervisor: supervisorNombre,
      },
      false,
    )

    if (res.registro && res.registro.idRegistro) {
      if (tipo === 'ENTRADA' && practicante.entrada) {
        practicante.entrada.idRegistro = res.registro.idRegistro
      } else if (tipo === 'SALIDA' && practicante.salida) {
        practicante.salida.idRegistro = res.registro.idRegistro
        if (res.registro.minutosTrabajados) {
          practicante.minutosHoy = res.registro.minutosTrabajados
        }
      }
    }

    setSyncStatus('success', 'Guardado ✔')
  } catch (err) {
    // ROLLBACK
    appState.practicantes[idx] = estadoAnterior
    if (tipo === 'ENTRADA') {
      actualizarDesgloseSemanalEnMemoria(idPracticante, 'ANULAR_ENTRADA')
    } else {
      actualizarDesgloseSemanalEnMemoria(idPracticante, 'ANULAR_SALIDA')
    }
    renderizarTodo()
    setSyncStatus('error', 'Error al guardar')
    mostrarToast('No se pudo guardar en Sheets: ' + err.message, 'error')
  }
}

// ==========================================================
// ANULACIÓN / DESHACER (CON ROLLBACK)
// ==========================================================
function solicitarAnulacion(
  idPracticante,
  idRegistro,
  detalle,
  idx,
  tipoAnulacion,
  nombrePracticante,
) {
  // Si idRegistro aún es provisional TEMP-, verificar si ya se actualizó en memoria con el ID definitivo
  const p = appState.practicantes && appState.practicantes[idx]
  if (p) {
    if (
      tipoAnulacion === 'ENTRADA' &&
      p.entrada &&
      p.entrada.idRegistro &&
      !p.entrada.idRegistro.startsWith('TEMP-')
    ) {
      idRegistro = p.entrada.idRegistro
    } else if (
      tipoAnulacion === 'SALIDA' &&
      p.salida &&
      p.salida.idRegistro &&
      !p.salida.idRegistro.startsWith('TEMP-')
    ) {
      idRegistro = p.salida.idRegistro
    } else if (
      tipoAnulacion === 'INCIDENCIA' &&
      p.incidencia &&
      p.incidencia.idRegistro &&
      !p.incidencia.idRegistro.startsWith('TEMP-')
    ) {
      idRegistro = p.incidencia.idRegistro
    }
  }

  appState.pendienteAnular = {
    idPracticante,
    idRegistro,
    idx,
    tipoAnulacion,
    nombrePracticante: nombrePracticante || idPracticante,
  }
  document.getElementById('anular-desc').innerHTML =
    `¿Deseas revertir la <strong>${detalle}</strong> de <strong>${nombrePracticante || idPracticante}</strong>?`
  document.getElementById('anular-motivo').value = ''
  document.getElementById('modal-anular').classList.remove('hidden')
}

function cerrarModalAnular() {
  appState.pendienteAnular = null
  document.getElementById('modal-anular').classList.add('hidden')
}

async function confirmarAnulacion() {
  if (!appState.pendienteAnular) return

  let { idPracticante, idRegistro, idx, tipoAnulacion } =
    appState.pendienteAnular
  const motivo = document.getElementById('anular-motivo').value.trim()
  cerrarModalAnular()

  const practicante = appState.practicantes[idx]
  if (!practicante) return

  // Re-validar si mientras el modal estuvo abierto ya llegó el ID definitivo de Sheets
  if (
    tipoAnulacion === 'ENTRADA' &&
    practicante.entrada &&
    practicante.entrada.idRegistro &&
    !practicante.entrada.idRegistro.startsWith('TEMP-')
  ) {
    idRegistro = practicante.entrada.idRegistro
  } else if (
    tipoAnulacion === 'SALIDA' &&
    practicante.salida &&
    practicante.salida.idRegistro &&
    !practicante.salida.idRegistro.startsWith('TEMP-')
  ) {
    idRegistro = practicante.salida.idRegistro
  } else if (
    tipoAnulacion === 'INCIDENCIA' &&
    practicante.incidencia &&
    practicante.incidencia.idRegistro &&
    !practicante.incidencia.idRegistro.startsWith('TEMP-')
  ) {
    idRegistro = practicante.incidencia.idRegistro
  }

  // Si aún tiene TEMP-, significa que el guardado anterior sigue viajando en red (menos de 1 seg).
  // Esperar brevemente (hasta 1.5 seg) a que termine de llegar el ID real de Sheets para evitar fallos
  if (String(idRegistro).startsWith('TEMP-')) {
    setSyncStatus('syncing', 'Esperando guardado previo...')
    let intentos = 0
    while (intentos < 10) {
      await new Promise((r) => setTimeout(r, 150))
      intentos++
      const pActual = appState.practicantes[idx]
      if (!pActual) break
      let idActual = ''
      if (tipoAnulacion === 'ENTRADA' && pActual.entrada)
        idActual = pActual.entrada.idRegistro
      else if (tipoAnulacion === 'SALIDA' && pActual.salida)
        idActual = pActual.salida.idRegistro
      else if (tipoAnulacion === 'INCIDENCIA' && pActual.incidencia)
        idActual = pActual.incidencia.idRegistro

      if (idActual && !idActual.startsWith('TEMP-')) {
        idRegistro = idActual
        break
      }
    }
  }

  const estadoAnterior = JSON.parse(JSON.stringify(practicante))

  if (tipoAnulacion === 'SALIDA') {
    if (practicante.salida && practicante.entrada) {
      const minutosSesion = calcularMinutosEntreHoras(
        practicante.salida.hora,
        practicante.entrada.hora,
      )
      practicante.minutosSemanaTotal = Math.max(
        0,
        (practicante.minutosSemanaTotal || 0) - minutosSesion,
      )
    }
    practicante.salida = null
    const ahoraStr = new Date().toLocaleTimeString('es-PE', { hour12: false })
    if (practicante.entrada) {
      practicante.minutosHoy = calcularMinutosEntreHoras(
        ahoraStr,
        practicante.entrada.hora,
      )
    }
    actualizarDesgloseSemanalEnMemoria(idPracticante, 'ANULAR_SALIDA')
  } else if (tipoAnulacion === 'ENTRADA') {
    practicante.entrada = null
    practicante.salida = null
    practicante.minutosHoy = 0
    actualizarDesgloseSemanalEnMemoria(idPracticante, 'ANULAR_ENTRADA')
  } else if (tipoAnulacion === 'INCIDENCIA') {
    practicante.incidencia = null
    actualizarDesgloseSemanalEnMemoria(idPracticante, 'ANULAR_INCIDENCIA')
  }

  renderizarTodo()
  setSyncStatus('syncing', 'Anulando...')

  const supervisorId =
    appState.supervisor && appState.supervisor.idSupervisor
      ? appState.supervisor.idSupervisor
      : appState.supervisor
        ? appState.supervisor.usuario
        : 'Supervisor'
  const supervisorNombre =
    appState.supervisor && appState.supervisor.nombre
      ? appState.supervisor.nombre
      : appState.supervisor
        ? appState.supervisor.usuario
        : supervisorId

  try {
    await llamarAppsScript(
      {
        accion: 'anular',
        idRegistro: idRegistro,
        motivo: motivo || 'Anulado por supervisor',
        registradoPor: supervisorId,
        nombreSupervisor: supervisorNombre,
      },
      false,
    )

    setSyncStatus('success', 'Marcación anulada ✔')
  } catch (err) {
    appState.practicantes[idx] = estadoAnterior
    if (tipoAnulacion === 'SALIDA') {
      actualizarDesgloseSemanalEnMemoria(idPracticante, 'SALIDA', {
        hora: estadoAnterior.salida ? estadoAnterior.salida.hora : '',
        minutosSesion: estadoAnterior.minutosHoy || 0,
      })
    } else if (tipoAnulacion === 'ENTRADA') {
      actualizarDesgloseSemanalEnMemoria(idPracticante, 'ENTRADA', {
        hora: estadoAnterior.entrada ? estadoAnterior.entrada.hora : '',
      })
    }
    renderizarTodo()
    setSyncStatus('error', 'Error al anular')
    mostrarToast('Error al anular en Sheets: ' + err.message, 'error')
  }
}

// ==========================================================
// INCIDENCIAS / AUSENCIAS
// ==========================================
function abrirModalIncidencia(idPracticante, idx, nombrePracticante) {
  appState.pendienteIncidencia = {
    idPracticante,
    idx,
    nombrePracticante: nombrePracticante || idPracticante,
  }
  document.getElementById('incidencia-desc').textContent =
    `Registrar falta o inasistencia para: ${nombrePracticante || idPracticante}.`
  document.getElementById('incidencia-obs').value = ''
  actualizarInfoTipoIncidencia()
  document.getElementById('modal-incidencia').classList.remove('hidden')
}

function cerrarModalIncidencia() {
  appState.pendienteIncidencia = null
  document.getElementById('modal-incidencia').classList.add('hidden')
}

function actualizarInfoTipoIncidencia() {
  const select = document.getElementById('incidencia-tipo')
  const box = document.getElementById('incidencia-tipo-desc-box')
  if (!select || !box) return

  const valor = select.value
  const descripciones = {
    PERMISO_AUTORIZADO: {
      clase: 'computa',
      icono: '✔',
      titulo: 'Computa horas completas',
      texto:
        'Cubre el 100% de la meta diaria (ej. 4h 30m). No perjudica el saldo semanal ni genera déficit.',
    },
    DESCANSO_MEDICO: {
      clase: 'computa',
      icono: '✔',
      titulo: 'Justificación médica (Computa horas)',
      texto:
        'Constancia formal de salud. Las horas de la jornada se computan como cumplidas en el reporte semanal.',
    },
    FALTA_INJUSTIFICADA: {
      clase: 'falta',
      icono: '⚠',
      titulo: 'No computa horas (0h)',
      texto:
        'Ausencia sin justificar. Genera balance negativo en el balance semanal correspondiente a la meta del día.',
    },
    PERMISO_ESTUDIOS: {
      clase: 'neutro',
      icono: 'ℹ',
      titulo: 'Constancia académica (0h)',
      texto:
        'Queda asentado el motivo académico en la auditoría, pero no suma horas al balance semanal.',
    },
  }

  const info = descripciones[valor] || descripciones.PERMISO_AUTORIZADO
  box.className = `incidencia-helper-box ${info.clase}`
  box.innerHTML = `
    <span class="helper-icon">${info.icono}</span>
    <div>
      <strong>${info.titulo}:</strong> ${info.texto}
    </div>
  `
}

async function confirmarIncidencia() {
  if (!appState.pendienteIncidencia) return

  const { idPracticante, idx } = appState.pendienteIncidencia
  const tipo = document.getElementById('incidencia-tipo').value
  const obs = document.getElementById('incidencia-obs').value.trim()
  cerrarModalIncidencia()

  const practicante = appState.practicantes[idx]
  if (!practicante) return

  const estadoAnterior = JSON.parse(JSON.stringify(practicante))

  practicante.incidencia = {
    idRegistro: 'TEMP-' + Date.now(),
    tipo: tipo,
    hora: new Date().toLocaleTimeString('es-PE', { hour12: false }),
    observacion: obs,
  }

  actualizarDesgloseSemanalEnMemoria(idPracticante, 'INCIDENCIA', {
    tipo: tipo,
  })

  renderizarTodo()
  setSyncStatus('syncing', 'Guardando...')

  const supervisorId =
    appState.supervisor && appState.supervisor.idSupervisor
      ? appState.supervisor.idSupervisor
      : appState.supervisor
        ? appState.supervisor.usuario
        : 'Supervisor'
  const supervisorNombre =
    appState.supervisor && appState.supervisor.nombre
      ? appState.supervisor.nombre
      : appState.supervisor
        ? appState.supervisor.usuario
        : supervisorId

  try {
    const res = await llamarAppsScript(
      {
        accion: 'reportar_incidencia',
        idPracticante: idPracticante,
        usuarioPracticante: idPracticante,
        tipoIncidencia: tipo,
        observacion: obs || 'Reportado por supervisor',
        registradoPor: supervisorId,
        nombreSupervisor: supervisorNombre,
      },
      false,
    )

    if (
      res &&
      res.registro &&
      res.registro.idRegistro &&
      practicante.incidencia
    ) {
      practicante.incidencia.idRegistro = res.registro.idRegistro
    }

    setSyncStatus('success', 'Incidencia guardada ✔')
  } catch (err) {
    appState.practicantes[idx] = estadoAnterior
    actualizarDesgloseSemanalEnMemoria(idPracticante, 'ANULAR_INCIDENCIA')
    renderizarTodo()
    setSyncStatus('error', 'Error al registrar')
    mostrarToast('Error al guardar en Sheets: ' + err.message, 'error')
  }
}

function toggleObservacion(tipo, idx) {
  const chk = document.getElementById(`chk-${tipo}-${idx}`)
  const obsContainer = document.getElementById(`obs-container-${tipo}-${idx}`)
  if (chk && obsContainer) {
    if (chk.checked) {
      obsContainer.classList.remove('hidden')
      const input = document.getElementById(`obs-${tipo}-${idx}`)
      if (input) input.focus()
    } else {
      obsContainer.classList.add('hidden')
    }
  }
}

function mostrarLoading(texto = 'Cargando...') {
  document.getElementById('loading-text').textContent = texto
  document.getElementById('loading-overlay').classList.remove('hidden')
}

function ocultarLoading() {
  document.getElementById('loading-overlay').classList.add('hidden')
}

function mostrarToast(mensaje, tipo = 'info') {
  const container = document.getElementById('toast-container')
  const toast = document.createElement('div')
  toast.className = `toast ${tipo}`
  toast.textContent = mensaje

  container.appendChild(toast)
  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transform = 'translateX(100%)'
    toast.style.transition = 'all 0.3s ease'
    setTimeout(() => toast.remove(), 300)
  }, 4000)
}

// ==========================================
// GESTIÓN DE CAMBIO DE CONTRASEÑA
// ==========================================

function abrirModalCambiarPassword() {
  const modal = document.getElementById('modal-cambiar-password')
  if (!modal) return
  document.getElementById('password-actual').value = ''
  document.getElementById('password-nueva').value = ''
  document.getElementById('password-confirmar').value = ''
  const errMatch = document.getElementById('password-match-error')
  if (errMatch) errMatch.classList.add('hidden')
  modal.classList.remove('hidden')
  setTimeout(() => {
    const inputActual = document.getElementById('password-actual')
    if (inputActual) inputActual.focus()
  }, 100)
}

function cerrarModalCambiarPassword() {
  const modal = document.getElementById('modal-cambiar-password')
  if (modal) modal.classList.add('hidden')
}

async function ejecutarCambioPassword(e) {
  if (e) e.preventDefault()
  if (!appState.supervisor) {
    mostrarToast('No hay sesión activa.', 'error')
    return
  }

  const pActual = document.getElementById('password-actual').value.trim()
  const pNueva = document.getElementById('password-nueva').value.trim()
  const pConfirmar = document.getElementById('password-confirmar').value.trim()
  const errMatch = document.getElementById('password-match-error')
  const btnGuardar = document.getElementById('btn-guardar-password')

  if (pNueva !== pConfirmar) {
    if (errMatch) errMatch.classList.remove('hidden')
    mostrarToast('La confirmación de la contraseña no coincide.', 'error')
    return
  }
  if (errMatch) errMatch.classList.add('hidden')

  if (pNueva.length < 6) {
    mostrarToast(
      'La nueva contraseña debe tener al menos 6 caracteres.',
      'warning',
    )
    return
  }

  if (pActual === pNueva) {
    mostrarToast(
      'La nueva contraseña no puede ser igual a la actual.',
      'warning',
    )
    return
  }

  if (btnGuardar) {
    btnGuardar.disabled = true
    btnGuardar.textContent = 'Actualizando...'
  }

  mostrarLoading('Actualizando contraseña de forma segura...')

  try {
    const res = await llamarAppsScript(
      {
        accion: 'cambiar_contrasena',
        usuario:
          appState.supervisor.idSupervisor || appState.supervisor.usuario,
        contrasenaActual: pActual,
        nuevaContrasena: pNueva,
      },
      false,
    )

    ocultarLoading()
    if (btnGuardar) {
      btnGuardar.disabled = false
      btnGuardar.textContent = 'Guardar Contraseña'
    }

    cerrarModalCambiarPassword()
    mostrarToast(
      res.message || '¡Contraseña actualizada y hasheada correctamente!',
      'success',
    )
  } catch (err) {
    ocultarLoading()
    if (btnGuardar) {
      btnGuardar.disabled = false
      btnGuardar.textContent = 'Guardar Contraseña'
    }
    mostrarToast(err.message || 'Error al cambiar la contraseña.', 'error')
  }
}
