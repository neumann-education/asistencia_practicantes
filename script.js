// ==========================================================
// 1. CONFIGURACIÓN: URL /exec DE GOOGLE APPS SCRIPT
// ==========================================================
const SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbx5VZ0HkBDLsgp8xuJod4ousnSlOViWQv0h67mb3_6ORpR9AO1druVo-C8edZjkWkNA/exec'

const STORAGE_KEY_USER = 'IBEROTECA_TOTH_USER_SESSION'
const STORAGE_KEY_SUPERVISORES = 'IBEROTECA_SUPERVISORES_CACHE'

let appState = {
  tabActual: 'hoy', // 'resumen' | 'hoy' | 'reporte' | 'auditoria'
  supervisoresDisponibles: [],
  supervisor: null,
  esAdmin: false,
  filtroSupervisor: 'TODOS',
  filtroTextoPracticante: '',
  practicantes: [],
  registrosAuditoria: [],
  auditoriaCargada: false,
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
  historicoCompletoCargando: false,
  vistaReporte: 'puntualidad', // 'puntualidad' | 'horarios'
  calendar: {
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth(),
    selectedDateStr: null,
    filtroSede: 'TODAS',
    filtroEstado: 'TODOS',
    sideFilterSearch: '',
  },
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
      appState.esAdmin = !!(
        appState.supervisor.esAdmin ||
        (appState.supervisor.rol &&
          String(appState.supervisor.rol).toLowerCase().includes('admin'))
      )
      if (appState.esAdmin) {
        appState.tabActual = 'resumen'
      }
      mostrarSplashScreen('Cargando panel de asistencia...')
      mostrarDashboard()
      recargarDatos().finally(() => {
        cambiarTab(appState.tabActual)
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

  const btnResumen = document.getElementById('tab-btn-resumen')
  const btnCalendario = document.getElementById('tab-btn-calendario')
  const btnHoy = document.getElementById('tab-btn-hoy')
  const btnReporte = document.getElementById('tab-btn-reporte')

  const panelResumen = document.getElementById('panel-resumen')
  const panelCalendario = document.getElementById('panel-calendario')
  const panelHoy = document.getElementById('panel-hoy')
  const panelReporte = document.getElementById('panel-reporte')
  const filterBar = document.getElementById('admin-filter-bar')

  // Desactivar todos los botones de tabs
  ;[btnResumen, btnCalendario, btnHoy, btnReporte].forEach((b) => {
    if (b) b.classList.remove('active')
  })
  // Ocultar todos los paneles
  ;[panelResumen, panelCalendario, panelHoy, panelReporte].forEach((p) => {
    if (p) p.classList.add('hidden')
  })

  // Alternativa 1: Ocultar barra de filtros en "Resumen General", mostrar en las demás si es admin
  if (filterBar) {
    if (appState.esAdmin && nombreTab !== 'resumen') {
      filterBar.classList.remove('hidden')
    } else {
      filterBar.classList.add('hidden')
    }
  }

  if (nombreTab === 'resumen' && appState.esAdmin) {
    if (btnResumen) btnResumen.classList.add('active')
    if (panelResumen) panelResumen.classList.remove('hidden')
    renderizarPanelResumen()
  } else if (nombreTab === 'calendario' && appState.esAdmin) {
    if (btnCalendario) btnCalendario.classList.add('active')
    if (panelCalendario) panelCalendario.classList.remove('hidden')
    renderizarPanelCalendario()
  } else if (nombreTab === 'reporte') {
    if (btnReporte) btnReporte.classList.add('active')
    if (panelReporte) panelReporte.classList.remove('hidden')
    renderizarPanelReporte()
  } else {
    // Default: 'hoy'
    if (btnHoy) btnHoy.classList.add('active')
    if (panelHoy) panelHoy.classList.remove('hidden')
    renderizarPanelHoy()
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

  mostrarSplashScreen('Autenticando usuario y cargando registros...')

  try {
    const res = await llamarAppsScript(
      { accion: 'login', usuario, contrasena },
      true,
    )
    appState.supervisor = res.supervisor
    appState.esAdmin = !!(
      res.esAdmin ||
      (res.supervisor &&
        String(res.supervisor.rol || '')
          .toLowerCase()
          .includes('admin'))
    )

    if (res.supervisores && Array.isArray(res.supervisores)) {
      appState.supervisoresDisponibles = res.supervisores
      localStorage.setItem(
        STORAGE_KEY_SUPERVISORES,
        JSON.stringify(res.supervisores),
      )
    }

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
    appState.filtroSupervisor = 'TODOS'
    appState.filtroTextoPracticante = ''
    appState.registrosAuditoria = []
    appState.auditoriaCargada = false
    appState.tabActual = appState.esAdmin ? 'resumen' : 'hoy'

    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(res.supervisor))

    const saludoRol = appState.esAdmin ? 'Administrador/a' : 'Supervisor/a'
    mostrarToast(
      `¡Bienvenido/a (${saludoRol}), ${res.supervisor.usuario}!`,
      'success',
    )
    mostrarDashboard()
    poblarSelectorSemanas()
    cambiarTab(appState.tabActual)

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
  appState.esAdmin = false
  appState.filtroSupervisor = 'TODOS'
  appState.filtroTextoPracticante = ''
  appState.practicantes = []
  appState.registrosAuditoria = []
  appState.auditoriaCargada = false
  appState.semanasDisponibles = []
  appState.semanaSeleccionadaLunes = null
  appState.practicantesReporteSemana = null
  appState.cacheReporteSemanal = {}
  appState.precargaEnCurso = false
  appState.historicoCompletoCargado = false
  localStorage.removeItem(STORAGE_KEY_USER)
  configurarInterfazSegunRol()
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
      {
        accion: 'recargar',
        usuario: appState.supervisor.usuario,
        filtroSupervisor: appState.esAdmin ? appState.filtroSupervisor : '',
      },
      true,
    )
    appState.practicantes = res.practicantes || []
    appState.feriado = res.feriado || { esFeriado: false }
    if (res.supervisor) {
      appState.supervisor = res.supervisor
      localStorage.setItem(STORAGE_KEY_SESION, JSON.stringify(res.supervisor))
    }
    if (res.supervisores && Array.isArray(res.supervisores)) {
      appState.supervisoresDisponibles = res.supervisores
      localStorage.setItem(
        STORAGE_KEY_SUPERVISORES,
        JSON.stringify(res.supervisores),
      )
    }
    actualizarUsuarioTopbar()
    if (res.semanasDisponibles && res.semanasDisponibles.length > 0) {
      appState.semanasDisponibles = res.semanasDisponibles
    }
    const semActual =
      appState.semanasDisponibles.find((s) => s.esActual) ||
      appState.semanasDisponibles[0]
    if (semActual) {
      appState.cacheReporteSemanal[semActual.lunes] = res.practicantes || []
    }
    configurarInterfazSegunRol()
    poblarSelectorSemanas()
    cambiarTab(appState.tabActual || (appState.esAdmin ? 'resumen' : 'hoy'))
    mostrarToast('Datos actualizados.', 'success')

    // Disparar precarga silenciosa de las últimas 12 semanas
    iniciarPrecargaSemanasRecientes()
  } catch (err) {
    mostrarToast(err.message || 'Error al sincronizar con Sheets', 'error')
  }
}

/**
 * Obtiene el Nombre real del supervisor o administrador actual
 */
function obtenerNombreSupervisorActual() {
  if (!appState.supervisor) return 'Supervisor'
  if (appState.supervisor.nombre && appState.supervisor.nombre.trim()) {
    return appState.supervisor.nombre.trim()
  }
  if (
    Array.isArray(appState.supervisoresDisponibles) &&
    appState.supervisoresDisponibles.length > 0
  ) {
    const sId = (appState.supervisor.idSupervisor || '').toLowerCase()
    const sUser = (appState.supervisor.usuario || '').toLowerCase()
    const match = appState.supervisoresDisponibles.find(
      (s) =>
        (s.idSupervisor && String(s.idSupervisor).toLowerCase() === sId) ||
        (s.usuario && String(s.usuario).toLowerCase() === sUser),
    )
    if (match && match.nombre && match.nombre.trim()) {
      appState.supervisor.nombre = match.nombre.trim()
      return match.nombre.trim()
    }
  }
  return appState.supervisor.usuario || 'Supervisor'
}

/**
 * Actualiza la información del usuario en la barra superior (Avatar, Nombre y Oficina)
 */
function actualizarUsuarioTopbar() {
  if (!appState.supervisor) return
  const nombreAMostrar = obtenerNombreSupervisorActual()
  const elNombre = document.getElementById('user-nombre')
  const elAvatar = document.getElementById('avatar-inicial')
  const elOficina = document.getElementById('label-oficina')

  if (elNombre) {
    elNombre.textContent = nombreAMostrar
    elNombre.title = `Usuario: ${appState.supervisor.usuario || ''} | Rol: ${appState.supervisor.rol || ''}`
  }
  if (elAvatar) {
    elAvatar.textContent = nombreAMostrar.charAt(0).toUpperCase()
  }
  if (elOficina) {
    elOficina.textContent =
      appState.supervisor.oficina || 'Innovación y Desarrollo'
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
    actualizarUsuarioTopbar()
  }

  configurarInterfazSegunRol()

  const bannerFeriado = document.getElementById('banner-feriado')
  if (appState.feriado && appState.feriado.esFeriado) {
    bannerFeriado.classList.remove('hidden')
    document.getElementById('motivo-feriado').textContent =
      appState.feriado.motivo
  } else {
    bannerFeriado.classList.add('hidden')
  }
}

function configurarInterfazSegunRol() {
  const esAdmin = !!appState.esAdmin

  const tabResumen = document.getElementById('tab-btn-resumen')
  const tabCalendario = document.getElementById('tab-btn-calendario')
  const badgeAdmin = document.getElementById('badge-rol-admin')
  const filterBar = document.getElementById('admin-filter-bar')
  const thSupervisor = document.getElementById('th-col-supervisor')

  if (esAdmin) {
    if (tabResumen) tabResumen.classList.remove('hidden')
    if (tabCalendario) tabCalendario.classList.remove('hidden')
    if (badgeAdmin) badgeAdmin.classList.remove('hidden')
    if (filterBar) {
      if (appState.tabActual !== 'resumen') {
        filterBar.classList.remove('hidden')
      } else {
        filterBar.classList.add('hidden')
      }
    }
    if (thSupervisor) thSupervisor.classList.remove('hidden')
    poblarSelectorFiltroSupervisores()
  } else {
    if (tabResumen) tabResumen.classList.add('hidden')
    if (tabCalendario) tabCalendario.classList.add('hidden')
    if (badgeAdmin) badgeAdmin.classList.add('hidden')
    if (filterBar) filterBar.classList.add('hidden')
    if (thSupervisor) thSupervisor.classList.add('hidden')
  }
}

function poblarSelectorFiltroSupervisores() {
  const select = document.getElementById('select-filtro-supervisor')
  if (!select) return

  const valorPrevio = appState.filtroSupervisor || 'TODOS'
  select.innerHTML = '<option value="TODOS">Todos los Supervisores</option>'

  const supervisores = appState.supervisoresDisponibles || []
  supervisores.forEach((s) => {
    const opt = document.createElement('option')
    opt.value = s.idSupervisor || s.usuario
    opt.textContent = `${s.nombre || s.usuario} (${s.oficina || 'General'})`
    select.appendChild(opt)
  })

  select.value = valorPrevio
}

function cambiarFiltroSupervisor(nuevoFiltro) {
  appState.filtroSupervisor = nuevoFiltro || 'TODOS'
  const select = document.getElementById('select-filtro-supervisor')
  if (select && select.value !== appState.filtroSupervisor) {
    select.value = appState.filtroSupervisor
  }

  if (appState.filtroSupervisor === 'TODOS') {
    mostrarToast('Mostrando todos los supervisores', 'info')
  } else {
    const supObj = (appState.supervisoresDisponibles || []).find(
      (s) =>
        s.idSupervisor === appState.filtroSupervisor ||
        s.usuario === appState.filtroSupervisor,
    )
    const nombre = supObj ? supObj.nombre : appState.filtroSupervisor
    mostrarToast(`Filtrando equipo de ${nombre}`, 'info')
  }

  renderizarTodo()
}

function filtrarPracticantesEnPantalla(texto) {
  appState.filtroTextoPracticante = (texto || '').trim().toLowerCase()
  const btnClear = document.getElementById('btn-limpiar-busqueda-p')
  if (btnClear) {
    btnClear.style.display = appState.filtroTextoPracticante ? 'block' : 'none'
  }
  renderizarTodo()
}

function limpiarBusquedaPracticantes() {
  const input = document.getElementById('input-busqueda-practicante')
  if (input) input.value = ''
  filtrarPracticantesEnPantalla('')
}

function actualizarContadorPracticantes(visibles, totales) {
  const el = document.getElementById('admin-contador-practicantes')
  if (!el || !appState.esAdmin) return

  if (visibles === totales) {
    el.textContent = `${totales} practicantes`
  } else {
    el.textContent = `Mostrando ${visibles} de ${totales}`
  }
}

function obtenerPracticantesFiltradosPorSupervisorYTexto(lista) {
  if (!lista || !Array.isArray(lista)) return []

  const filtroSup = (appState.filtroSupervisor || 'TODOS').trim().toLowerCase()
  const filtroTxt = (appState.filtroTextoPracticante || '').trim().toLowerCase()

  return lista.filter((p) => {
    // 1. Filtro por supervisor (si es admin y no es TODOS)
    if (appState.esAdmin && filtroSup !== 'todos') {
      const pSupId = String(p.supervisor || '')
        .trim()
        .toLowerCase()
      const pSupNom = String(p.supervisorNombre || '')
        .trim()
        .toLowerCase()
      const pSupAsig = String(p.supervisorAsignado || '')
        .trim()
        .toLowerCase()
      const coincideSup =
        pSupId === filtroSup ||
        pSupNom === filtroSup ||
        pSupAsig === filtroSup ||
        (p.supervisor && String(p.supervisor).toLowerCase().includes(filtroSup))
      if (!coincideSup) return false
    }

    // 2. Filtro por texto de búsqueda
    if (filtroTxt) {
      const nom = String(p.nombre || '').toLowerCase()
      const usr = String(p.usuario || '').toLowerCase()
      const id = String(p.idPracticante || '').toLowerCase()
      const sup = String(p.supervisorNombre || p.supervisor || '').toLowerCase()
      const ofi = String(p.oficina || '').toLowerCase()
      const coincideTxt =
        nom.includes(filtroTxt) ||
        usr.includes(filtroTxt) ||
        id.includes(filtroTxt) ||
        sup.includes(filtroTxt) ||
        ofi.includes(filtroTxt)
      if (!coincideTxt) return false
    }

    return true
  })
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
  if (appState.tabActual === 'resumen' && appState.esAdmin) {
    renderizarPanelResumen()
  } else if (appState.tabActual === 'calendario' && appState.esAdmin) {
    renderizarPanelCalendario()
  } else if (appState.tabActual === 'hoy') {
    renderizarPanelHoy()
  } else if (appState.tabActual === 'reporte') {
    renderizarPanelReporte()
  } else {
    renderizarPanelHoy()
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
  if (!contenedor) return
  contenedor.innerHTML = ''

  const listaBase = appState.practicantes || []
  const listaFiltrada =
    obtenerPracticantesFiltradosPorSupervisorYTexto(listaBase)
  actualizarContadorPracticantes(listaFiltrada.length, listaBase.length)

  if (listaBase.length === 0) {
    contenedor.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; background: white; border-radius: var(--radius-lg); border: 1px dashed var(--slate-300);">
            <h3 style="color: var(--slate-700); margin-bottom: 4px;">No hay practicantes asignados</h3>
            <p style="color: var(--slate-500); font-size: 0.85rem;">Verifica la columna Supervisor_Asignado en tu Google Sheet.</p>
          </div>
        `
    return
  }

  if (listaFiltrada.length === 0) {
    contenedor.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; background: white; border-radius: var(--radius-lg); border: 1px dashed var(--slate-300);">
            <h3 style="color: var(--slate-700); margin-bottom: 4px;">No se encontraron practicantes</h3>
            <p style="color: var(--slate-500); font-size: 0.85rem;">Ningún practicante coincide con los filtros de búsqueda o supervisor seleccionados.</p>
          </div>
        `
    return
  }

  const esFeriadoBloqueante =
    appState.feriado && appState.feriado.esFeriado && !appState.forzarFeriado

  listaFiltrada.forEach((p) => {
    const idxEncontrado = appState.practicantes.findIndex(
      (item) =>
        (item.idPracticante && item.idPracticante === p.idPracticante) ||
        item.usuario === p.usuario ||
        item.nombre === p.nombre,
    )
    const idx = idxEncontrado >= 0 ? idxEncontrado : 0

    const tieneEntrada = !!p.entrada
    const tieneSalida = !!p.salida
    const tieneIncidencia = !!p.incidencia
    const metaDiariaMin = p.metaDiariaMinutos || 240

    // Badge de Supervisor si es Administrador
    let supBadgeHtml = ''
    if (appState.esAdmin) {
      supBadgeHtml = `
        <div class="card-supervisor-badge" title="Supervisor asignado: ${p.supervisorNombre || p.supervisor || 'General'}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
          </svg>
          <span>Sup: ${p.supervisorNombre || p.supervisor || 'General'}</span>
        </div>
      `
    }

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
            <button class="btn-footer-action secondary" onclick="abrirEdicionJornadaHoy('${p.idPracticante || p.usuario}')" title="Corregir horario de hoy">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
              <span>Corregir horario</span>
            </button>
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
            <button class="btn-footer-action secondary" onclick="abrirEdicionJornadaHoy('${p.idPracticante || p.usuario}')" title="Corregir horario de entrada">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
              <span>Corregir entrada</span>
            </button>
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
            <button class="btn-footer-action secondary" onclick="abrirEdicionJornadaHoy('${p.idPracticante || p.usuario}')" title="Asentar o corregir horario real">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
              <span>Asentar horario</span>
            </button>
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
              ${supBadgeHtml}
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
        filtroSupervisor: appState.esAdmin ? appState.filtroSupervisor : '',
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
        filtroSupervisor: appState.esAdmin ? appState.filtroSupervisor : '',
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

  // Sincronizar columna supervisor en tabla
  const thSupervisor = document.getElementById('th-col-supervisor')
  if (thSupervisor) {
    if (appState.esAdmin) {
      thSupervisor.classList.remove('hidden')
    } else {
      thSupervisor.classList.add('hidden')
    }
  }

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

  const listaPracticantesBase =
    appState.practicantesReporteSemana || appState.practicantes || []
  const listaPracticantes = obtenerPracticantesFiltradosPorSupervisorYTexto(
    listaPracticantesBase,
  )
  actualizarContadorPracticantes(
    listaPracticantes.length,
    listaPracticantesBase.length,
  )

  if (!listaPracticantes || listaPracticantes.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="${appState.esAdmin ? 11 : 10}" style="text-align: center; padding: 36px; color: var(--slate-400);">
          No se encontraron practicantes para la semana y filtros seleccionados.
        </td>
      </tr>
    `
    return
  }

  // Actualizar los encabezados de los días con sus fechas
  const thDiaIds = ['th-lun', 'th-mar', 'th-mie', 'th-jue', 'th-vie']
  const primerDesglose = listaPracticantes[0]?.desgloseSemanal
  if (primerDesglose && primerDesglose.length === 5) {
    const nombresDiasBase = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie']
    primerDesglose.forEach((dia, i) => {
      const thEl =
        document.getElementById(thDiaIds[i]) ||
        document.getElementById(`th-dia-${i}`)
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

    const celdaSupervisorHtml = appState.esAdmin
      ? `<td><span class="card-supervisor-badge" style="font-size: 0.75rem;">${p.supervisorNombre || p.supervisorAsignado || p.supervisor || 'General'}</span></td>`
      : ''

    const tr = document.createElement('tr')
    tr.innerHTML = `
          <td><strong>${p.nombre || p.usuario}</strong></td>
          ${celdaSupervisorHtml}
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
// RENDERIZADO: PANEL 0 - RESUMEN GENERAL (ADMINISTRADOR)
// ==========================================================
function renderizarPanelResumen() {
  if (!appState.esAdmin) return

  const practicantesHoy = appState.practicantes || []
  const practicantesSemana =
    appState.practicantesReporteSemana &&
    appState.practicantesReporteSemana.length > 0
      ? appState.practicantesReporteSemana
      : practicantesHoy

  // 1. KPI Practicantes Activos Totales
  const elTotal = document.getElementById('admin-kpi-total-practicantes')
  if (elTotal) elTotal.textContent = practicantesHoy.length

  // 2. KPI Presentes Hoy en Oficina (con entrada registrada y sin salida)
  const presentesHoy = practicantesHoy.filter(
    (p) => p.entrada && !p.salida,
  ).length
  const elPresentes = document.getElementById('admin-kpi-presentes-hoy')
  if (elPresentes) elPresentes.textContent = presentesHoy

  // 3. KPI Horas Trabajadas Globales en la Semana
  let sumaMinutosGlobal = 0
  let sumaMetasGlobal = 0
  practicantesSemana.forEach((p) => {
    sumaMinutosGlobal += p.minutosSemanaTotal || 0
    sumaMetasGlobal += p.metaSemanalMinutos || 1200
  })

  const elHorasGlobal = document.getElementById('admin-kpi-horas-globales')
  if (elHorasGlobal) {
    elHorasGlobal.textContent = formatearMinutos(sumaMinutosGlobal)
  }

  // 4. KPI Cumplimiento Global de Metas
  const pctGlobal =
    sumaMetasGlobal > 0
      ? Math.round((sumaMinutosGlobal / sumaMetasGlobal) * 100)
      : 0
  const elPctGlobal = document.getElementById('admin-kpi-cumplimiento-global')
  if (elPctGlobal) {
    elPctGlobal.textContent = `${pctGlobal}%`
  }

  // 5. Cuadrícula de Tarjetas por Supervisor
  renderizarTarjetasSupervisores(practicantesHoy, practicantesSemana)
}

function renderizarTarjetasSupervisores(practicantesHoy, practicantesSemana) {
  const gridContainer = document.getElementById('grid-supervisores-cards')
  if (!gridContainer) return

  gridContainer.innerHTML = ''
  const supervisores = appState.supervisoresDisponibles || []

  if (supervisores.length === 0) {
    gridContainer.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 36px; background: white; border-radius: var(--radius-lg); border: 1px dashed var(--slate-300); color: var(--slate-400);">
        No hay supervisores disponibles en la lista sincronizada.
      </div>
    `
    return
  }

  supervisores.forEach((sup) => {
    const sId = String(sup.idSupervisor || sup.usuario || '')
      .trim()
      .toLowerCase()
    const sNom = String(sup.nombre || sup.usuario || '')
      .trim()
      .toLowerCase()

    // Practicantes a cargo de este supervisor en la jornada de hoy
    const misPracticantesHoy = practicantesHoy.filter((p) => {
      const pSup = String(p.supervisor || '')
        .trim()
        .toLowerCase()
      const pNom = String(p.supervisorNombre || '')
        .trim()
        .toLowerCase()
      const pAsig = String(p.supervisorAsignado || '')
        .trim()
        .toLowerCase()
      return (
        pSup === sId ||
        pNom === sNom ||
        pAsig === sId ||
        pAsig === sNom ||
        pSup === sNom
      )
    })

    // Practicantes a cargo de este supervisor en el balance semanal
    const misPracticantesSemana = practicantesSemana.filter((p) => {
      const pSup = String(p.supervisor || '')
        .trim()
        .toLowerCase()
      const pNom = String(p.supervisorNombre || '')
        .trim()
        .toLowerCase()
      const pAsig = String(p.supervisorAsignado || '')
        .trim()
        .toLowerCase()
      return (
        pSup === sId ||
        pNom === sNom ||
        pAsig === sId ||
        pAsig === sNom ||
        pSup === sNom
      )
    })

    const totalPracticantes = misPracticantesHoy.length
    const presentes = misPracticantesHoy.filter(
      (p) => p.entrada && !p.salida,
    ).length

    let minSemana = 0
    let metaSemana = 0
    misPracticantesSemana.forEach((p) => {
      minSemana += p.minutosSemanaTotal || 0
      metaSemana += p.metaSemanalMinutos || 1200
    })

    const pctCumplimiento =
      metaSemana > 0 ? Math.round((minSemana / metaSemana) * 100) : 0

    const inicial = (sup.nombre || sup.usuario || 'S').charAt(0).toUpperCase()
    const supIdVal = sup.idSupervisor || sup.usuario

    const card = document.createElement('div')
    card.className = 'supervisor-card'
    card.innerHTML = `
      <div class="supervisor-card-header">
        <div class="supervisor-card-user-info">
          <div class="supervisor-avatar">${inicial}</div>
          <div>
            <div class="supervisor-title-text">${sup.nombre || sup.usuario}</div>
            <div class="supervisor-sub-text">${sup.oficina || 'General'} • @${sup.usuario}</div>
          </div>
        </div>
        ${sup.esAdmin ? '<span class="badge-role-admin" style="font-size: 0.65rem;">ADMIN</span>' : ''}
      </div>

      <div class="supervisor-stats-grid">
        <div class="supervisor-stat-box">
          <div class="supervisor-stat-num">${totalPracticantes}</div>
          <div class="supervisor-stat-lbl">Practicantes</div>
        </div>
        <div class="supervisor-stat-box">
          <div class="supervisor-stat-num" style="color: #10b981;">${presentes}</div>
          <div class="supervisor-stat-lbl">En Oficina</div>
        </div>
        <div class="supervisor-stat-box">
          <div class="supervisor-stat-num" style="color: #2563eb;">${pctCumplimiento}%</div>
          <div class="supervisor-stat-lbl">Cumplimiento</div>
        </div>
      </div>

      <div class="supervisor-card-footer">
        <div style="font-size: 0.78rem; color: var(--slate-500);">
          Horas: <strong>${formatearMinutos(minSemana)}</strong>
        </div>
        <button
          type="button"
          class="btn btn-outline btn-sm btn-ver-equipo"
          onclick="enfocarEquipoSupervisor('${supIdVal}')"
          title="Ver practicantes de ${sup.nombre || sup.usuario}"
        >
          Ver Equipo ▶
        </button>
      </div>
    `
    gridContainer.appendChild(card)
  })
}

function enfocarEquipoSupervisor(idSupervisor) {
  if (!idSupervisor) return
  cambiarFiltroSupervisor(idSupervisor)
  cambiarTab('hoy')
}

// ==========================================================
// BITÁCORA DE AUDITORÍA EN TIEMPO REAL (ADMINISTRADOR)
// ==========================================================
async function cargarAuditoriaRegistros(forzar = false) {
  if (!appState.esAdmin) return
  if (appState.auditoriaCargada && !forzar) {
    renderizarTablaAuditoria()
    return
  }

  const tbody = document.getElementById('tabla-auditoria-body')
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: var(--slate-400); padding: 36px;">
          <span class="sync-spinner" style="margin-right: 8px;"></span>
          Consultando bitácora de auditoría desde Google Sheets...
        </td>
      </tr>
    `
  }

  try {
    const usuarioId =
      appState.supervisor?.idSupervisor || appState.supervisor?.usuario || ''
    const res = await llamarAppsScript(
      {
        accion: 'obtener_auditoria_registros',
        usuario: usuarioId,
        limite: 150,
      },
      false,
    )

    if (res && res.success) {
      appState.registrosAuditoria = res.registros || []
      appState.auditoriaCargada = true

      const subInfo = document.getElementById('auditoria-sub-info')
      if (subInfo) {
        const ahora = new Date().toLocaleTimeString('es-PE', { hour12: false })
        subInfo.textContent = `Mostrando los últimos ${appState.registrosAuditoria.length} registros (Actualizado ${ahora})`
      }
      renderizarTablaAuditoria()
    } else {
      throw new Error(res.error || 'No se pudo obtener la auditoría.')
    }
  } catch (err) {
    console.error('Error al cargar auditoría:', err)
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; color: var(--danger, #ef4444); padding: 32px;">
            Error al cargar auditoría: ${err.message || 'Error de conexión'}
          </td>
        </tr>
      `
    }
    mostrarToast('No se pudo cargar la bitácora de auditoría.', 'error')
  }
}

function filtrarTablaAuditoria() {
  renderizarTablaAuditoria()
}

function renderizarTablaAuditoria() {
  const tbody = document.getElementById('tabla-auditoria-body')
  if (!tbody) return

  const selectTipo = document.getElementById('filtro-auditoria-tipo')
  const inputBusqueda = document.getElementById('filtro-auditoria-busqueda')

  const filtroTipo = selectTipo ? selectTipo.value : 'TODOS'
  const filtroTexto = (inputBusqueda ? inputBusqueda.value : '')
    .trim()
    .toLowerCase()

  const registros = appState.registrosAuditoria || []

  if (registros.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: var(--slate-400); padding: 36px;">
          No hay registros de auditoría disponibles.
        </td>
      </tr>
    `
    return
  }

  const filtrados = registros.filter((r) => {
    // Filtro por tipo de evento
    if (filtroTipo !== 'TODOS') {
      const tipo = String(r.tipo || '').toUpperCase()
      const estado = String(r.estado || '').toUpperCase()
      if (filtroTipo === 'ANULADO') {
        if (estado !== 'ANULADO') return false
      } else if (filtroTipo === 'INCIDENCIA') {
        if (
          tipo !== 'INCIDENCIA' &&
          tipo !== 'PERMISO' &&
          tipo !== 'JUSTIFICACION'
        ) {
          return false
        }
      } else {
        if (tipo !== filtroTipo) return false
      }
    }

    // Filtro por texto
    if (filtroTexto) {
      const pNom = String(r.practicanteNombre || '').toLowerCase()
      const pId = String(r.practicanteId || '').toLowerCase()
      const sup = String(r.supervisorAsignado || '').toLowerCase()
      const regPor = String(
        r.registradoPorNombre || r.registradoPorId || '',
      ).toLowerCase()
      const obs = String(r.observaciones || '').toLowerCase()
      const fecha = String(r.fecha || '').toLowerCase()

      const coincide =
        pNom.includes(filtroTexto) ||
        pId.includes(filtroTexto) ||
        sup.includes(filtroTexto) ||
        regPor.includes(filtroTexto) ||
        obs.includes(filtroTexto) ||
        fecha.includes(filtroTexto)

      if (!coincide) return false
    }

    return true
  })

  if (filtrados.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: var(--slate-400); padding: 36px;">
          No se encontraron registros que coincidan con los filtros aplicados.
        </td>
      </tr>
    `
    return
  }

  tbody.innerHTML = filtrados
    .map((r) => {
      // Badge según tipo
      let badgeTipo = ''
      const tipoUpper = String(r.tipo || '').toUpperCase()
      const estadoUpper = String(r.estado || '').toUpperCase()

      if (estadoUpper === 'ANULADO') {
        badgeTipo = `<span class="badge-audit-evento badge-audit-anulado">Anulado</span>`
      } else if (tipoUpper === 'ENTRADA') {
        badgeTipo = `<span class="badge-audit-evento badge-audit-entrada">Entrada</span>`
      } else if (tipoUpper === 'SALIDA') {
        badgeTipo = `<span class="badge-audit-evento badge-audit-salida">Salida</span>`
      } else {
        badgeTipo = `<span class="badge-audit-evento badge-audit-incidencia">${r.tipo || 'Incidencia'}</span>`
      }

      // Estado badge
      let estadoBadge = ''
      if (estadoUpper === 'ANULADO') {
        estadoBadge = `<span style="color: #dc2626; font-weight: 600;">Anulado</span>`
      } else {
        estadoBadge = `<span style="color: #059669; font-weight: 600;">Activo</span>`
      }

      // Modo badge
      const modoStr = String(r.modo || 'REAL').toUpperCase()
      let modoBadge = `<span class="cell-pill cell-pending">${modoStr}</span>`
      if (modoStr === 'OFICIAL') {
        modoBadge = `<span class="cell-pill cell-current">Oficial</span>`
      } else if (modoStr === 'REAL') {
        modoBadge = `<span class="cell-pill cell-completed">Real</span>`
      }

      // Formateo de fecha y hora
      const fechaStr = r.fecha || '--'
      const horaStr = r.hora ? formatearHoraSinSegundos(r.hora) : '--'

      return `
        <tr ${estadoUpper === 'ANULADO' ? 'style="opacity: 0.7; background: #fffaf0;"' : ''}>
          <td>
            <div style="font-weight: 600; color: var(--slate-800);">${fechaStr}</div>
            <div style="font-size: 0.75rem; color: var(--slate-400);">${horaStr}</div>
          </td>
          <td>
            <div style="font-weight: 600; color: var(--slate-800);">${r.practicanteNombre || r.practicanteId}</div>
            <div style="font-size: 0.75rem; color: var(--slate-400);">${r.practicanteId || ''}</div>
          </td>
          <td>
            <span class="card-supervisor-badge" style="font-size: 0.72rem;">
              ${r.supervisorAsignado || 'General'}
            </span>
          </td>
          <td style="text-align: center;">${badgeTipo}</td>
          <td style="text-align: center;">${modoBadge}</td>
          <td>
            <div style="font-size: 0.82rem; font-weight: 600; color: var(--slate-700);">
              ${r.registradoPorNombre || r.registradoPorId || '--'}
            </div>
          </td>
          <td style="text-align: center; font-size: 0.82rem; color: var(--slate-600);">
            ${r.horasTrabajadas ? `${r.horasTrabajadas}` : '--'}
          </td>
          <td style="text-align: center; font-size: 0.82rem;">
            ${estadoBadge}
          </td>
          <td style="font-size: 0.8rem; color: var(--slate-600); max-width: 220px;">
            <div>${r.observaciones || '<span style="color: var(--slate-300);">--</span>'}</div>
            ${
              estadoUpper !== 'ANULADO' && r.practicanteId && r.fecha
                ? `<div style="margin-top: 5px;">
                    <button type="button" class="btn btn-outline btn-xs" style="padding: 2px 7px; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 4px;" onclick="abrirModalDetalleJornada('${r.practicanteId}', '${r.fecha}')" title="Ver jornada o corregir horario">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                      </svg>
                      Ver / Editar
                    </button>
                   </div>`
                : ''
            }
          </td>
        </tr>
      `
    })
    .join('')
}

// ==========================================================
// EXPORTACIÓN A CSV (REPORTE SEMANAL)
// ==========================================================
function exportarReporteSemanalCSV() {
  const listaBase =
    appState.practicantesReporteSemana &&
    appState.practicantesReporteSemana.length > 0
      ? appState.practicantesReporteSemana
      : appState.practicantes || []

  const listaFiltrada =
    obtenerPracticantesFiltradosPorSupervisorYTexto(listaBase)

  if (!listaFiltrada || listaFiltrada.length === 0) {
    mostrarToast(
      'No hay datos disponibles para exportar con los filtros actuales.',
      'warning',
    )
    return
  }

  // Obtener nombres de días de la semana y fechas
  const nombresDias = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']
  const fechasDias = ['', '', '', '', '']
  const primerDesglose = listaFiltrada[0]?.desgloseSemanal
  if (primerDesglose && primerDesglose.length === 5) {
    primerDesglose.forEach((d, i) => {
      if (d.fecha) fechasDias[i] = ` (${d.fecha})`
    })
  }

  // Construir columnas del encabezado
  const columnas = [
    'Practicante',
    'ID / Usuario',
    'Supervisor Asignado',
    'Oficina',
    'Horario Oficial',
    `${nombresDias[0]}${fechasDias[0]}`,
    `${nombresDias[1]}${fechasDias[1]}`,
    `${nombresDias[2]}${fechasDias[2]}`,
    `${nombresDias[3]}${fechasDias[3]}`,
    `${nombresDias[4]}${fechasDias[4]}`,
    'Total Horas Trabajadas',
    'Meta Semanal',
    'Saldo Horas',
  ]

  const escaparCSV = (val) => {
    if (val === null || val === undefined) return '""'
    const str = String(val).replace(/"/g, '""')
    return `"${str}"`
  }

  const filas = []
  filas.push(columnas.map(escaparCSV).join(','))

  listaFiltrada.forEach((p) => {
    const horarioStr = `${formatearHoraSinSegundos(p.horaEntradaOficial)} - ${formatearHoraSinSegundos(p.horaSalidaOficial)}`
    const desglose = p.desgloseSemanal || []

    const celdasDias = [0, 1, 2, 3, 4].map((i) => {
      const d = desglose[i]
      if (!d) return '--'
      if (
        d.estado === 'COMPLETADO' ||
        d.estado === 'PERMISO_COMPUTADO' ||
        d.estado === 'FERIADO'
      ) {
        const hRealEntrada = d.horaEntradaReal
          ? ` (E: ${formatearHoraSinSegundos(d.horaEntradaReal)}`
          : ''
        const hRealSalida = d.horaSalidaReal
          ? ` S: ${formatearHoraSinSegundos(d.horaSalidaReal)})`
          : hRealEntrada
            ? ')'
            : ''
        return `${formatearMinutos(d.minutos || 0)}${hRealEntrada}${hRealSalida}`
      }
      if (d.estado === 'EN_CURSO')
        return `En curso (${formatearMinutos(d.minutos || 0)})`
      if (d.estado === 'FALTA') return 'Falta (0h 00m)'
      return '--'
    })

    const totalSemanaStr = formatearMinutos(p.minutosSemanaTotal || 0)
    const metaSemanaStr = formatearMinutos(p.metaSemanalMinutos || 1200)
    const saldoMin = p.saldoSemanalMinutos || 0
    const saldoStr =
      saldoMin > 0
        ? `+${formatearMinutos(saldoMin)}`
        : saldoMin < 0
          ? `-${formatearMinutos(Math.abs(saldoMin))}`
          : 'Al día'

    const fila = [
      p.nombre || p.usuario,
      p.idPracticante || p.usuario,
      p.supervisorNombre || p.supervisorAsignado || p.supervisor || 'General',
      p.oficina || 'General',
      horarioStr,
      celdasDias[0],
      celdasDias[1],
      celdasDias[2],
      celdasDias[3],
      celdasDias[4],
      totalSemanaStr,
      metaSemanaStr,
      saldoStr,
    ]

    filas.push(fila.map(escaparCSV).join(','))
  })

  // Generar Blob con BOM UTF-8 (\uFEFF) para compatibilidad con Microsoft Excel
  const contenidoCSV = '\uFEFF' + filas.join('\r\n')
  const blob = new Blob([contenidoCSV], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const semObj = (appState.semanasDisponibles || []).find(
    (s) => s.lunes === appState.semanaSeleccionadaLunes,
  )
  const semanaNombre = (
    semObj?.label ||
    appState.semanaSeleccionadaLunes ||
    'Actual'
  ).replace(/[^a-zA-Z0-9_-]/g, '_')

  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', `Reporte_Asistencia_${semanaNombre}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  mostrarToast('Reporte CSV descargado exitosamente.', 'success')
}

// ==========================================================
// CALENDARIO MENSUAL DE ASISTENCIA (ADMINISTRADOR)
// ==========================================================

const MESES_NOMBRES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

const MESES_CORTOS = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
]

/**
 * Obtiene la fecha de hoy en formato ISO YYYY-MM-DD
 */
function obtenerFechaHoyISO() {
  const ahora = new Date()
  const y = ahora.getFullYear()
  const m = String(ahora.getMonth() + 1).padStart(2, '0')
  const d = String(ahora.getDate()).padStart(2, '0')
  return appState.fechaHoy || `${y}-${m}-${d}`
}

/**
 * Carga todo el archivo histórico restante del sistema en segundo plano
 * Se dispara una sola vez cuando el administrador consulta cualquier mes no precargado
 */
async function asegurarHistoricoCompleto() {
  if (appState.historicoCompletoCargado || appState.historicoCompletoCargando)
    return

  appState.historicoCompletoCargando = true
  const spinnerCal = document.getElementById('cal-loading-spinner')
  if (spinnerCal) spinnerCal.classList.remove('hidden')
  mostrarLoading('Cargando archivo histórico completo de asistencias...')

  try {
    const usuarioSup =
      appState.supervisor?.idSupervisor || appState.supervisor?.usuario || ''
    const res = await llamarAppsScript(
      {
        accion: 'obtener_reporte_historico_completo',
        usuario: usuarioSup,
        filtroSupervisor: appState.esAdmin ? appState.filtroSupervisor : '',
        excluirFechasLunes: Object.keys(appState.cacheReporteSemanal || {}),
      },
      false,
    )

    if (res && res.success) {
      if (res.semanas) {
        Object.assign(appState.cacheReporteSemanal, res.semanas)
      }
      if (res.semanasDisponibles && res.semanasDisponibles.length > 0) {
        appState.semanasDisponibles = res.semanasDisponibles
      }
      appState.historicoCompletoCargado = true
      mostrarToast('Archivo histórico completo cargado.', 'success')
    }
  } catch (err) {
    console.error('Error al cargar archivo histórico:', err)
    mostrarToast('No se pudo cargar todo el archivo histórico.', 'warning')
  } finally {
    ocultarLoading()
    appState.historicoCompletoCargando = false
    if (spinnerCal) spinnerCal.classList.add('hidden')
  }
}

/**
 * Verifica si las semanas de un mes están en caché.
 * Si falta alguna, descarga el histórico completo de una sola vez.
 */
async function verificarYCargarHistoricoParaMes(anio, mesIndex) {
  if (appState.historicoCompletoCargado) return

  const totalDias = new Date(anio, mesIndex + 1, 0).getDate()
  let faltaSemana = false

  for (let d = 1; d <= totalDias; d += 7) {
    const fecha = new Date(anio, mesIndex, d)
    const diaSem = fecha.getDay()
    const diffLunes = fecha.getDate() - diaSem + (diaSem === 0 ? -6 : 1)
    const lunes = new Date(fecha.setDate(diffLunes))
    const y = lunes.getFullYear()
    const m = String(lunes.getMonth() + 1).padStart(2, '0')
    const dia = String(lunes.getDate()).padStart(2, '0')
    const lunesStr = `${y}-${m}-${dia}`

    if (!appState.cacheReporteSemanal[lunesStr]) {
      faltaSemana = true
      break
    }
  }

  if (faltaSemana) {
    await asegurarHistoricoCompleto()
  }
}

/**
 * Navega adelante o atrás en los meses del calendario
 */
async function cambiarMesCalendario(delta) {
  let nuevoMes = appState.calendar.currentMonth + delta
  let nuevoAnio = appState.calendar.currentYear

  if (nuevoMes < 0) {
    nuevoMes = 11
    nuevoAnio -= 1
  } else if (nuevoMes > 11) {
    nuevoMes = 0
    nuevoAnio += 1
  }

  appState.calendar.currentYear = nuevoAnio
  appState.calendar.currentMonth = nuevoMes
  appState.calendar.selectedDateStr = null

  await verificarYCargarHistoricoParaMes(nuevoAnio, nuevoMes)
  renderizarPanelCalendario()
}

/**
 * Selecciona un mes específico desde la tira interactiva de 12 meses
 */
async function seleccionarMesCalendario(mesIndex) {
  appState.calendar.currentMonth = mesIndex
  appState.calendar.selectedDateStr = null

  await verificarYCargarHistoricoParaMes(
    appState.calendar.currentYear,
    mesIndex,
  )
  renderizarPanelCalendario()
}

/**
 * Vuelve al mes actual y selecciona la jornada de hoy
 */
function irAMesActualCalendario() {
  const hoy = new Date()
  appState.calendar.currentYear = hoy.getFullYear()
  appState.calendar.currentMonth = hoy.getMonth()
  appState.calendar.selectedDateStr = obtenerFechaHoyISO()
  renderizarPanelCalendario()
}

/**
 * Selecciona un día del calendario para aislarlo en la lista lateral
 */
function seleccionarDiaCalendario(fechaStr) {
  appState.calendar.selectedDateStr = fechaStr
  renderizarPanelCalendario()
}

/**
 * Recopila todas las jornadas de un mes desde el caché de semanas y la memoria en vivo
 */
function recopilarJornadasMes(anio, mesIndex) {
  const mapaDias = {}
  const prefijoMes = `${anio}-${String(mesIndex + 1).padStart(2, '0')}`

  // 1. Recorrer semanas en caché
  const semanasCache = Object.values(appState.cacheReporteSemanal || {})

  semanasCache.forEach((listaPracticantes) => {
    if (!Array.isArray(listaPracticantes)) return

    listaPracticantes.forEach((p) => {
      if (!p.desgloseSemanal || !Array.isArray(p.desgloseSemanal)) return

      p.desgloseSemanal.forEach((d) => {
        if (!d.fecha || !d.fecha.startsWith(prefijoMes)) return

        if (!mapaDias[d.fecha]) {
          mapaDias[d.fecha] = []
        }

        const claveP = p.idPracticante || p.usuario
        const yaExiste = mapaDias[d.fecha].some(
          (item) =>
            (item.practicante.idPracticante || item.practicante.usuario) ===
            claveP,
        )

        if (!yaExiste) {
          mapaDias[d.fecha].push({
            practicante: p,
            dia: d,
          })
        }
      })
    })
  })

  // 2. Sincronizar jornada de hoy en vivo si corresponde a este mes
  const hoy = new Date()
  if (hoy.getFullYear() === anio && hoy.getMonth() === mesIndex) {
    const hoyISO = obtenerFechaHoyISO()
    if (appState.practicantes && appState.practicantes.length > 0) {
      if (!mapaDias[hoyISO]) mapaDias[hoyISO] = []

      appState.practicantes.forEach((p) => {
        const claveP = p.idPracticante || p.usuario
        const idx = mapaDias[hoyISO].findIndex(
          (item) =>
            (item.practicante.idPracticante || item.practicante.usuario) ===
            claveP,
        )

        let estadoHoy = 'PENDIENTE'
        if (p.incidencia) {
          estadoHoy =
            p.incidencia.tipo === 'PERMISO_AUTORIZADO' ||
            p.incidencia.tipo === 'DESCANSO_MEDICO'
              ? 'PERMISO_COMPUTADO'
              : 'FALTA'
        } else if (p.entrada && p.salida) {
          estadoHoy = 'COMPLETADO'
        } else if (p.entrada && !p.salida) {
          estadoHoy = 'EN_CURSO'
        }

        const diaHoyObj = (p.desgloseSemanal || []).find(
          (d) => d.fecha === hoyISO,
        ) || {
          fecha: hoyISO,
          diaNombre: 'Hoy',
          minutos: p.minutosHoy || 0,
          estado: estadoHoy,
          horaEntradaReal: p.entrada ? p.entrada.hora : null,
          horaSalidaReal: p.salida ? p.salida.hora : null,
          entrada: p.entrada || null,
          salida: p.salida || null,
          incidencia: p.incidencia || null,
        }

        if (idx >= 0) {
          mapaDias[hoyISO][idx] = { practicante: p, dia: diaHoyObj }
        } else {
          mapaDias[hoyISO].push({ practicante: p, dia: diaHoyObj })
        }
      })
    }
  }

  return mapaDias
}

/**
 * Obtiene la lista ordenada de Sedes / Oficinas disponibles en todo el sistema
 */
function obtenerSedesDisponibles() {
  const setSedes = new Set()
  if (Array.isArray(appState.practicantes)) {
    appState.practicantes.forEach((p) => {
      if (p.oficina && String(p.oficina).trim()) {
        setSedes.add(String(p.oficina).trim())
      }
    })
  }
  if (Array.isArray(appState.supervisoresDisponibles)) {
    appState.supervisoresDisponibles.forEach((s) => {
      if (s.oficina && String(s.oficina).trim()) {
        setSedes.add(String(s.oficina).trim())
      }
    })
  }
  const semanas = Object.values(appState.cacheReporteSemanal || {})
  semanas.forEach((lista) => {
    if (Array.isArray(lista)) {
      lista.forEach((p) => {
        if (p.oficina && String(p.oficina).trim()) {
          setSedes.add(String(p.oficina).trim())
        }
      })
    }
  })
  return Array.from(setSedes).sort((a, b) =>
    a.localeCompare(b, 'es', { sensitivity: 'base' }),
  )
}

/**
 * Clasificador unificado de Estado para filtros del Calendario
 */
function determinarEstadoFiltro(dia, practicante) {
  if (!dia) return 'OTRO'
  const estado = String(dia.estado || '').toUpperCase()

  if (estado === 'FERIADO') return 'FERIADO'
  if (
    estado === 'PERMISO_COMPUTADO' ||
    (dia.incidencia && dia.incidencia.tipo !== 'FALTA')
  ) {
    return 'PERMISO'
  }
  if (
    estado === 'FALTA' ||
    (dia.incidencia && dia.incidencia.tipo === 'FALTA')
  ) {
    return 'FALTA'
  }
  if (estado === 'EN_CURSO') return 'EN_CURSO'

  const punt = dia.puntualidad || obtenerPuntualidad(dia, practicante, 5)
  if (punt && punt.nivel === 'rojo') return 'TARDE'
  if (punt && punt.nivel === 'naranja') return 'TOLERANCIA'
  if (punt && punt.nivel === 'verde') return 'A_TIEMPO'
  if (estado === 'COMPLETADO') return 'A_TIEMPO'

  return 'OTRO'
}

/**
 * Configuración de etiquetas y opciones de Estados para el Calendario
 */
const CONFIG_ESTADOS_CALENDARIO = [
  {
    key: 'TODOS',
    label: 'Todos',
    selectLabel: 'Todos los Estados',
    siempreEnChips: true,
  },
  {
    key: 'A_TIEMPO',
    label: 'A tiempo',
    selectLabel: 'A Tiempo (Temprano)',
    siempreEnChips: true,
  },
  {
    key: 'TOLERANCIA',
    label: 'Tolerancia',
    selectLabel: 'Con Tolerancia',
    siempreEnChips: false,
  },
  {
    key: 'TARDE',
    label: 'Tardanzas',
    selectLabel: 'Tardanzas',
    siempreEnChips: true,
  },
  {
    key: 'FALTA',
    label: 'Faltas',
    selectLabel: 'Faltas / Inasistencias',
    siempreEnChips: true,
  },
  {
    key: 'PERMISO',
    label: 'Permisos',
    selectLabel: 'Permisos / Descansos',
    siempreEnChips: true,
  },
  {
    key: 'FERIADO',
    label: 'Feriados',
    selectLabel: 'Feriados',
    siempreEnChips: false,
  },
  {
    key: 'EN_CURSO',
    label: 'En curso',
    selectLabel: 'Jornadas En Curso',
    siempreEnChips: false,
  },
]

/**
 * Puebla dinámicamente las opciones del selector de Sede / Oficina
 */
function poblarSelectorSedesCalendario(mapaJornadasMes = {}) {
  const selSede = document.getElementById('filtro-cal-sede')
  if (!selSede) return

  const valorActual = (appState.calendar.filtroSede || 'TODAS').toUpperCase()
  const sedes = obtenerSedesDisponibles()

  // Contar registros por sede en el mes actual (respetando filtro de supervisor si está activo)
  const filtroSup = (appState.filtroSupervisor || 'TODOS').trim().toLowerCase()
  const conteoSedes = {}
  let totalMesSedes = 0

  Object.values(mapaJornadasMes).forEach((jornadasDia) => {
    if (!Array.isArray(jornadasDia)) return
    jornadasDia.forEach(({ practicante: p }) => {
      if (filtroSup !== 'todos') {
        const pSupId = String(p.supervisor || '')
          .trim()
          .toLowerCase()
        const pSupNom = String(p.supervisorNombre || '')
          .trim()
          .toLowerCase()
        const pSupAsig = String(p.supervisorAsignado || '')
          .trim()
          .toLowerCase()
        const coincide =
          pSupId === filtroSup ||
          pSupNom === filtroSup ||
          pSupAsig === filtroSup ||
          (p.supervisor &&
            String(p.supervisor).toLowerCase().includes(filtroSup))
        if (!coincide) return
      }
      totalMesSedes++
      const ofiNorm = (p.oficina || 'General').trim().toUpperCase()
      conteoSedes[ofiNorm] = (conteoSedes[ofiNorm] || 0) + 1
    })
  })

  let html = `<option value="TODAS">Todas las Sedes (${totalMesSedes})</option>`
  sedes.forEach((sede) => {
    const key = sede.toUpperCase()
    const cnt = conteoSedes[key] || 0
    html += `<option value="${key}">${sede} (${cnt})</option>`
  })

  selSede.innerHTML = html

  if (
    valorActual === 'TODAS' ||
    sedes.some((s) => s.toUpperCase() === valorActual)
  ) {
    selSede.value = valorActual
  } else {
    selSede.value = 'TODAS'
    appState.calendar.filtroSede = 'TODAS'
  }
}

/**
 * Puebla dinámicamente el selector de Estado y sus Tags (Chips) con conteos en tiempo real
 */
function actualizarFiltrosYChipsEstadoCalendario(mapaJornadasMes = {}) {
  const selEstado = document.getElementById('filtro-cal-estado')
  const contenedorChips = document.getElementById('cal-chips-estado')
  if (!selEstado && !contenedorChips) return

  const filtroSup = (appState.filtroSupervisor || 'TODOS').trim().toLowerCase()
  const filtroSede = (appState.calendar.filtroSede || 'TODAS')
    .trim()
    .toUpperCase()
  const valorActual = appState.calendar.filtroEstado || 'TODOS'

  // Contar estados en las jornadas del mes que coinciden con Sede y Supervisor
  const conteoEstados = {}
  let totalJornadasMes = 0

  Object.values(mapaJornadasMes).forEach((jornadasDia) => {
    if (!Array.isArray(jornadasDia)) return
    jornadasDia.forEach(({ practicante: p, dia: d }) => {
      // Filtro supervisor
      if (filtroSup !== 'todos') {
        const pSupId = String(p.supervisor || '')
          .trim()
          .toLowerCase()
        const pSupNom = String(p.supervisorNombre || '')
          .trim()
          .toLowerCase()
        const pSupAsig = String(p.supervisorAsignado || '')
          .trim()
          .toLowerCase()
        const coincide =
          pSupId === filtroSup ||
          pSupNom === filtroSup ||
          pSupAsig === filtroSup ||
          (p.supervisor &&
            String(p.supervisor).toLowerCase().includes(filtroSup))
        if (!coincide) return
      }

      // Filtro sede
      if (filtroSede !== 'TODAS') {
        const ofi = String(p.oficina || '').toUpperCase()
        if (ofi !== filtroSede && !ofi.includes(filtroSede)) return
      }

      totalJornadasMes++
      const est = determinarEstadoFiltro(d, p)
      conteoEstados[est] = (conteoEstados[est] || 0) + 1
    })
  })

  // 1. Poblar Select de Estados dinámicamente
  if (selEstado) {
    let htmlSelect = `<option value="TODOS">Todos los Estados (${totalJornadasMes})</option>`
    CONFIG_ESTADOS_CALENDARIO.forEach(({ key, selectLabel }) => {
      if (key === 'TODOS') return
      const cnt = conteoEstados[key] || 0
      htmlSelect += `<option value="${key}">${selectLabel} (${cnt})</option>`
    })
    selEstado.innerHTML = htmlSelect
    selEstado.value = valorActual
  }

  // 2. Poblar Tags / Chips interactivos dinámicamente
  if (contenedorChips) {
    let htmlChips = ''
    CONFIG_ESTADOS_CALENDARIO.forEach(({ key, label, siempreEnChips }) => {
      const cnt = key === 'TODOS' ? totalJornadasMes : conteoEstados[key] || 0
      if (siempreEnChips || cnt > 0 || valorActual === key) {
        const isActive = valorActual === key
        htmlChips += `
          <button
            type="button"
            class="chip-btn ${isActive ? 'active' : ''}"
            data-estado="${key}"
            onclick="seleccionarChipEstadoCalendario('${key}')"
            title="${label}: ${cnt} registros"
          >
            ${label} <span class="chip-count">(${cnt})</span>
          </button>
        `
      }
    })
    contenedorChips.innerHTML = htmlChips
  }
}

/**
 * Filtra las jornadas según los filtros de supervisor, sede, estado y texto
 */
function filtrarJornadas(jornadas) {
  if (!Array.isArray(jornadas)) return []

  const filtroSup = (appState.filtroSupervisor || 'TODOS').trim().toLowerCase()
  const filtroSede = (appState.calendar.filtroSede || 'TODAS')
    .trim()
    .toUpperCase()
  const filtroEst = (appState.calendar.filtroEstado || 'TODOS')
    .trim()
    .toUpperCase()
  const filtroTxt = (appState.filtroTextoPracticante || '').trim().toLowerCase()

  return jornadas.filter(({ practicante: p, dia: d }) => {
    // 1. Filtro Supervisor
    if (appState.esAdmin && filtroSup !== 'todos') {
      const pSupId = String(p.supervisor || '')
        .trim()
        .toLowerCase()
      const pSupNom = String(p.supervisorNombre || '')
        .trim()
        .toLowerCase()
      const pSupAsig = String(p.supervisorAsignado || '')
        .trim()
        .toLowerCase()
      const coincide =
        pSupId === filtroSup ||
        pSupNom === filtroSup ||
        pSupAsig === filtroSup ||
        (p.supervisor && String(p.supervisor).toLowerCase().includes(filtroSup))
      if (!coincide) return false
    }

    // 2. Filtro Sede / Oficina
    if (filtroSede !== 'TODAS') {
      const ofi = String(p.oficina || '').toUpperCase()
      if (ofi !== filtroSede && !ofi.includes(filtroSede)) return false
    }

    // 3. Filtro Estado / Incidencia (Unificado y dinámico)
    if (filtroEst !== 'TODOS') {
      const estItem = determinarEstadoFiltro(d, p)
      if (filtroEst !== estItem) return false
    }

    // 4. Filtro Texto de Búsqueda
    if (filtroTxt) {
      const nom = String(p.nombre || '').toLowerCase()
      const usr = String(p.usuario || '').toLowerCase()
      const id = String(p.idPracticante || '').toLowerCase()
      const sup = String(p.supervisorNombre || p.supervisor || '').toLowerCase()
      const ofi = String(p.oficina || '').toLowerCase()
      const coincide =
        nom.includes(filtroTxt) ||
        usr.includes(filtroTxt) ||
        id.includes(filtroTxt) ||
        sup.includes(filtroTxt) ||
        ofi.includes(filtroTxt)
      if (!coincide) return false
    }

    return true
  })
}

/**
 * Renderiza la vista completa del panel del calendario
 */
function renderizarPanelCalendario() {
  if (!appState.esAdmin) return

  const { currentYear, currentMonth, selectedDateStr } = appState.calendar

  // 1. Títulos y Badges del encabezado del calendario
  const elMonthName = document.getElementById('cal-month-name')
  const elYearText = document.getElementById('cal-year-text')
  const elBadgeCount = document.getElementById('cal-month-count-badge')

  if (elMonthName) elMonthName.textContent = MESES_NOMBRES[currentMonth]
  if (elYearText) elYearText.textContent = currentYear

  // 2. Recopilar jornadas del mes completo
  const mapaJornadasMes = recopilarJornadasMes(currentYear, currentMonth)

  // 3. Poblar y sincronizar dinámicamente Sede, Estados y Tags (Chips)
  poblarSelectorSedesCalendario(mapaJornadasMes)
  actualizarFiltrosYChipsEstadoCalendario(mapaJornadasMes)

  // 4. Mostrar u ocultar botón de restablecer filtros
  const hayFiltrosActivos =
    appState.calendar.filtroSede !== 'TODAS' ||
    appState.calendar.filtroEstado !== 'TODOS' ||
    (appState.filtroTextoPracticante &&
      appState.filtroTextoPracticante !== '') ||
    (appState.filtroSupervisor && appState.filtroSupervisor !== 'TODOS')

  const btnReset = document.getElementById('btn-reset-cal-filtros')
  if (btnReset) {
    btnReset.style.display = hayFiltrosActivos ? 'inline-flex' : 'none'
  }

  // 5. Aplicar filtros a las jornadas
  let totalJornadasMesFiltradas = 0
  const mapaJornadasFiltradas = {}

  Object.keys(mapaJornadasMes).forEach((fecha) => {
    const listaFiltrada = filtrarJornadas(mapaJornadasMes[fecha])
    mapaJornadasFiltradas[fecha] = listaFiltrada
    totalJornadasMesFiltradas += listaFiltrada.length
  })

  if (elBadgeCount) {
    elBadgeCount.textContent = `${totalJornadasMesFiltradas} jornadas`
  }
  const elContadorGeneral = document.getElementById('cal-contador-general')
  if (elContadorGeneral) {
    elContadorGeneral.textContent = `${totalJornadasMesFiltradas} registros en ${MESES_NOMBRES[currentMonth]}`
  }

  // 6. Renderizar la tira interactiva de 12 meses
  renderizarTiraMeses(currentYear, currentMonth)

  // 7. Renderizar la grilla de días del mes
  renderizarGrillaDiasCalendario(
    currentYear,
    currentMonth,
    mapaJornadasFiltradas,
    selectedDateStr,
  )

  // 8. Renderizar el listado del panel lateral ("la tabla al costado")
  renderizarListaCostadoCalendario(mapaJornadasFiltradas)
}

/**
 * Renderiza la tira interactiva de 12 meses
 */
function renderizarTiraMeses(currentYear, currentMonth) {
  const stripEl = document.getElementById('cal-months-strip')
  if (!stripEl) return

  const countsByMonth = Array(12).fill(0)
  const semanasCache = Object.values(appState.cacheReporteSemanal || {})

  semanasCache.forEach((listaPracticantes) => {
    if (!Array.isArray(listaPracticantes)) return
    listaPracticantes.forEach((p) => {
      if (!p.desgloseSemanal) return
      p.desgloseSemanal.forEach((d) => {
        if (!d.fecha) return
        const partes = d.fecha.split('-')
        const y = parseInt(partes[0], 10)
        const m = parseInt(partes[1], 10) - 1
        if (y === currentYear && m >= 0 && m < 12) {
          countsByMonth[m]++
        }
      })
    })
  })

  stripEl.innerHTML = MESES_CORTOS.map((mesCorto, idx) => {
    const isActive = idx === currentMonth
    const count = countsByMonth[idx]
    const hasData = count > 0

    return `
      <button
        type="button"
        class="cal-month-pill ${isActive ? 'active' : ''} ${hasData ? 'has-data' : ''}"
        onclick="seleccionarMesCalendario(${idx})"
        title="${MESES_NOMBRES[idx]} ${currentYear}: ${count > 0 ? `${count} jornadas registradas` : 'Sin registros en caché'}"
      >
        ${hasData ? '<span class="pill-dot"></span>' : ''}
        ${mesCorto}${count > 0 ? ` (${count})` : ''}
      </button>
    `
  }).join('')
}

/**
 * Renderiza la grilla mensual de días con sus dots de estado y tooltip nube
 */
function renderizarGrillaDiasCalendario(
  currentYear,
  currentMonth,
  mapaJornadasFiltradas,
  selectedDateStr,
) {
  const daysGridEl = document.getElementById('calendar-days-grid')
  if (!daysGridEl) return

  const hoyISO = obtenerFechaHoyISO()

  // Alineación semanal (Lunes = 0 .. Domingo = 6)
  const primerDiaSemana = new Date(currentYear, currentMonth, 1).getDay()
  const offsetLunes = (primerDiaSemana + 6) % 7
  const totalDiasEnMes = new Date(currentYear, currentMonth + 1, 0).getDate()
  const diasMesAnterior = new Date(currentYear, currentMonth, 0).getDate()

  let htmlDays = ''

  // Celdas de relleno del mes anterior
  for (let i = offsetLunes - 1; i >= 0; i--) {
    const dNum = diasMesAnterior - i
    htmlDays += `
      <div class="cal-day-cell other-month">
        <div class="day-header">
          <span class="day-number">${dNum}</span>
        </div>
      </div>
    `
  }

  // Días del mes actual
  for (let dia = 1; dia <= totalDiasEnMes; dia++) {
    const diaPad = String(dia).padStart(2, '0')
    const mesPad = String(currentMonth + 1).padStart(2, '0')
    const fechaCompletaStr = `${currentYear}-${mesPad}-${diaPad}`

    const jornadasDia = mapaJornadasFiltradas[fechaCompletaStr] || []
    const hasData = jornadasDia.length > 0
    const isSelected = selectedDateStr === fechaCompletaStr
    const isToday = fechaCompletaStr === hoyISO

    let aTiempoCount = 0
    let toleranciaCount = 0
    let tardeCount = 0
    let faltaCount = 0
    let permisoCount = 0
    let feriadoCount = 0
    let enCursoCount = 0
    const conteoSedesDia = {}

    jornadasDia.forEach(({ practicante: p, dia: d }) => {
      const estado = String(d.estado || '').toUpperCase()
      const puntNivel = d.puntualidad?.nivel || ''
      const ofi = (p.oficina || 'General').trim()
      conteoSedesDia[ofi] = (conteoSedesDia[ofi] || 0) + 1

      if (estado === 'FERIADO') {
        feriadoCount++
      } else if (
        estado === 'PERMISO_COMPUTADO' ||
        (d.incidencia && d.incidencia.tipo !== 'FALTA')
      ) {
        permisoCount++
      } else if (estado === 'FALTA') {
        faltaCount++
      } else if (estado === 'EN_CURSO') {
        enCursoCount++
      } else {
        if (puntNivel === 'rojo') {
          tardeCount++
        } else if (puntNivel === 'naranja') {
          toleranciaCount++
        } else {
          aTiempoCount++
        }
      }
    })

    // Posicionamiento inteligente del tooltip nube (evitar desbordes de pantalla)
    const colIndex = (offsetLunes + dia - 1) % 7
    let alignClass = 'align-center'
    if (colIndex <= 1) alignClass = 'align-left'
    else if (colIndex >= 5) alignClass = 'align-right'

    const posVerticalClass = dia > 14 ? 'pos-top' : 'pos-bottom'

    htmlDays += `
      <div
        class="cal-day-cell ${hasData ? 'has-data' : ''} ${isSelected ? 'selected-day' : ''} ${isToday ? 'day-today' : ''}"
        ${hasData ? `onclick="seleccionarDiaCalendario('${fechaCompletaStr}')"` : ''}
        data-date="${fechaCompletaStr}"
      >
        <div class="day-header">
          <span class="day-number">${dia}</span>
          ${hasData ? `<span class="day-article-badge">${jornadasDia.length}</span>` : ''}
        </div>

        ${
          hasData
            ? `
          <div class="day-footer">
            <div class="day-dots-wrap">
              ${aTiempoCount > 0 ? '<span class="day-dot verde" title="A tiempo"></span>' : ''}
              ${toleranciaCount > 0 ? '<span class="day-dot naranja" title="Con tolerancia"></span>' : ''}
              ${tardeCount > 0 ? '<span class="day-dot rojo" title="Tarde"></span>' : ''}
              ${faltaCount > 0 ? '<span class="day-dot rojo" title="Faltas"></span>' : ''}
              ${permisoCount > 0 || feriadoCount > 0 ? '<span class="day-dot morado" title="Permiso / Feriado"></span>' : ''}
              ${enCursoCount > 0 ? '<span class="day-dot azul pulse" title="Jornada en curso"></span>' : ''}
            </div>
          </div>

          <!-- Despliegue Blanco Nube (Tooltip interactivo al hover) -->
          <div class="cal-cloud-tooltip ${posVerticalClass} ${alignClass}">
            <div class="cloud-tip-head">
              <span class="cloud-tip-title">${dia} ${MESES_NOMBRES[currentMonth]} ${currentYear}</span>
              <span class="cloud-tip-badge">${jornadasDia.length} ${jornadasDia.length === 1 ? 'practicante' : 'practicantes'}</span>
            </div>

            <div class="cloud-tip-breakdown">
              ${
                aTiempoCount > 0
                  ? `
                <div class="cloud-tip-row">
                  <div class="cloud-tip-row-left">
                    <span class="cloud-tip-dot" style="background: #10b981;"></span>
                    <span>A tiempo:</span>
                  </div>
                  <strong class="cloud-tip-num">${aTiempoCount}</strong>
                </div>
              `
                  : ''
              }
              ${
                toleranciaCount > 0
                  ? `
                <div class="cloud-tip-row">
                  <div class="cloud-tip-row-left">
                    <span class="cloud-tip-dot" style="background: #f59e0b;"></span>
                    <span>Tolerancia:</span>
                  </div>
                  <strong class="cloud-tip-num">${toleranciaCount}</strong>
                </div>
              `
                  : ''
              }
              ${
                tardeCount > 0
                  ? `
                <div class="cloud-tip-row">
                  <div class="cloud-tip-row-left">
                    <span class="cloud-tip-dot" style="background: #ef4444;"></span>
                    <span>Tardanzas:</span>
                  </div>
                  <strong class="cloud-tip-num">${tardeCount}</strong>
                </div>
              `
                  : ''
              }
              ${
                faltaCount > 0
                  ? `
                <div class="cloud-tip-row">
                  <div class="cloud-tip-row-left">
                    <span class="cloud-tip-dot" style="background: #dc2626;"></span>
                    <span>Faltas:</span>
                  </div>
                  <strong class="cloud-tip-num">${faltaCount}</strong>
                </div>
              `
                  : ''
              }
              ${
                permisoCount > 0
                  ? `
                <div class="cloud-tip-row">
                  <div class="cloud-tip-row-left">
                    <span class="cloud-tip-dot" style="background: var(--primary);"></span>
                    <span>Permisos:</span>
                  </div>
                  <strong class="cloud-tip-num">${permisoCount}</strong>
                </div>
              `
                  : ''
              }
              ${
                feriadoCount > 0
                  ? `
                <div class="cloud-tip-row">
                  <div class="cloud-tip-row-left">
                    <span class="cloud-tip-dot" style="background: var(--primary);"></span>
                    <span>Feriado:</span>
                  </div>
                  <strong class="cloud-tip-num">${feriadoCount}</strong>
                </div>
              `
                  : ''
              }
              ${
                enCursoCount > 0
                  ? `
                <div class="cloud-tip-row">
                  <div class="cloud-tip-row-left">
                    <span class="cloud-tip-dot" style="background: #2563eb;"></span>
                    <span>En curso:</span>
                  </div>
                  <strong class="cloud-tip-num">${enCursoCount}</strong>
                </div>
              `
                  : ''
              }
            </div>

            <div class="cloud-tip-status">
              ${Object.entries(conteoSedesDia)
                .map(([ofi, cnt], idx) => {
                  const colorClase = idx % 2 === 0 ? 'verde' : 'morado'
                  return `<span class="tip-status-pill ${colorClase}">${cnt} ${ofi}</span>`
                })
                .join('')}
            </div>
          </div>
        `
            : ''
        }
      </div>
    `
  }

  // Padding de cierre de semana
  const totalCeldasActuales = offsetLunes + totalDiasEnMes
  const celdasRestantes = (7 - (totalCeldasActuales % 7)) % 7
  for (let diaSig = 1; diaSig <= celdasRestantes; diaSig++) {
    htmlDays += `
      <div class="cal-day-cell other-month">
        <div class="day-header">
          <span class="day-number">${diaSig}</span>
        </div>
      </div>
    `
  }

  daysGridEl.innerHTML = htmlDays
}

/**
 * Traduce los modos técnicos de marcación a lenguaje natural amigable
 */
function humanizarModoRegistro(modo) {
  if (!modo || modo === '--') return 'Sin registro'
  const m = String(modo).toUpperCase().trim()
  if (m === 'HORA_OFICIAL') return 'Hora Oficial Asignada'
  if (m === 'REAL') return 'Tiempo Real (En vivo)'
  if (m === 'INCIDENCIA') return 'Justificación por Incidencia'
  if (m === 'PERMISO') return 'Permiso Autorizado'
  if (m === 'FERIADO') return 'Feriado Oficial'
  if (m === 'AUTOMATICO') return 'Automático del Sistema'
  if (m === 'MANUAL') return 'Registro Manual'
  return modo
}

/**
 * Resuelve códigos de supervisores (ej. "SUP-001") al nombre real de la persona
 */
function resolverNombreSupervisor(idOrUsuario, practicante) {
  if (!idOrUsuario || idOrUsuario === '--') return 'No especificado'
  const val = String(idOrUsuario).trim()
  const valUpper = val.toUpperCase()

  if (valUpper === 'ADMIN') return 'Administrador'
  if (valUpper === 'SISTEMA') return 'Sistema Automático'

  const supervisores = appState.supervisoresDisponibles || []
  const supObj = supervisores.find(
    (s) =>
      (s.idSupervisor && s.idSupervisor.toUpperCase() === valUpper) ||
      (s.usuario && s.usuario.toUpperCase() === valUpper) ||
      (s.nombre && s.nombre.toUpperCase() === valUpper),
  )
  if (supObj && supObj.nombre) return supObj.nombre

  if (practicante) {
    if (
      practicante.idSupervisor &&
      practicante.idSupervisor.toUpperCase() === valUpper
    ) {
      return practicante.supervisorNombre || practicante.supervisor || val
    }
    if (practicante.supervisorNombre) return practicante.supervisorNombre
    if (
      practicante.supervisor &&
      !practicante.supervisor.toUpperCase().startsWith('SUP-')
    ) {
      return practicante.supervisor
    }
  }

  if (
    appState.supervisor &&
    (appState.supervisor.idSupervisor === val ||
      appState.supervisor.usuario === val)
  ) {
    return appState.supervisor.nombre || appState.supervisor.usuario
  }

  return val
}

/**
 * Renderiza la lista lateral ("la tabla al costado")
 */
function renderizarListaCostadoCalendario(mapaJornadasFiltradas) {
  const container = document.getElementById('cal-side-practicantes-list')
  const titleEl = document.getElementById('cal-side-title')
  const subtitleEl = document.getElementById('cal-side-subtitle')
  const countEl = document.getElementById('cal-side-count')

  if (!container) return

  const { selectedDateStr, currentMonth, currentYear, sideFilterSearch } =
    appState.calendar

  if (!mapaJornadasFiltradas) {
    const mapaRaw = recopilarJornadasMes(currentYear, currentMonth)
    mapaJornadasFiltradas = {}
    Object.keys(mapaRaw).forEach((fecha) => {
      mapaJornadasFiltradas[fecha] = filtrarJornadas(mapaRaw[fecha])
    })
  }

  let jornadasAMostrar = []
  let modoVista = 'dia'

  if (selectedDateStr && mapaJornadasFiltradas[selectedDateStr]) {
    jornadasAMostrar = mapaJornadasFiltradas[selectedDateStr]
    modoVista = 'dia'
  } else {
    modoVista = 'mes'
    Object.keys(mapaJornadasFiltradas).forEach((fecha) => {
      jornadasAMostrar.push(...mapaJornadasFiltradas[fecha])
    })
  }

  // Filtro de búsqueda rápida en el panel lateral
  if (sideFilterSearch) {
    const q = sideFilterSearch.toLowerCase()
    jornadasAMostrar = jornadasAMostrar.filter(({ practicante: p }) => {
      return (
        String(p.nombre || '')
          .toLowerCase()
          .includes(q) ||
        String(p.usuario || '')
          .toLowerCase()
          .includes(q) ||
        String(p.idPracticante || '')
          .toLowerCase()
          .includes(q) ||
        String(p.supervisorNombre || p.supervisor || '')
          .toLowerCase()
          .includes(q)
      )
    })
  }

  // Actualizar encabezados
  if (titleEl) {
    if (modoVista === 'dia' && selectedDateStr) {
      const partes = selectedDateStr.split('-')
      titleEl.innerHTML = `📅 Asistencia del <strong>${partes[2]}/${partes[1]}/${partes[0]}</strong>`
      if (subtitleEl)
        subtitleEl.textContent = `Mostrando practicantes con registro en este día`
    } else {
      titleEl.innerHTML = `📅 Asistencia de <strong>${MESES_NOMBRES[currentMonth]} ${currentYear}</strong>`
      if (subtitleEl)
        subtitleEl.textContent = `Selecciona un día del calendario para aislar una jornada`
    }
  }

  if (countEl) {
    countEl.textContent = jornadasAMostrar.length
  }

  if (jornadasAMostrar.length === 0) {
    container.innerHTML = `
      <div class="side-empty-state">
        <span class="side-empty-icon">📅</span>
        <strong style="color: var(--slate-700); font-size: 0.92rem;">Sin asistencias en esta vista</strong>
        <p style="font-size: 0.78rem;">
          ${
            sideFilterSearch
              ? 'No hay coincidencias con el término buscado.'
              : 'No se registraron jornadas para los filtros aplicados en esta fecha.'
          }
        </p>
      </div>
    `
    return
  }

  container.innerHTML = jornadasAMostrar
    .map(({ practicante: p, dia: d }) => {
      const punt = d.puntualidad || obtenerPuntualidad(d, p, 5)
      let puntHtml = '<span class="cell-pill cell-completed">A tiempo</span>'
      if (punt) {
        if (punt.nivel === 'naranja') {
          puntHtml = `<span class="cell-pill cell-pending">Tolerancia (+${punt.minutosTarde}m)</span>`
        } else if (punt.nivel === 'rojo') {
          puntHtml = `<span class="cell-pill cell-incident">Tarde (+${punt.minutosTarde}m)</span>`
        }
      }

      if (d.estado === 'FALTA') {
        puntHtml = '<span class="cell-pill cell-incident">Falta</span>'
      } else if (d.estado === 'PERMISO_COMPUTADO') {
        puntHtml =
          '<span class="cell-pill cell-completed">Permiso Autorizado</span>'
      } else if (d.estado === 'FERIADO') {
        puntHtml = '<span class="cell-pill cell-holiday">Feriado</span>'
      } else if (d.estado === 'EN_CURSO') {
        puntHtml = '<span class="cell-pill cell-current pulse">En curso</span>'
      }

      const hEnt = d.horaEntradaReal
        ? formatearHoraSinSegundos(d.horaEntradaReal)
        : '--'
      const hSal = d.horaSalidaReal
        ? formatearHoraSinSegundos(d.horaSalidaReal)
        : '--'
      const minutosTotal = d.minutos || 0
      const metaDiaria = p.metaDiariaMinutos || 240
      const cumplioMeta = minutosTotal >= metaDiaria

      // Determinación de color para Entrada (E:)
      let colorE = 'gris'
      if (d.estado === 'FALTA') {
        colorE = 'rojo'
      } else if (hEnt !== '--') {
        if (punt && punt.nivel === 'rojo') {
          colorE = 'rojo'
        } else if (punt && punt.nivel === 'naranja') {
          colorE = 'naranja'
        } else {
          colorE = 'verde'
        }
      } else if (d.estado === 'PERMISO_COMPUTADO') {
        colorE = 'verde'
      }

      // Determinación de color para Salida (S:)
      let colorS = 'gris'
      if (d.estado === 'FALTA') {
        colorS = 'rojo'
      } else if (hSal !== '--') {
        const extraerMin = (val) => {
          const match = String(val).match(/(\d{1,2}):(\d{2})/)
          if (!match) return 0
          return parseInt(match[1], 10) * 60 + parseInt(match[2], 10)
        }
        const minSalReal = extraerMin(hSal)
        const minSalOficial = extraerMin(p.horaSalidaOficial)
        if (minSalReal >= minSalOficial) {
          colorS = 'verde'
        } else {
          const diffSal = minSalOficial - minSalReal
          colorS = diffSal <= 10 ? 'naranja' : 'rojo'
        }
      } else if (d.estado === 'EN_CURSO') {
        colorS = 'azul'
      }

      return `
        <div class="side-practicante-card">
          <div class="side-card-top">
            <span class="side-card-name" onclick="abrirModalDetalleJornada('${p.idPracticante || p.usuario}', '${d.fecha}')" title="Ver detalle exhaustivo de la jornada">
              ${p.nombre || p.usuario}
            </span>
            <div class="side-card-badges">
              <span class="modal-chip-sede">${p.oficina || 'General'}</span>
              <span class="card-supervisor-badge" title="Supervisor asignado">
                ${p.supervisorNombre || p.supervisor || 'General'}
              </span>
            </div>
          </div>

          <div class="side-card-schedule">
            <span>Oficial: ${formatearHoraSinSegundos(p.horaEntradaOficial)} - ${formatearHoraSinSegundos(p.horaSalidaOficial)}</span>
            ${d.fecha ? `<span style="color: var(--slate-400);">( ${d.fecha})</span>` : ''}
          </div>

          <div class="side-card-times-row">
            <span class="cal-time-pill pill-${colorE}">E: <strong>${hEnt}</strong></span>
            <span class="cal-time-pill pill-${colorS}">S: <strong>${hSal}</strong></span>
            <span class="side-card-total-time ${cumplioMeta ? 'meta-ok' : 'meta-short'}">
              ${formatearMinutos(minutosTotal)}
            </span>
          </div>

          <div class="side-card-footer">
            ${puntHtml}
            <button
              type="button"
              class="btn-side-detail"
              onclick="abrirModalDetalleJornada('${p.idPracticante || p.usuario}', '${d.fecha}')"
              title="Abrir modal con todos los detalles de la jornada"
            >
              Ver Detalle ▶
            </button>
          </div>
        </div>
      `
    })
    .join('')
}

/**
 * Filtros del Calendario
 */
function aplicarFiltrosCalendario() {
  const selSede = document.getElementById('filtro-cal-sede')
  const selEstado = document.getElementById('filtro-cal-estado')

  if (selSede) appState.calendar.filtroSede = selSede.value
  if (selEstado) appState.calendar.filtroEstado = selEstado.value

  renderizarPanelCalendario()
}

function seleccionarChipEstadoCalendario(estado) {
  appState.calendar.filtroEstado = estado
  const selEstado = document.getElementById('filtro-cal-estado')
  if (selEstado) selEstado.value = estado
  renderizarPanelCalendario()
}

function sincronizarChipsEstado(estadoActivo) {
  const chips = document.querySelectorAll('.cal-chips-group .chip-btn')
  chips.forEach((btn) => {
    if (btn.getAttribute('data-estado') === estadoActivo) {
      btn.classList.add('active')
    } else {
      btn.classList.remove('active')
    }
  })
}

function restablecerFiltrosCalendario() {
  appState.calendar.filtroSede = 'TODAS'
  appState.calendar.filtroEstado = 'TODOS'
  appState.filtroTextoPracticante = ''
  appState.filtroSupervisor = 'TODOS'

  const selSede = document.getElementById('filtro-cal-sede')
  const selEstado = document.getElementById('filtro-cal-estado')
  const inputSearch = document.getElementById('input-busqueda-practicante')
  const selSup = document.getElementById('select-filtro-supervisor')

  if (selSede) selSede.value = 'TODAS'
  if (selEstado) selEstado.value = 'TODOS'
  if (inputSearch) inputSearch.value = ''
  if (selSup) selSup.value = 'TODOS'

  const btnLimpiar = document.getElementById('btn-limpiar-busqueda-p')
  if (btnLimpiar) btnLimpiar.style.display = 'none'

  sincronizarChipsEstado('TODOS')
  renderizarPanelCalendario()
  mostrarToast('Filtros del calendario restablecidos.', 'info')
}

function filtrarListaCostadoCalendario(texto) {
  appState.calendar.sideFilterSearch = (texto || '').trim().toLowerCase()
  const btnClear = document.getElementById('cal-side-clear-search')
  if (btnClear) {
    btnClear.style.display = appState.calendar.sideFilterSearch
      ? 'block'
      : 'none'
  }
  renderizarListaCostadoCalendario()
}

function limpiarBusquedaCostadoCalendario() {
  const input = document.getElementById('cal-side-search-input')
  if (input) input.value = ''
  filtrarListaCostadoCalendario('')
}

/**
 * Modal Detalle Exhaustivo de la Jornada del Practicante
 */
function abrirModalDetalleJornada(practicanteId, fechaStr) {
  const modal = document.getElementById('modal-detalle-jornada')
  if (!modal) return

  let practicante = null
  let dia = null

  // 1. Buscar en cache de semanas
  const semanas = Object.values(appState.cacheReporteSemanal || {})
  for (const lista of semanas) {
    if (!Array.isArray(lista)) continue
    const pFound = lista.find(
      (p) =>
        (p.idPracticante &&
          p.idPracticante.toLowerCase() ===
            String(practicanteId).toLowerCase()) ||
        (p.usuario &&
          p.usuario.toLowerCase() === String(practicanteId).toLowerCase()),
    )
    if (pFound && pFound.desgloseSemanal) {
      const dFound = pFound.desgloseSemanal.find((d) => d.fecha === fechaStr)
      if (dFound) {
        practicante = pFound
        dia = dFound
        break
      }
    }
  }

  // 2. Si no se encontró en semanas, buscar en appState.practicantes (hoy)
  if (!practicante && appState.practicantes) {
    const pFound = appState.practicantes.find(
      (p) =>
        (p.idPracticante &&
          p.idPracticante.toLowerCase() ===
            String(practicanteId).toLowerCase()) ||
        (p.usuario &&
          p.usuario.toLowerCase() === String(practicanteId).toLowerCase()),
    )
    if (pFound) {
      practicante = pFound
      dia = (pFound.desgloseSemanal || []).find(
        (d) => d.fecha === fechaStr,
      ) || {
        fecha: fechaStr,
        minutos: pFound.minutosHoy || 0,
        estado:
          pFound.entrada && !pFound.salida
            ? 'EN_CURSO'
            : pFound.entrada && pFound.salida
              ? 'COMPLETADO'
              : 'PENDIENTE',
        horaEntradaReal: pFound.entrada ? pFound.entrada.hora : null,
        horaSalidaReal: pFound.salida ? pFound.salida.hora : null,
        entrada: pFound.entrada,
        salida: pFound.salida,
        incidencia: pFound.incidencia,
      }
    }
  }

  if (!practicante || !dia) {
    mostrarToast('No se encontró el registro detallado.', 'warning')
    return
  }

  appState.jornadaActualDetalle = { practicante, dia }

  const elNombre = document.getElementById('modal-jornada-nombre')
  const elSubinfo = document.getElementById('modal-jornada-subinfo')
  const elTags = document.getElementById('modal-jornada-tags')
  const elBody = document.getElementById('modal-jornada-body')

  if (elNombre) {
    elNombre.textContent =
      practicante.nombre || practicante.usuario || 'Practicante'
  }

  const sede = practicante.oficina || 'General'
  const sup =
    practicante.supervisorNombre ||
    practicante.supervisorAsignado ||
    practicante.supervisor ||
    'General'
  const hProg = `${formatearHoraSinSegundos(practicante.horaEntradaOficial)} - ${formatearHoraSinSegundos(practicante.horaSalidaOficial)}`

  const partesFecha = (dia.fecha || '').split('-')
  const fechaFormateada =
    partesFecha.length === 3
      ? `${partesFecha[2]}/${partesFecha[1]}/${partesFecha[0]}`
      : dia.fecha

  if (elSubinfo) {
    elSubinfo.innerHTML = `
      <span class="modal-sub-badge">${sede}</span>
      <span class="modal-sub-dot">•</span>
      <span>${dia.diaNombre ? dia.diaNombre + ', ' : ''}${fechaFormateada}</span>
      <span class="modal-sub-dot">•</span>
      <span>Horario: ${hProg}</span>
      <span class="modal-sub-dot">•</span>
      <span>Sup: ${sup}</span>
    `
  }

  if (elTags) {
    elTags.innerHTML = ''
    elTags.style.display = 'none'
  }

  // Bloques en el cuerpo del modal (Minimalista)
  if (elBody) {
    const ent =
      dia.entrada ||
      (practicante.entrada && dia.fecha === obtenerFechaHoyISO()
        ? practicante.entrada
        : null)
    const sal =
      dia.salida ||
      (practicante.salida && dia.fecha === obtenerFechaHoyISO()
        ? practicante.salida
        : null)
    const inc =
      dia.incidencia ||
      (practicante.incidencia && dia.fecha === obtenerFechaHoyISO()
        ? practicante.incidencia
        : null)

    const hEntradaReal = dia.horaEntradaReal || (ent ? ent.hora : '--')
    const hSalidaReal = dia.horaSalidaReal || (sal ? sal.hora : '--')
    const modoEnt = ent?.modo || (hEntradaReal !== '--' ? 'REAL' : '--')
    const modoSal = sal?.modo || (hSalidaReal !== '--' ? 'REAL' : '--')
    const regPorEnt = ent?.registradoPor || '--'
    const regPorSal = sal?.registradoPor || '--'
    const obsEnt = ent?.observacion || '--'
    const obsSal = sal?.observacion || '--'

    const punt = dia.puntualidad || obtenerPuntualidad(dia, practicante, 5)
    let puntBadge = '<span class="cell-pill cell-completed">A tiempo</span>'
    if (hEntradaReal === '--') {
      puntBadge = '<span class="cell-pill cell-pending">Sin registro</span>'
    } else if (punt) {
      if (punt.nivel === 'naranja') {
        puntBadge = `<span class="cell-pill cell-pending">Tolerancia (+${punt.minutosTarde}m)</span>`
      } else if (punt.nivel === 'rojo') {
        puntBadge = `<span class="cell-pill cell-incident">Tarde (+${punt.minutosTarde}m)</span>`
      }
    }

    const salBadge =
      hSalidaReal !== '--'
        ? '<span class="cell-pill cell-completed">Registrada</span>'
        : '<span class="cell-pill cell-pending">Sin salida</span>'

    const metaMin = practicante.metaDiariaMinutos || 240
    const minutosComp = dia.minutos || 0
    const cumplioMeta = minutosComp >= metaMin
    const metaBadge = cumplioMeta
      ? '<span class="cell-pill cell-completed">Meta Cumplida</span>'
      : '<span class="cell-pill cell-incident">Horas Incompletas</span>'

    // Formatear modo y supervisor de registro de forma unificada si coinciden
    const nomSupEnt = resolverNombreSupervisor(regPorEnt, practicante)
    const nomSupSal = resolverNombreSupervisor(regPorSal, practicante)
    const humanModoEnt = humanizarModoRegistro(modoEnt)
    const humanModoSal = humanizarModoRegistro(modoSal)

    let infoRegistro = ''
    if (hEntradaReal !== '--' || hSalidaReal !== '--') {
      const modoTexto =
        humanModoEnt === humanModoSal || hSalidaReal === '--'
          ? humanModoEnt
          : `Entrada: ${humanModoEnt} • Salida: ${humanModoSal}`

      const supTexto =
        nomSupEnt === nomSupSal || hSalidaReal === '--'
          ? nomSupEnt
          : `Entrada: ${nomSupEnt} • Salida: ${nomSupSal}`

      infoRegistro = `
        <div class="modal-meta-row">
          <div class="modal-meta-item">
            <span class="modal-meta-lbl">Modalidad:</span>
            <span class="modal-meta-val">${modoTexto}</span>
          </div>
          <div class="modal-meta-item">
            <span class="modal-meta-lbl">Registrado por:</span>
            <span class="modal-meta-val">${supTexto}</span>
          </div>
        </div>
      `
    }

    // Incidencias o notas
    let bloqueNotas = ''
    const tieneObsEnt =
      obsEnt && obsEnt !== '--' && obsEnt !== 'Marcación en tiempo real'
    const tieneObsSal =
      obsSal &&
      obsSal !== '--' &&
      !obsSal.startsWith('Marcación en tiempo real | Duración')

    if (tieneObsEnt || tieneObsSal) {
      bloqueNotas = `
        <div class="modal-notes-clean">
          ${tieneObsEnt ? `<div><span class="modal-note-tag">Nota Entrada:</span> ${obsEnt}</div>` : ''}
          ${tieneObsSal ? `<div><span class="modal-note-tag">Nota Salida:</span> ${obsSal}</div>` : ''}
        </div>
      `
    }

    let bloqueIncidencia = ''
    if (
      inc ||
      dia.estado === 'FALTA' ||
      dia.estado === 'PERMISO_COMPUTADO' ||
      dia.estado === 'FERIADO'
    ) {
      const tipoInc = inc?.tipo || dia.estado
      const obsInc =
        inc?.observacion ||
        (dia.estado === 'FERIADO'
          ? 'Día feriado oficial'
          : 'Sin observación registrada')
      bloqueIncidencia = `
        <div class="modal-alert-clean">
          <div class="modal-alert-icon">ℹ️</div>
          <div class="modal-alert-content">
            <strong>${tipoInc}:</strong> ${obsInc}
          </div>
        </div>
      `
    }

    elBody.innerHTML = `
      <div class="modal-journey-strip">
        <!-- Entrada -->
        <div class="modal-journey-col">
          <span class="modal-col-lbl">ENTRADA</span>
          <div class="modal-col-time ${hEntradaReal !== '--' ? 'time-emerald' : 'time-muted'}">${hEntradaReal}</div>
          <div class="modal-col-badge">${puntBadge}</div>
        </div>

        <div class="modal-journey-divider"></div>

        <!-- Salida -->
        <div class="modal-journey-col">
          <span class="modal-col-lbl">SALIDA</span>
          <div class="modal-col-time ${hSalidaReal !== '--' ? 'time-blue' : 'time-muted'}">${hSalidaReal}</div>
          <div class="modal-col-badge">${salBadge}</div>
        </div>

        <div class="modal-journey-divider"></div>

        <!-- Total Jornada -->
        <div class="modal-journey-col">
          <span class="modal-col-lbl">TOTAL JORNADA</span>
          <div class="modal-col-time time-dark">${formatearMinutos(minutosComp)}</div>
          <div class="modal-col-meta">
            ${metaBadge}
            <span class="modal-meta-target">Meta: ${formatearMinutos(metaMin)}</span>
          </div>
        </div>
      </div>

      ${infoRegistro}
      ${bloqueNotas}
      ${bloqueIncidencia}
    `
  }

  // Sincronizar y poblar inmediatamente los campos de ajuste con los datos de esta jornada
  const entModal =
    dia.entrada ||
    (practicante.entrada && dia.fecha === obtenerFechaHoyISO()
      ? practicante.entrada
      : null)
  const salModal =
    dia.salida ||
    (practicante.salida && dia.fecha === obtenerFechaHoyISO()
      ? practicante.salida
      : null)
  const hEntModal = dia.horaEntradaReal || (entModal ? entModal.hora : '')
  const hSalModal = dia.horaSalidaReal || (salModal ? salModal.hora : '')

  const inputFecha = document.getElementById('edit-jornada-fecha')
  const inputEntrada = document.getElementById('edit-jornada-entrada')
  const inputSalida = document.getElementById('edit-jornada-salida')
  const inputMotivo = document.getElementById('edit-jornada-motivo')

  if (inputFecha) inputFecha.value = dia.fecha || obtenerFechaHoyISO()
  if (inputEntrada) inputEntrada.value = formatearHoraParaInputTime(hEntModal)
  if (inputSalida) inputSalida.value = formatearHoraParaInputTime(hSalModal)
  if (inputMotivo) inputMotivo.value = ''

  // Horarios oficiales para botones de marcación rápida
  const hOficialEnt = formatearHoraParaInputTime(
    practicante.horaEntradaOficial || '',
  )
  const hOficialSal = formatearHoraParaInputTime(
    practicante.horaSalidaOficial || '',
  )
  const txtEnt = document.getElementById('txt-oficial-entrada')
  const txtSal = document.getElementById('txt-oficial-salida')
  if (txtEnt)
    txtEnt.textContent = hOficialEnt ? `Oficial: ${hOficialEnt}` : 'Oficial'
  if (txtSal)
    txtSal.textContent = hOficialSal ? `Oficial: ${hOficialSal}` : 'Oficial'

  actualizarCalculoHorasEnVivoEdicion()

  // Iniciar siempre en Modo Consulta Limpio (Opción 1: Sin redundancia)
  const bodyDetalle = document.getElementById('modal-jornada-body')
  const formEdicion = document.getElementById('modal-jornada-edit-form')
  const actionsDetalle = document.getElementById(
    'modal-jornada-actions-detalle',
  )
  const actionsEdicion = document.getElementById(
    'modal-jornada-actions-edicion',
  )

  if (bodyDetalle) bodyDetalle.classList.remove('hidden')
  if (formEdicion) formEdicion.classList.add('hidden')
  if (actionsDetalle) actionsDetalle.classList.remove('hidden')
  if (actionsEdicion) actionsEdicion.classList.add('hidden')

  modal.classList.remove('hidden')
}

function cerrarModalDetalleJornada() {
  const modal = document.getElementById('modal-detalle-jornada')
  if (modal) modal.classList.add('hidden')
  appState.jornadaActualDetalle = null
}

/**
 * ==========================================================
 * EDICIÓN DE JORNADA DIARIA (ENTRADA, SALIDA, FECHA Y HORAS)
 * ==========================================================
 */
function formatearHoraParaInputTime(valor) {
  if (!valor || valor === '--') return ''
  const m = String(valor).match(/(\d{1,2}):(\d{2})/)
  if (!m) return ''
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

function activarModoEdicionJornada() {
  if (!appState.jornadaActualDetalle) {
    mostrarToast('No hay una jornada seleccionada para editar.', 'warning')
    return
  }

  // Alternar a vista de formulario de edición (Opción 1: Transición Limpia)
  const bodyDetalle = document.getElementById('modal-jornada-body')
  const formEdicion = document.getElementById('modal-jornada-edit-form')
  const actionsDetalle = document.getElementById(
    'modal-jornada-actions-detalle',
  )
  const actionsEdicion = document.getElementById(
    'modal-jornada-actions-edicion',
  )

  if (bodyDetalle) bodyDetalle.classList.add('hidden')
  if (formEdicion) formEdicion.classList.remove('hidden')
  if (actionsDetalle) actionsDetalle.classList.add('hidden')
  if (actionsEdicion) actionsEdicion.classList.remove('hidden')

  actualizarCalculoHorasEnVivoEdicion()

  const inputMotivo = document.getElementById('edit-jornada-motivo')
  if (inputMotivo) {
    inputMotivo.value = ''
    inputMotivo.focus()
  }
}

function cancelarModoEdicionJornada() {
  // Revertir valores a los originales
  if (appState.jornadaActualDetalle) {
    const { practicante, dia } = appState.jornadaActualDetalle
    const ent =
      dia.entrada ||
      (practicante.entrada && dia.fecha === obtenerFechaHoyISO()
        ? practicante.entrada
        : null)
    const sal =
      dia.salida ||
      (practicante.salida && dia.fecha === obtenerFechaHoyISO()
        ? practicante.salida
        : null)

    const hEnt = dia.horaEntradaReal || (ent ? ent.hora : '')
    const hSal = dia.horaSalidaReal || (sal ? sal.hora : '')

    const inputFecha = document.getElementById('edit-jornada-fecha')
    const inputEntrada = document.getElementById('edit-jornada-entrada')
    const inputSalida = document.getElementById('edit-jornada-salida')
    const inputMotivo = document.getElementById('edit-jornada-motivo')

    if (inputFecha) inputFecha.value = dia.fecha || obtenerFechaHoyISO()
    if (inputEntrada) inputEntrada.value = formatearHoraParaInputTime(hEnt)
    if (inputSalida) inputSalida.value = formatearHoraParaInputTime(hSal)
    if (inputMotivo) inputMotivo.value = ''
  }

  // Regresar a la vista de Consulta limpia
  const bodyDetalle = document.getElementById('modal-jornada-body')
  const formEdicion = document.getElementById('modal-jornada-edit-form')
  const actionsDetalle = document.getElementById(
    'modal-jornada-actions-detalle',
  )
  const actionsEdicion = document.getElementById(
    'modal-jornada-actions-edicion',
  )

  if (bodyDetalle) bodyDetalle.classList.remove('hidden')
  if (formEdicion) formEdicion.classList.add('hidden')
  if (actionsDetalle) actionsDetalle.classList.remove('hidden')
  if (actionsEdicion) actionsEdicion.classList.add('hidden')
}

function aplicarHoraOficialEntrada() {
  if (!appState.jornadaActualDetalle?.practicante) return
  const hOficial = formatearHoraParaInputTime(
    appState.jornadaActualDetalle.practicante.horaEntradaOficial || '',
  )
  if (!hOficial) {
    mostrarToast(
      'Este practicante no tiene hora oficial de entrada configurada.',
      'warning',
    )
    return
  }
  const inputEnt = document.getElementById('edit-jornada-entrada')
  if (inputEnt) {
    inputEnt.value = hOficial
    actualizarCalculoHorasEnVivoEdicion()
  }
}

function aplicarHoraOficialSalida() {
  if (!appState.jornadaActualDetalle?.practicante) return
  const hOficial = formatearHoraParaInputTime(
    appState.jornadaActualDetalle.practicante.horaSalidaOficial || '',
  )
  if (!hOficial) {
    mostrarToast(
      'Este practicante no tiene hora oficial de salida configurada.',
      'warning',
    )
    return
  }
  const inputSal = document.getElementById('edit-jornada-salida')
  if (inputSal) {
    inputSal.value = hOficial
    actualizarCalculoHorasEnVivoEdicion()
  }
}

function actualizarCalculoHorasEnVivoEdicion() {
  const inputEntrada = document.getElementById('edit-jornada-entrada')
  const inputSalida = document.getElementById('edit-jornada-salida')
  const elHoras = document.getElementById('edit-preview-horas')
  const elStatus = document.getElementById('edit-preview-status')
  const boxBanner = document.getElementById('edit-jornada-preview-box')
  const btnGuardar = document.getElementById('btn-guardar-edicion')

  const entVal = inputEntrada ? inputEntrada.value.trim() : ''
  const salVal = inputSalida ? inputSalida.value.trim() : ''

  let metaMin = 240
  if (
    appState.jornadaActualDetalle &&
    appState.jornadaActualDetalle.practicante
  ) {
    metaMin = appState.jornadaActualDetalle.practicante.metaDiariaMinutos || 240
  }

  if (boxBanner) {
    boxBanner.classList.remove('preview-valid', 'preview-invalid')
  }

  if (entVal && salVal) {
    const minCalculados = calcularMinutosEntreHoras(salVal, entVal)
    if (minCalculados <= 0) {
      if (elHoras) elHoras.textContent = 'Horario Inválido'
      if (elStatus) {
        elStatus.innerHTML =
          '<span class="cell-pill cell-incident">Salida debe ser posterior</span>'
      }
      if (boxBanner) boxBanner.classList.add('preview-invalid')
      if (btnGuardar) btnGuardar.disabled = true
    } else {
      const horasStr = formatearMinutos(minCalculados)
      if (elHoras) elHoras.textContent = horasStr
      const cumplio = minCalculados >= metaMin
      const badgeHtml = cumplio
        ? `<span class="cell-pill cell-completed">Meta Cumplida (${formatearMinutos(metaMin)})</span>`
        : `<span class="cell-pill cell-pending">Incompleta (Meta: ${formatearMinutos(metaMin)})</span>`
      if (elStatus) elStatus.innerHTML = badgeHtml
      if (boxBanner) boxBanner.classList.add('preview-valid')
      if (btnGuardar) btnGuardar.disabled = false
    }
  } else if (entVal && !salVal) {
    if (elHoras) elHoras.textContent = 'En curso'
    if (elStatus) {
      elStatus.innerHTML =
        '<span class="cell-pill cell-pending">Solo Entrada registrada</span>'
    }
    if (btnGuardar) btnGuardar.disabled = false
  } else {
    if (elHoras) elHoras.textContent = '--:--'
    if (elStatus) {
      elStatus.innerHTML =
        '<span class="cell-pill cell-pending">Ingrese horario</span>'
    }
    if (btnGuardar) btnGuardar.disabled = false
  }
}

async function guardarEdicionJornada() {
  if (!appState.jornadaActualDetalle) return
  const { practicante, dia } = appState.jornadaActualDetalle

  const inputFecha = document.getElementById('edit-jornada-fecha')
  const inputEntrada = document.getElementById('edit-jornada-entrada')
  const inputSalida = document.getElementById('edit-jornada-salida')
  const inputMotivo = document.getElementById('edit-jornada-motivo')
  const btnGuardar = document.getElementById('btn-guardar-edicion')

  const fechaNueva = inputFecha ? inputFecha.value.trim() : dia.fecha
  const horaEntrada = inputEntrada ? inputEntrada.value.trim() : ''
  const horaSalida = inputSalida ? inputSalida.value.trim() : ''
  const motivo = inputMotivo ? inputMotivo.value.trim() : ''

  if (!fechaNueva) {
    mostrarToast('Debes seleccionar una fecha válida.', 'warning')
    return
  }

  if (horaEntrada && horaSalida) {
    const diff = calcularMinutosEntreHoras(horaSalida, horaEntrada)
    if (diff <= 0) {
      mostrarToast(
        'La hora de salida debe ser posterior a la hora de entrada.',
        'error',
      )
      return
    }
  }

  if (!motivo) {
    mostrarToast(
      'Por favor ingresa una justificación o motivo para la corrección.',
      'warning',
    )
    if (inputMotivo) inputMotivo.focus()
    return
  }

  const supervisorId =
    appState.supervisor?.idSupervisor ||
    appState.supervisor?.usuario ||
    'Supervisor'
  const supervisorNombre =
    appState.supervisor?.nombre || appState.supervisor?.usuario || supervisorId

  const payload = {
    accion: 'editar_marcacion',
    idPracticante: practicante.idPracticante || practicante.usuario,
    fechaOriginal: dia.fecha,
    fechaNueva: fechaNueva,
    horaEntrada: horaEntrada,
    horaSalida: horaSalida,
    motivo: motivo,
    registradoPor: supervisorId,
    nombreSupervisor: supervisorNombre,
  }

  const textoBtnOriginal = btnGuardar ? btnGuardar.innerHTML : ''
  if (btnGuardar) {
    btnGuardar.disabled = true
    btnGuardar.innerHTML = 'Guardando...'
  }
  setSyncStatus('syncing', 'Guardando corrección...')

  try {
    const data = await llamarAppsScript(payload, true)

    if (!data.success) {
      throw new Error(data.error || 'Error al guardar la corrección.')
    }

    setSyncStatus('success', 'Jornada actualizada ✔')
    mostrarToast(
      data.mensaje || 'Jornada actualizada correctamente.',
      'success',
    )

    // Actualizar estado en memoria
    const j = data.jornada || {}
    const pIdTarget = (
      practicante.idPracticante ||
      practicante.usuario ||
      ''
    ).toLowerCase()

    // 1. Si la fecha corresponde a hoy, actualizar appState.practicantes
    const hoyISO = obtenerFechaHoyISO()
    if (j.fecha === hoyISO || dia.fecha === hoyISO) {
      const pIndex = (appState.practicantes || []).findIndex(
        (item) =>
          (item.idPracticante &&
            item.idPracticante.toLowerCase() === pIdTarget) ||
          (item.usuario && item.usuario.toLowerCase() === pIdTarget),
      )
      if (pIndex >= 0) {
        const pHoy = appState.practicantes[pIndex]
        if (j.horaEntrada) {
          pHoy.entrada = {
            idRegistro: pHoy.entrada?.idRegistro || 'EDITADO',
            hora: j.horaEntrada,
            modo: 'EDITADO',
            observacion: j.observacionesEntrada || motivo,
          }
        }
        if (j.horaSalida) {
          pHoy.salida = {
            idRegistro: pHoy.salida?.idRegistro || 'EDITADO',
            hora: j.horaSalida,
            modo: 'EDITADO',
            observacion: j.observacionesSalida || motivo,
          }
          pHoy.minutosHoy = j.minutosTrabajados || 0
        }
        if (pHoy.incidencia && (j.horaEntrada || j.horaSalida)) {
          pHoy.incidencia = null
        }
      }
    }

    // 2. Actualizar desglose semanal en cache de reportes
    const semanas = Object.values(appState.cacheReporteSemanal || {})
    semanas.forEach((lista) => {
      if (!Array.isArray(lista)) return
      const pFound = lista.find(
        (item) =>
          (item.idPracticante &&
            item.idPracticante.toLowerCase() === pIdTarget) ||
          (item.usuario && item.usuario.toLowerCase() === pIdTarget),
      )
      if (pFound && pFound.desgloseSemanal) {
        const diaFound = pFound.desgloseSemanal.find(
          (d) => d.fecha === dia.fecha || d.fecha === j.fecha,
        )
        if (diaFound) {
          diaFound.fecha = j.fecha || diaFound.fecha
          diaFound.horaEntradaReal = j.horaEntrada || null
          diaFound.horaSalidaReal = j.horaSalida || null
          diaFound.minutos = j.minutosTrabajados || 0
          diaFound.horasFormateadas =
            j.horasTrabajadas || (j.horaEntrada ? 'En curso' : '--')
          diaFound.estado = j.horaSalida
            ? 'COMPLETADO'
            : j.horaEntrada
              ? 'EN_CURSO'
              : 'NO_REGISTRADO'
          diaFound.cumplioMeta =
            (j.minutosTrabajados || 0) >= (pFound.metaDiariaMinutos || 240)
          diaFound.entrada = j.horaEntrada
            ? { hora: j.horaEntrada, modo: 'EDITADO' }
            : null
          diaFound.salida = j.horaSalida
            ? { hora: j.horaSalida, modo: 'EDITADO' }
            : null

          // Recalcular total semanal
          const totalMin = pFound.desgloseSemanal.reduce(
            (acc, d) => acc + (d.minutos || 0),
            0,
          )
          pFound.minutosSemanaTotal = totalMin
          pFound.saldoSemanalMinutos =
            totalMin - (pFound.metaDiariaMinutos || 240) * 5
        }
      }
    })

    // 3. Si la auditoría está cargada, refrescarla en segundo plano
    if (appState.registrosAuditoria && appState.registrosAuditoria.length > 0) {
      cargarAuditoriaRegistros(true).catch(() => {})
    }

    cerrarModalDetalleJornada()
    renderizarTodo()
  } catch (err) {
    setSyncStatus('error', 'Error al corregir')
    mostrarToast('No se pudo guardar la corrección: ' + err.message, 'error')
  } finally {
    if (btnGuardar) {
      btnGuardar.disabled = false
      btnGuardar.innerHTML = textoBtnOriginal || 'Guardar Cambios'
    }
  }
}

function abrirEdicionJornadaHoy(idPracticante) {
  const hoyISO = obtenerFechaHoyISO()
  abrirModalDetalleJornada(idPracticante, hoyISO)
  activarModoEdicionJornada()
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
