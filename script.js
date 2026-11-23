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
  cargarListaSupervisores()

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
      mostrarDashboard()
      recargarDatos()
    } catch (e) {
      localStorage.removeItem(STORAGE_KEY_USER)
    }
  } else {
    mostrarLogin()
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

  try {
    const respuesta = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(datos),
    })

    if (!respuesta.ok) throw new Error(`Error HTTP: ${respuesta.status}`)

    const data = await respuesta.json()
    if (conLoading) ocultarLoading()

    if (!data.success) throw new Error(data.error || 'Error en la operación.')
    return data
  } catch (err) {
    if (conLoading) ocultarLoading()
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
  filtrarSupervisores(document.getElementById('login-usuario').value)
}
function ocultarDropdownSugerencias() {
  document.getElementById('sugerencias-usuarios').style.display = 'none'
}

function filtrarSupervisores(texto) {
  const dropdown = document.getElementById('sugerencias-usuarios')
  const btnClear = document.getElementById('btn-clear-search')
  btnClear.style.display = texto.trim() ? 'block' : 'none'

  const query = (texto || '').trim().toLowerCase()
  dropdown.innerHTML = ''

  let lista = appState.supervisoresDisponibles
  if (!lista || lista.length === 0) {
    dropdown.innerHTML = `
      <div style="padding: 14px 12px; font-size: 0.82rem; color: var(--slate-500); text-align: center; display: flex; align-items: center; justify-content: center; gap: 8px;">
        <span class="sync-spinner"></span>
        <span>Cargando lista de supervisores...</span>
      </div>
    `
    dropdown.style.display = 'block'
    return
  }

  const resultados = lista.filter(
    (s) =>
      s.usuario.toLowerCase().includes(query) ||
      (s.nombre && s.nombre.toLowerCase().includes(query)),
  )

  if (resultados.length === 0) {
    dropdown.innerHTML = `<div style="padding: 12px; font-size: 0.82rem; color: var(--slate-400); text-align: center;">No se encontraron supervisores.</div>`
  } else {
    resultados.forEach((sup) => {
      const item = document.createElement('div')
      item.className = 'suggestion-item'
      item.innerHTML = `
            <div>
              <div class="suggestion-user-title">${sup.usuario}</div>
              <div class="suggestion-sub">${sup.nombre} • ${sup.oficina}</div>
            </div>
            <span class="suggestion-tag">${sup.rol}</span>
          `
      item.onclick = () => {
        document.getElementById('login-usuario').value = sup.usuario
        ocultarDropdownSugerencias()
        document.getElementById('btn-clear-search').style.display = 'block'
        document.getElementById('login-password').focus()
      }
      dropdown.appendChild(item)
    })
  }
  dropdown.style.display = 'block'
}

function limpiarBuscador() {
  const input = document.getElementById('login-usuario')
  input.value = ''
  document.getElementById('btn-clear-search').style.display = 'none'
  filtrarSupervisores('')
  input.focus()
}

async function iniciarSesion(e) {
  e.preventDefault()
  const usuario = document.getElementById('login-usuario').value.trim()
  const contrasena = document.getElementById('login-password').value.trim()

  try {
    const res = await llamarAppsScript(
      { accion: 'login', usuario, contrasena },
      true,
    )
    appState.supervisor = res.supervisor
    appState.practicantes = res.practicantes || []
    appState.feriado = res.feriado || { esFeriado: false }
    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(res.supervisor))

    mostrarToast(`¡Bienvenido/a, ${res.supervisor.usuario}!`, 'success')
    mostrarDashboard()
    renderizarTodo()
  } catch (err) {
    mostrarToast(err.message || 'Error al iniciar sesión', 'error')
  }
}

function cerrarSesion() {
  appState.supervisor = null
  appState.practicantes = []
  localStorage.removeItem(STORAGE_KEY_USER)
  mostrarLogin()
  mostrarToast('Sesión cerrada.', 'warning')
}

async function recargarDatos() {
  if (!appState.supervisor) return
  try {
    const res = await llamarAppsScript(
      { accion: 'recargar', usuario: appState.supervisor.usuario },
      true,
    )
    appState.practicantes = res.practicantes || []
    appState.feriado = res.feriado || { esFeriado: false }
    renderizarTodo()
    mostrarToast('Datos actualizados.', 'success')
  } catch (err) {
    mostrarToast(err.message || 'Error al sincronizar con Sheets', 'error')
  }
}

