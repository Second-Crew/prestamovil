/**
 * Prestamóvil — Calculadora con API Libro Azul (Guía EBC)
 *
 * Flujo de selección:
 *   Tipo → Año → Marca → Modelo → Versión (solo autos) → [Calcular] → Precio
 *
 * Todas las llamadas van al proxy /api/libroazul (Vercel serverless).
 * Las credenciales del Libro Azul NUNCA llegan al navegador.
 *
 * ─── CONFIGURACIÓN IMPORTANTE ────────────────────────────────────────────────
 * Si este HTML se sirve desde Framer (u otro dominio distinto al proxy),
 * cambia API_BASE por la URL completa de tu proyecto Vercel, por ejemplo:
 *   var API_BASE = 'https://prestamovil.vercel.app/api/libroazul';
 *
 * Si el HTML está en el mismo proyecto Vercel que el proxy:
 *   var API_BASE = '/api/libroazul';   ← ya está configurado así
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  // ── URL del proxy ─────────────────────────────────────────────────────────
  var API_BASE = '/api/libroazul';

  // ── Porcentaje de préstamo (se sobreescribe con el valor del servidor) ─────
  // Para cambiarlo: Vercel → Settings → Environment Variables → LOAN_PERCENTAGE
  var LOAN_PCT = 0.70;

  // ── Clase Libro Azul por tipo de vehículo ──────────────────────────────────
  // 0 = autos/camionetas usados  |  2 = motos usadas  |  null = sin API (maquinaria)
  var CLASE_POR_TIPO = {
    auto:        '0',
    camioneta:   '0',
    motocicleta: '2',
    maquinaria:  null,
  };

  // ── Referencias al DOM ────────────────────────────────────────────────────
  var selType      = document.getElementById('calc-type');
  var selYear      = document.getElementById('calc-year');
  var selBrand     = document.getElementById('calc-brand');
  var selModel     = document.getElementById('calc-model');
  var selVersion   = document.getElementById('calc-version');
  var grpVersion   = document.getElementById('version-group');
  var maqMsg       = document.getElementById('calc-maquinaria-msg');
  var btnCalc      = document.getElementById('calc-btn');
  var resultBox    = document.querySelector('.calculator__result');
  var resultAmt    = document.querySelector('.calculator__result-amount');
  var resultDet    = document.querySelector('.calculator__result-detail');
  var resultCta    = document.querySelector('.calculator__result-cta');

  if (!selType) return; // La calculadora no está en esta página

  // ── Carga el porcentaje de préstamo desde el servidor al iniciar ───────────
  apiFetch({ action: 'config' })
    .then(function (data) {
      if (data && data.loanPercentage) LOAN_PCT = data.loanPercentage;
    })
    .catch(function () { /* usa el default 0.70 si falla */ });

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /** Formatea un número como moneda MXN */
  function fmt(n) {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency', currency: 'MXN',
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(n);
  }

  /** Vacía un <select> y lo deshabilita */
  function resetSel(sel, placeholder) {
    sel.innerHTML = '<option value="">' + placeholder + '</option>';
    sel.disabled  = true;
  }

  /** Pone un mensaje de carga en un <select> */
  function loadingSel(sel, txt) {
    sel.innerHTML = '<option>' + (txt || 'Cargando...') + '</option>';
    sel.disabled  = true;
  }

  /** Oculta el bloque de resultado */
  function hideResult() {
    if (resultBox) resultBox.classList.remove('visible');
  }

  /** Muestra un error en el bloque de resultado */
  function showApiError(msg) {
    resultAmt.textContent = '⚠️ ' + msg;
    resultDet.textContent = 'Por favor intenta de nuevo o contáctanos por WhatsApp.';
    resultCta.href        = 'https://wa.me/526681234567';
    resultBox.classList.add('visible');
  }

  /** Hace fetch al proxy y devuelve la respuesta como JSON */
  function apiFetch(params) {
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return fetch(API_BASE + '?' + qs).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /** Llena un <select> con un array [{ clave, nombre }] y lo habilita */
  function fillSel(sel, items, placeholder) {
    resetSel(sel, placeholder);
    items.forEach(function (item) {
      var o        = document.createElement('option');
      o.value      = item.clave;
      o.textContent = item.nombre;
      sel.appendChild(o);
    });
    sel.disabled = false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cascada de selects
  // ─────────────────────────────────────────────────────────────────────────

  // 1 ── Tipo de vehículo seleccionado → cargar Años
  selType.addEventListener('change', function () {
    hideResult();
    resetSel(selYear,    'Selecciona año');
    resetSel(selBrand,   'Selecciona marca');
    resetSel(selModel,   'Selecciona modelo');
    resetSel(selVersion, 'Selecciona versión');
    grpVersion.style.display = 'none';
    maqMsg.style.display     = 'none';

    var tipo  = this.value;
    var clase = CLASE_POR_TIPO[tipo];

    if (!tipo) return;

    // Maquinaria pesada — sin API, mostrar mensaje de contacto
    if (clase === null) {
      maqMsg.style.display = 'block';
      return;
    }

    loadingSel(selYear, 'Cargando años...');
    apiFetch({ action: 'years', clase: clase })
      .then(function (items) { fillSel(selYear, items, 'Selecciona año'); })
      .catch(function ()     { resetSel(selYear, '⚠️ Error — intenta de nuevo'); });
  });

  // 2 ── Año seleccionado → cargar Marcas
  selYear.addEventListener('change', function () {
    hideResult();
    resetSel(selBrand,   'Selecciona marca');
    resetSel(selModel,   'Selecciona modelo');
    resetSel(selVersion, 'Selecciona versión');
    grpVersion.style.display = 'none';
    if (!this.value) return;

    var clase = CLASE_POR_TIPO[selType.value];
    loadingSel(selBrand, 'Cargando marcas...');
    apiFetch({ action: 'brands', clase: clase, year: this.value })
      .then(function (items) { fillSel(selBrand, items, 'Selecciona marca'); })
      .catch(function ()     { resetSel(selBrand, '⚠️ Error — intenta de nuevo'); });
  });

  // 3 ── Marca seleccionada → cargar Modelos
  selBrand.addEventListener('change', function () {
    hideResult();
    resetSel(selModel,   'Selecciona modelo');
    resetSel(selVersion, 'Selecciona versión');
    grpVersion.style.display = 'none';
    if (!this.value) return;

    var clase = CLASE_POR_TIPO[selType.value];
    loadingSel(selModel, 'Cargando modelos...');
    apiFetch({ action: 'models', clase: clase, year: selYear.value, brand: this.value })
      .then(function (items) { fillSel(selModel, items, 'Selecciona modelo'); })
      .catch(function ()     { resetSel(selModel, '⚠️ Error — intenta de nuevo'); });
  });

  // 4 ── Modelo seleccionado → cargar Versiones (solo autos; motos van directo a precio)
  selModel.addEventListener('change', function () {
    hideResult();
    resetSel(selVersion, 'Selecciona versión');
    grpVersion.style.display = 'none';
    if (!this.value) return;

    var tipo = selType.value;

    // Motocicletas no tienen versiones en Libro Azul — el modelo es suficiente
    if (tipo === 'motocicleta') return;

    var clase = CLASE_POR_TIPO[tipo];
    grpVersion.style.display = 'block';
    loadingSel(selVersion, 'Cargando versiones...');

    apiFetch({
      action: 'versions', clase: clase,
      year: selYear.value, brand: selBrand.value, model: this.value,
    })
      .then(function (items) { fillSel(selVersion, items, 'Selecciona versión'); })
      .catch(function () {
        grpVersion.style.display = 'none';
        resetSel(selVersion, '⚠️ Error — intenta de nuevo');
      });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Botón Calcular → consultar precio y mostrar resultado
  // ─────────────────────────────────────────────────────────────────────────

  btnCalc.addEventListener('click', function () {
    var tipo     = selType.value;
    var isMoto   = tipo === 'motocicleta';
    var needVer  = !isMoto && grpVersion.style.display !== 'none';

    // Validar que todos los campos necesarios estén llenos
    var falta = !tipo || !selYear.value || !selBrand.value || !selModel.value
             || (needVer && !selVersion.value);

    if (falta) {
      btnCalc.classList.add('shake');
      setTimeout(function () { btnCalc.classList.remove('shake'); }, 500);
      return;
    }

    // Estado de carga en el botón
    var textoOriginal = btnCalc.textContent;
    btnCalc.textContent = 'Consultando Libro Azul...';
    btnCalc.disabled    = true;

    var params = isMoto
      ? { action: 'price-moto', model:   selModel.value }
      : { action: 'price',      clase: '0', version: selVersion.value };

    apiFetch(params)
      .then(function (data) {
        // "venta" es el precio de mercado (valor Libro Azul al 100%)
        var valorMercado = data.venta || 0;

        if (valorMercado <= 0) {
          showApiError('No se encontró precio para este vehículo.');
          return;
        }

        var montoPrestamo = Math.round(valorMercado * LOAN_PCT);
        var pctTexto      = Math.round(LOAN_PCT * 100) + '%';

        // Nombres legibles para el mensaje de WhatsApp
        var marcaNombre   = selBrand.options[selBrand.selectedIndex].text;
        var modeloNombre  = selModel.options[selModel.selectedIndex].text;
        var versionNombre = (!isMoto && selVersion.value)
          ? selVersion.options[selVersion.selectedIndex].text : '';
        var vehiculo = [selYear.value, marcaNombre, modeloNombre, versionNombre]
          .filter(Boolean).join(' ');

        // ── Mostrar resultado ───────────────────────────────────────────────
        resultAmt.textContent = fmt(montoPrestamo);
        resultDet.innerHTML   =
          'Valor de mercado <strong>(Libro Azul)</strong>: ' + fmt(valorMercado) + '<br>' +
          'Préstamo estimado <strong>(' + pctTexto + ' del valor)</strong>: ' + fmt(montoPrestamo);

        // Mensaje preescrito para WhatsApp
        var waMsg = encodeURIComponent(
          '¡Hola Prestamóvil! Me interesa empeñar mi ' + vehiculo + '. ' +
          'La calculadora indica un valor Libro Azul de ' + fmt(valorMercado) + '. ' +
          '¿Podemos agendar una valuación?'
        );
        resultCta.href = 'https://wa.me/526681234567?text=' + waMsg;
        resultBox.classList.add('visible');
        resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      })
      .catch(function (err) {
        console.error('[calc-precio]', err);
        showApiError('No se pudo obtener el precio. Intenta de nuevo.');
      })
      .then(function () {
        // Siempre restaurar el botón (equivalente a finally)
        btnCalc.textContent = textoOriginal;
        btnCalc.disabled    = false;
      });
  });

})();
