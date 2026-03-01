const GAS_URL = "https://script.google.com/macros/s/AKfycby2ggM0jkqfmQPTyC5KBTaFHB-tc2R9WHn1-3ovPT8VnLpdjeM_eBsjF4Py8e6cnT8Z/exec";
const APP_VERSION = "1.2.0";
const APP_TOKEN = ""; // Opcional: usar el mismo token en Script Properties (ASR_TOKEN)
const DEFAULT_NOVEDADES = "Sin novedades";
const QUEUE_KEY = "asr_pending_queue_v1";
const REMEMBER_KEY = "asr_remember_data";
const DATA_KEYS = ["legajo", "jerarquia", "apellidoNombre", "dni"];

const status = document.getElementById("status");
const syncInfo = document.getElementById("syncInfo");
const rememberData = document.getElementById("rememberData");
const btnInicio = document.getElementById("btnInicio");
const btnFin = document.getElementById("btnFin");
const badge = document.getElementById("badge");
const logo = document.querySelector(".logo");
const clockDay = document.getElementById("clockDay");
const clockTime = document.getElementById("clockTime");
const chipGps = document.getElementById("chipGps");
const chipNet = document.getElementById("chipNet");
const chipQueue = document.getElementById("chipQueue");
const novedadesSection = document.getElementById("novedadesSection");
const novedadesInput = document.getElementById("novedades");
const btnFinConfirm = document.getElementById("btnFinConfirm");
const btnVolver = document.getElementById("btnVolver");
const btnRetryGeo = document.getElementById("btnRetryGeo");
const receiptBox = document.getElementById("receiptBox");
const receiptText = document.getElementById("receiptText");
const btnDownloadReceipt = document.getElementById("btnDownloadReceipt");
const btnCopyReceiptId = document.getElementById("btnCopyReceiptId");

let lastGeoAttempt = null;
let lastReceipt = null;

function sanitizeText(value, maxLen) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function sanitizeDigits(value, maxLen) {
  return String(value || "").replace(/[^\d]/g, "").slice(0, maxLen);
}

function getPendingQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    return [];
  }
}

function setPendingQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

function setChipState(chip, text, state) {
  if (!chip) return;
  chip.textContent = text;
  chip.classList.remove("chip-neutral", "chip-ok", "chip-warn", "chip-err");
  chip.classList.add(
    state === "ok" ? "chip-ok" :
    state === "warn" ? "chip-warn" :
    state === "err" ? "chip-err" :
    "chip-neutral"
  );
}

function updateSyncInfo(customMessage) {
  const pending = getPendingQueue().length;
  if (customMessage) {
    syncInfo.textContent = customMessage;
    return;
  }
  if (!navigator.onLine) {
    syncInfo.textContent = `Sin conexion. Pendientes: ${pending}`;
    setChipState(chipNet, "Red: offline", "err");
    setChipState(chipQueue, `Cola: ${pending}`, pending > 0 ? "warn" : "neutral");
    return;
  }
  syncInfo.textContent = pending > 0 ? `Pendientes por sincronizar: ${pending}` : "Sin pendientes. Conexion activa.";
  setChipState(chipNet, "Red: online", "ok");
  setChipState(chipQueue, `Cola: ${pending}`, pending > 0 ? "warn" : "ok");
}

function getRememberPreference() {
  const saved = localStorage.getItem(REMEMBER_KEY);
  return saved !== "0";
}

function saveRememberPreference(enabled) {
  localStorage.setItem(REMEMBER_KEY, enabled ? "1" : "0");
}

function loadSavedData() {
  if (!getRememberPreference()) return;
  DATA_KEYS.forEach(id => {
    const value = localStorage.getItem(id);
    if (value) document.getElementById(id).value = value;
  });
}

function clearSavedData() {
  DATA_KEYS.forEach(id => localStorage.removeItem(id));
}

function saveFormData(formData) {
  if (rememberData.checked) {
    DATA_KEYS.forEach(id => localStorage.setItem(id, formData[id]));
  } else {
    clearSavedData();
  }
}