function mostrarLogin() {
  document.getElementById('vista-login').classList.remove('hidden')
  document.getElementById('vista-dashboard').classList.add('hidden')
  document.getElementById('login-password').value = ''
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

  appState.practicantes.forEach((p) => {
    if (p.entrada && !p.salida) {
      p.minutosHoy = calcularMinutosEntreHoras(ahoraStr, p.entrada.hora)
      huboCambios = true
    }
  })

  if (huboCambios) renderizarTodo()
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
                Horario habitual: ${p.horaEntradaOficial || '--'} a ${p.horaSalidaOficial || '--'}
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
      actionBoxHtml = `
            <div class="action-contextual-box">
              <div class="action-row-main">
                <button class="btn btn-danger btn-action-main" onclick="ejecutarMarcacion('${p.usuario}', 'SALIDA', ${idx})" ${esFeriadoBloqueante ? 'disabled' : ''}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                  </svg>
                  MARCAR SALIDA
                </button>
                <label class="checkbox-pill-subtle" title="Marcar a la hora programada">
                  <input type="checkbox" id="chk-salida-${idx}" onchange="toggleObservacion('salida', ${idx})">
                  <span>Oficial (${p.horaSalidaOficial})</span>
                </label>
              </div>
              <div id="obs-container-salida-${idx}" class="obs-wrapper hidden">
                <input type="text" id="obs-salida-${idx}" class="form-control form-control-sm" placeholder="Observación para salida oficial...">
              </div>
            </div>
          `
    } else if (!tieneIncidencia) {
      actionBoxHtml = `
            <div class="action-contextual-box">
              <div class="action-row-main">
                <button class="btn btn-success btn-action-main" onclick="ejecutarMarcacion('${p.usuario}', 'ENTRADA', ${idx})" ${esFeriadoBloqueante ? 'disabled' : ''}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                    <polyline points="10 17 15 12 10 7"></polyline>
                    <line x1="15" y1="12" x2="3" y2="12"></line>
                  </svg>
                  MARCAR ENTRADA
                </button>
                <label class="checkbox-pill-subtle" title="Marcar a la hora programada">
                  <input type="checkbox" id="chk-entrada-${idx}" onchange="toggleObservacion('entrada', ${idx})">
                  <span>Oficial (${p.horaEntradaOficial})</span>
                </label>
              </div>
              <div id="obs-container-entrada-${idx}" class="obs-wrapper hidden">
                <input type="text" id="obs-entrada-${idx}" class="form-control form-control-sm" placeholder="Observación para entrada oficial...">
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
            <button class="btn-footer-action danger" onclick="solicitarAnulacion('${p.usuario}', '${p.salida.idRegistro || ''}', 'Salida de las ${p.salida.hora}', ${idx}, 'SALIDA')" title="Revertir la salida de hoy">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
                <polyline points="1 4 1 10 7 10"></polyline>
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
              </svg>
              <span>Deshacer salida</span>
            </button>
          `
    } else if (tieneEntrada) {
      footerHtml = `
            <button class="btn-footer-action danger" onclick="solicitarAnulacion('${p.usuario}', '${p.entrada.idRegistro || ''}', 'Entrada de las ${p.entrada.hora}', ${idx}, 'ENTRADA')" title="Revertir la entrada de hoy">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
                <polyline points="1 4 1 10 7 10"></polyline>
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
              </svg>
              <span>Deshacer entrada</span>
            </button>
          `
    } else if (tieneIncidencia) {
      footerHtml = `
            <button class="btn-footer-action danger" onclick="solicitarAnulacion('${p.usuario}', '${p.incidencia.idRegistro || ''}', 'Inasistencia', ${idx}, 'INCIDENCIA')" title="Eliminar registro de inasistencia">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
              <span>Anular inasistencia</span>
            </button>
          `
    } else {
      footerHtml = `
            <button class="btn-footer-action secondary" onclick="abrirModalIncidencia('${p.usuario}', ${idx})" title="Registrar permiso o inasistencia">
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
                <h3 class="card-name" title="${p.usuario}">${p.usuario}</h3>
                ${badgeHtml}
              </div>
              <div class="card-meta">
                <span class="card-meta-horario">
                  Horario: <strong>${p.horaEntradaOficial || '--'} - ${p.horaSalidaOficial || '--'}</strong>
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
function renderizarPanelReporte() {
  const tbody = document.getElementById('tabla-semanal-body')
  tbody.innerHTML = ''

  if (!appState.practicantes || appState.practicantes.length === 0) return

  let sumaMinutosEquipo = 0
  let sumaMetasEquipo = 0

  appState.practicantes.forEach((p) => {
    const totalSemanaMin = p.minutosSemanaTotal || 0
    const metaSemanalMin = p.metaSemanalMinutos || 1200
    const saldoMin = p.saldoSemanalMinutos || 0

    sumaMinutosEquipo += totalSemanaMin
    sumaMetasEquipo += metaSemanalMin

    let celdasDiasHtml = ''
    if (p.desgloseSemanal && p.desgloseSemanal.length > 0) {
      celdasDiasHtml = p.desgloseSemanal
        .map((d) => {
          if (d.estado === 'COMPLETADO') {
            return `<td><span class="cell-pill cell-completed">${d.horasFormateadas}</span></td>`
          } else if (d.estado === 'FERIADO') {
            return `<td><span class="cell-pill cell-holiday">Feriado</span></td>`
          } else if (d.estado === 'PERMISO_COMPUTADO') {
            return `<td><span class="cell-pill cell-completed">Permiso</span></td>`
          } else if (d.estado === 'EN_CURSO') {
            return `<td><span class="cell-pill cell-current">En curso</span></td>`
          } else {
            return `<td><span class="cell-pill cell-pending">--</span></td>`
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
          <td><strong>${p.usuario}</strong></td>
          <td style="color: var(--slate-500);">${p.horaEntradaOficial} - ${p.horaSalidaOficial}</td>
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
    appState.practicantes.length
  const pctGlobal =
    sumaMetasEquipo > 0
      ? Math.round((sumaMinutosEquipo / sumaMetasEquipo) * 100)
      : 0
  document.getElementById('kpi-cumplimiento-pct').textContent = `${pctGlobal}%`
}

// ==========================================================
// EJECUTAR MARCACIÓN INLIVE (0ms DE ESPERA CON ROLLBACK)
// ==========================================================
async function ejecutarMarcacion(usuarioPracticante, tipo, idx) {
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

  const detalle = {
    idRegistro: 'TEMP-' + Date.now(),
    hora: horaVisual,
    modo: usarHoraOficial ? 'HORA_OFICIAL' : 'REAL',
    registradoPor: appState.supervisor.usuario,
    observacion: observacion,
  }

  // 1. ACTUALIZACIÓN VISUAL INMEDIATA EN MEMORIA (0 ms)
  if (tipo === 'ENTRADA') {
    practicante.entrada = detalle
    practicante.minutosHoy = 0
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
    }
  }

  renderizarTodo()
  setSyncStatus('syncing', 'Guardando...')

  // 2. Envío en segundo plano
  try {
    const res = await llamarAppsScript(
      {
        accion: 'marcar',
        usuarioPracticante: usuarioPracticante,
        tipo: tipo,
        usarHoraOficial: usarHoraOficial,
        observacion: observacion,
        registradoPor: appState.supervisor.usuario,
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
    renderizarTodo()
    setSyncStatus('error', 'Error al guardar')
    mostrarToast('No se pudo guardar en Sheets: ' + err.message, 'error')
  }
}

// ==========================================================
// ANULACIÓN / DESHACER (CON ROLLBACK)
// ==========================================================
function solicitarAnulacion(
  usuarioPracticante,
  idRegistro,
  detalle,
  idx,
  tipoAnulacion,
) {
  appState.pendienteAnular = {
    usuarioPracticante,
    idRegistro,
    idx,
    tipoAnulacion,
  }
  document.getElementById('anular-desc').innerHTML =
    `¿Deseas revertir la <strong>${detalle}</strong> de <strong>${usuarioPracticante}</strong>?`
  document.getElementById('anular-motivo').value = ''
  document.getElementById('modal-anular').classList.remove('hidden')
}

function cerrarModalAnular() {
  appState.pendienteAnular = null
  document.getElementById('modal-anular').classList.add('hidden')
}

async function confirmarAnulacion() {
  if (!appState.pendienteAnular) return

  const { usuarioPracticante, idRegistro, idx, tipoAnulacion } =
    appState.pendienteAnular
  const motivo = document.getElementById('anular-motivo').value.trim()
  cerrarModalAnular()

  const practicante = appState.practicantes[idx]
  if (!practicante) return

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
  } else if (tipoAnulacion === 'ENTRADA') {
    practicante.entrada = null
    practicante.salida = null
    practicante.minutosHoy = 0
  } else if (tipoAnulacion === 'INCIDENCIA') {
    practicante.incidencia = null
  }

  renderizarTodo()
  setSyncStatus('syncing', 'Anulando...')

  try {
    await llamarAppsScript(
      {
        accion: 'anular',
        idRegistro: idRegistro,
        motivo: motivo || 'Anulado por supervisor',
        registradoPor: appState.supervisor.usuario,
      },
      false,
    )

    setSyncStatus('success', 'Marcación anulada ✔')
  } catch (err) {
    appState.practicantes[idx] = estadoAnterior
    renderizarTodo()
    setSyncStatus('error', 'Error al anular')
    mostrarToast('Error al anular en Sheets: ' + err.message, 'error')
  }
}

// ==========================================================
// INCIDENCIAS / AUSENCIAS
// ==========================================
function abrirModalIncidencia(usuarioPracticante, idx) {
  appState.pendienteIncidencia = { usuarioPracticante, idx }
  document.getElementById('incidencia-desc').textContent =
    `Registrar falta o inasistencia para: ${usuarioPracticante}.`
  document.getElementById('incidencia-obs').value = ''
  document.getElementById('modal-incidencia').classList.remove('hidden')
}

function cerrarModalIncidencia() {
  appState.pendienteIncidencia = null
  document.getElementById('modal-incidencia').classList.add('hidden')
}

async function confirmarIncidencia() {
  if (!appState.pendienteIncidencia) return

  const { usuarioPracticante, idx } = appState.pendienteIncidencia
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

  renderizarTodo()
  setSyncStatus('syncing', 'Guardando...')

  try {
    await llamarAppsScript(
      {
        accion: 'reportar_incidencia',
        usuarioPracticante: usuarioPracticante,
        tipoIncidencia: tipo,
        observacion: obs || 'Reportado por supervisor',
        registradoPor: appState.supervisor.usuario,
      },
      false,
    )

    setSyncStatus('success', 'Incidencia guardada ✔')
  } catch (err) {
    appState.practicantes[idx] = estadoAnterior
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