function getFormData() {
  const legajo = sanitizeDigits(document.getElementById("legajo").value, 10);
  const jerarquia = sanitizeText(document.getElementById("jerarquia").value, 50);
  const apellidoNombre = sanitizeText(document.getElementById("apellidoNombre").value, 80);
  const dni = sanitizeDigits(document.getElementById("dni").value, 10);

  document.getElementById("legajo").value = legajo;
  document.getElementById("jerarquia").value = jerarquia;
  document.getElementById("apellidoNombre").value = apellidoNombre;
  document.getElementById("dni").value = dni;

  return { legajo, jerarquia, apellidoNombre, dni };
}

function validateFormData(data) {
  if (!data.legajo || data.legajo.length < 4) return "Legajo invalido (minimo 4 digitos).";
  if (!data.jerarquia || data.jerarquia.length < 2) return "Jerarquia invalida.";
  if (!data.apellidoNombre || data.apellidoNombre.length < 4) return "Apellido y nombre invalido.";
  if (!data.dni || data.dni.length < 7) return "DNI invalido.";
  return "";
}

function showBadge(mensaje) {
  badge.textContent = mensaje;
  badge.classList.add("show");
  setTimeout(() => badge.classList.remove("show"), 3500);
}

function mostrarStatus(mensaje, tipo) {
  status.textContent = mensaje;
  switch (tipo) {
    case "okInicio":
      status.style.color = "#00ff99";
      break;
    case "okFin":
      status.style.color = "#ff4d4d";
      break;
    case "warning":
      status.style.color = "#ffcc00";
      break;
    case "error":
      status.style.color = "#ff4444";
      break;
    default:
      status.style.color = "#e0e0e0";
  }
  showBadge(mensaje);
  setTimeout(() => {
    status.textContent = "";
  }, 6000);
}

async function sendToGAS(payload, timeoutMs = 15000) {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error("HTTP " + res.status);
    }
    return await res.json();
  } finally {
    clearTimeout(timerId);
  }
}

async function sendWithRetry(payload, attempts) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await sendToGAS(payload);
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  throw lastError;
}

async function flushPendingQueue() {
  const queue = getPendingQueue();
  if (!queue.length || !navigator.onLine) {
    updateSyncInfo();
    return;
  }

  let sent = 0;
  const pending = [];
  for (const payload of queue) {
    try {
      const result = await sendToGAS(payload, 12000);
      if (result && result.status === "ok") {
        sent += 1;
      } else {
        pending.push(payload);
      }
    } catch (err) {
      pending.push(payload);
    }
  }

  setPendingQueue(pending);
  if (sent > 0) {
    mostrarStatus(`✅ ${sent} registro(s) pendientes sincronizados.`, "okInicio");
  }
  updateSyncInfo();
}

function queuePayload(payload) {
  const queue = getPendingQueue();
  queue.push(payload);
  setPendingQueue(queue);
  updateSyncInfo("Sin conexion. Registro guardado y pendiente de sincronizacion.");
}

function setBusy(isBusy, tipo) {
  btnInicio.disabled = isBusy;
  btnFin.disabled = isBusy;
  if (tipo === "FIN") btnFinConfirm.disabled = isBusy;
}

function setRetryGeoVisible(show) {
  if (!btnRetryGeo) return;
  btnRetryGeo.style.display = show ? "block" : "none";
  btnRetryGeo.disabled = false;
}

function hideReceipt() {
  if (receiptBox) receiptBox.style.display = "none";
  if (receiptText) receiptText.textContent = "";
  lastReceipt = null;
}

function showReceipt(receipt) {
  lastReceipt = receipt;
  if (!receiptBox || !receiptText) return;
  const resumen = [
    "Comprobante: " + receipt.comprobanteId,
    "Tipo: " + receipt.tipo,
    "Fecha/Hora: " + receipt.serverTime,
    "Legajo: " + receipt.legajo,
    "Efectivo: " + receipt.apellidoNombre
  ].join(" | ");
  receiptText.textContent = resumen;
  receiptBox.style.display = "block";
}

function buildReceiptFileContent(receipt) {
  return [
    "COMPROBANTE DE REGISTRO - ASREGISTER",
    "===================================",
    "ID: " + receipt.comprobanteId,
    "Tipo: " + receipt.tipo,
    "Fecha/Hora servidor: " + receipt.serverTime,
    "",
    "Efectivo",
    "--------",
    "Legajo: " + receipt.legajo,
    "Jerarquia: " + receipt.jerarquia,
    "Apellido y Nombre: " + receipt.apellidoNombre,
    "DNI: " + receipt.dni,
    "",
    "Ubicacion",
    "---------",
    "Latitud: " + receipt.lat,
    "Longitud: " + receipt.lon,
    "Precision GPS: " + receipt.accuracy + " m",
    "",
    "Novedades: " + receipt.novedades
  ].join("\n");
}

function downloadReceipt() {
  if (!lastReceipt) {
    mostrarStatus("⚠️ No hay comprobante para descargar.", "warning");
    return;
  }
  const content = buildReceiptFileContent(lastReceipt);
  const fileName =
    "comprobante-" +
    String(lastReceipt.tipo).toLowerCase() +
    "-legajo-" +
    String(lastReceipt.legajo) +
    "-" +
    String(lastReceipt.serverTime).replace(/[^\d]/g, "").slice(0, 14) +
    ".txt";
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyReceiptId() {
  if (!lastReceipt || !lastReceipt.comprobanteId) {
    mostrarStatus("⚠️ No hay ID de comprobante para copiar.", "warning");
    return;
  }
  try {
    await navigator.clipboard.writeText(lastReceipt.comprobanteId);
    mostrarStatus("📋 ID de comprobante copiado.", "okInicio");
  } catch (err) {
    mostrarStatus("⚠️ No se pudo copiar automaticamente. ID: " + lastReceipt.comprobanteId, "warning");
  }
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

function isLikelyInAppBrowser() {
  const ua = navigator.userAgent || "";
  return /FBAN|FBAV|Instagram|Line|Twitter|wv/i.test(ua);
}

async function getGeolocationPermissionState() {
  if (!navigator.permissions || !navigator.permissions.query) return "prompt";
  try {
    const result = await navigator.permissions.query({ name: "geolocation" });
    return result && result.state ? result.state : "prompt";
  } catch (err) {
    return "prompt";
  }
}

function getCurrentPositionPromise(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

async function getBestEffortPosition() {
  try {
    return await getCurrentPositionPromise({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  } catch (firstErr) {
    if (firstErr && firstErr.code === 1) throw firstErr;
    return getCurrentPositionPromise({ enableHighAccuracy: false, timeout: 25000, maximumAge: 60000 });
  }
}

function getDeniedGeoMessage() {
  if (isIOS()) {
    return "Permiso de ubicacion denegado. En iPhone: Ajustes > Privacidad y seguridad > Localizacion > Safari/Chrome > Permitir. Si esta en modo privado, pruebe en pestana normal.";
  }
  if (isAndroid()) {
    return "Permiso de ubicacion denegado. En Android: Ajustes > Apps > Navegador > Permisos > Ubicacion > Permitir.";
  }
  return "Permiso de ubicacion denegado. Habilitelo en el navegador para continuar.";
}

function getGeoErrorMessage(err, permissionState) {
  if ((err && err.code === 1) || permissionState === "denied") {
    return getDeniedGeoMessage();
  }
  if (err && err.code === 2) {
    return "No se pudo obtener la ubicacion. Active GPS/ubicacion del dispositivo y reintente.";
  }
  if (err && err.code === 3) {
    return "Tiempo de espera agotado al obtener ubicacion. Reintente con mejor senal.";
  }
  return "No fue posible obtener la ubicacion. Verifique permisos y conexion GPS.";
}

async function registrar(tipo, novedades = "") {
  lastGeoAttempt = { tipo: tipo, novedades: novedades };
  setRetryGeoVisible(false);
  hideReceipt();

  const data = getFormData();
  const validationError = validateFormData(data);
  if (validationError) {
    mostrarStatus("⚠️ " + validationError, "warning");
    return;
  }

  saveFormData(data);
  setBusy(true, tipo);
  mostrarStatus("📍 Solicitando ubicación...", "warning");
  setChipState(chipGps, "GPS: buscando", "warn");

  if (!navigator.geolocation) {
    mostrarStatus("❌ Geolocalizacion no soportada.", "error");
    setChipState(chipGps, "GPS: no soportado", "err");
    setRetryGeoVisible(true);
    setBusy(false, tipo);
    return;
  }

  if (isLikelyInAppBrowser()) {
    updateSyncInfo("Sugerencia: si falla GPS, abra el link en Safari/Chrome normal.");
  }

  const permissionState = await getGeolocationPermissionState();
  if (permissionState === "denied") {
    mostrarStatus("❌ " + getDeniedGeoMessage(), "error");
    setChipState(chipGps, "GPS: denegado", "err");
    setRetryGeoVisible(true);
    setBusy(false, tipo);
    return;
  }

  let pos;
  try {
    pos = await getBestEffortPosition();
  } catch (err) {
    mostrarStatus("❌ " + getGeoErrorMessage(err, permissionState), "error");
    setChipState(chipGps, "GPS: error", "err");
    setRetryGeoVisible(true);
    setBusy(false, tipo);
    return;
  }
  setChipState(chipGps, `GPS: ${Math.round(pos.coords.accuracy)}m`, pos.coords.accuracy <= 80 ? "ok" : "warn");

  const payload = {
    token: APP_TOKEN,
    appVersion: APP_VERSION,
    timestamp: new Date().toISOString(),
    tipo,
    legajo: data.legajo,
    jerarquia: data.jerarquia,
    apellidoNombre: data.apellidoNombre,
    dni: data.dni,
    lat: pos.coords.latitude,
    lon: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    userAgent: navigator.userAgent,
    novedades: sanitizeText(novedades || "", 500)
  };

  if (!navigator.onLine) {
    queuePayload(payload);
    mostrarStatus("📴 Sin conexion. Registro en cola para envio.", "warning");
    setBusy(false, tipo);
    return;
  }

  mostrarStatus("📤 Enviando...", "warning");
  try {
    const r = await sendWithRetry(payload, 2);
    if (r && r.status === "ok") {
      if (r.duplicate) {
        mostrarStatus("ℹ️ Registro duplicado detectado y omitido.", "warning");
        hideReceipt();
      } else {
        mostrarStatus(
          tipo === "INICIO" ? "✅ Registro de INICIO guardado." : "🛑 Registro de FIN guardado.",
          tipo === "INICIO" ? "okInicio" : "okFin"
        );
        showReceipt({
          comprobanteId: r.comprobanteId || "SIN-ID",
          serverTime: r.serverTime || new Date().toISOString(),
          tipo: payload.tipo,
          legajo: payload.legajo,
          jerarquia: payload.jerarquia,
          apellidoNombre: payload.apellidoNombre,
          dni: payload.dni,
          lat: payload.lat,
          lon: payload.lon,
          accuracy: payload.accuracy,
          novedades: payload.novedades || ""
        });
      }

      if (r.mailError) {
        updateSyncInfo("Registro guardado. Aviso: fallo de mail al administrador.");
      } else {
        updateSyncInfo();
      }

      if (tipo === "FIN") {
        novedadesSection.style.display = "none";
        novedadesInput.value = DEFAULT_NOVEDADES;
      }
      lastGeoAttempt = null;
      setRetryGeoVisible(false);
    } else {
      const backendMsg = r && r.message ? r.message : JSON.stringify(r);
      mostrarStatus("⚠️ " + backendMsg, "warning");
      hideReceipt();
      updateSyncInfo();
    }
  } catch (err) {
    queuePayload(payload);
    mostrarStatus("📴 Error de red. Registro guardado en cola.", "warning");
    hideReceipt();
  } finally {
    setBusy(false, tipo);
  }
}

function initInputFilters() {
  const legajo = document.getElementById("legajo");
  const dni = document.getElementById("dni");
  const jerarquia = document.getElementById("jerarquia");
  const apellidoNombre = document.getElementById("apellidoNombre");

  legajo.addEventListener("input", () => {
    legajo.value = sanitizeDigits(legajo.value, 10);
  });
  dni.addEventListener("input", () => {
    dni.value = sanitizeDigits(dni.value, 10);
  });
  jerarquia.addEventListener("change", () => {
    jerarquia.value = sanitizeText(jerarquia.value, 50);
  });
  apellidoNombre.addEventListener("input", () => {
    apellidoNombre.value = sanitizeText(apellidoNombre.value, 80);
  });
}

function initRememberData() {
  rememberData.checked = getRememberPreference();
  rememberData.addEventListener("change", () => {
    saveRememberPreference(rememberData.checked);
    if (!rememberData.checked) {
      clearSavedData();
      updateSyncInfo("Modo privacidad activo: no se guardan datos locales.");
    } else {
      const data = getFormData();
      saveFormData(data);
      updateSyncInfo();
    }
  });
}

function initEvents() {
  logo.addEventListener("click", () => {
    logo.classList.add("active");
    setTimeout(() => logo.classList.remove("active"), 600);
  });

  logo.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      logo.click();
    }
  });

  btnInicio.addEventListener("click", () => registrar("INICIO"));

  btnFin.addEventListener("click", () => {
    novedadesSection.style.display = "block";
    novedadesInput.value = DEFAULT_NOVEDADES;
    novedadesInput.focus();
    btnInicio.disabled = true;
    btnFin.disabled = true;
    btnFinConfirm.disabled = false;
  });

  btnFinConfirm.addEventListener("click", () => {
    const nov = sanitizeText(novedadesInput.value, 500);
    if (!nov) {
      mostrarStatus("⚠️ Debe escribir novedades.", "warning");
      return;
    }
    registrar("FIN", nov);
  });

  btnVolver.addEventListener("click", () => {
    novedadesSection.style.display = "none";
    novedadesInput.value = DEFAULT_NOVEDADES;
    btnInicio.disabled = false;
    btnFin.disabled = false;
    btnFinConfirm.disabled = false;
    setRetryGeoVisible(false);
    lastGeoAttempt = null;
    mostrarStatus("❌ Accion cancelada.", "warning");
  });

  if (btnRetryGeo) {
    btnRetryGeo.addEventListener("click", () => {
      if (!lastGeoAttempt) {
        mostrarStatus("⚠️ No hay intento de geolocalizacion para reintentar.", "warning");
        setRetryGeoVisible(false);
        return;
      }
      mostrarStatus("🔁 Reintentando ubicacion...", "warning");
      registrar(lastGeoAttempt.tipo, lastGeoAttempt.novedades);
    });
  }

  if (btnDownloadReceipt) {
    btnDownloadReceipt.addEventListener("click", downloadReceipt);
  }

  if (btnCopyReceiptId) {
    btnCopyReceiptId.addEventListener("click", copyReceiptId);
  }

  window.addEventListener("online", () => {
    updateSyncInfo("Conexion recuperada. Sincronizando pendientes...");
    flushPendingQueue();
  });
  window.addEventListener("offline", () => updateSyncInfo());
}

function updateClock() {
  if (!clockDay || !clockTime) return;
  const now = new Date();
  const dias = ["DOMINGO", "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"];
  const dayName = dias[now.getDay()];
  const datePart = now.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  const timePart = now.toLocaleTimeString("es-AR", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  clockDay.textContent = `${dayName} ${datePart}`;
  clockTime.textContent = timePart;
}

function initClock() {
  updateClock();
  setInterval(updateClock, 1000);
}

window.addEventListener("load", async () => {
  hideReceipt();
  setRetryGeoVisible(false);
  setChipState(chipGps, "GPS: pendiente", "neutral");
  setChipState(chipNet, navigator.onLine ? "Red: online" : "Red: offline", navigator.onLine ? "ok" : "err");
  setChipState(chipQueue, `Cola: ${getPendingQueue().length}`, getPendingQueue().length > 0 ? "warn" : "neutral");
  initClock();
  initRememberData();
  initInputFilters();
  initEvents();
  loadSavedData();
  updateSyncInfo();
  await flushPendingQueue();
});
