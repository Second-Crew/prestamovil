/**
 * api/libroazul.js — Proxy seguro para Libro Azul (Guía EBC)
 *
 * Estrategia de endpoints (descubierta en diagnóstico):
 *  REST  https://api.libroazul.com   → sesión, años, marcas, modelos, precio
 *  SOAP  https://www.libroazul.com/ws/wslibroazul.asmx → versiones, precio moto
 *        (el endpoint REST /Versiones/ devuelve error 500 en la API de Libro Azul)
 *
 * Credenciales guardadas SOLO en variables de entorno de Vercel.
 */

'use strict';

const LB_REST = 'https://api.libroazul.com';
const LB_SOAP = 'https://www.libroazul.com/ws/wslibroazul.asmx';
const LB_NS   = 'http://www.libroazul.com/ws/';

// ─── Token cache (Fluid Compute reutiliza instancias) ─────────────────────────
let _llave   = null;
let _llaveTs = 0;
const TTL_MS = 90 * 60 * 1000; // 90 min (la Llave dura 2 h de inactividad)

// ─── REST helper ──────────────────────────────────────────────────────────────

async function restPost(path, params) {
  const qs  = new URLSearchParams(params).toString();
  const url = LB_REST + path + '?' + qs;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Length': '0' } });
  if (!res.ok) throw new Error('LB REST ' + res.status + ' ' + path);
  return res.text();
}

// ─── SOAP helper ─────────────────────────────────────────────────────────────

async function soapPost(action, bodyInner) {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    ${bodyInner}
  </soap:Body>
</soap:Envelope>`;

  const res = await fetch(LB_SOAP, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction':   '"' + LB_NS + action + '"',
    },
    body: envelope,
  });
  if (!res.ok) throw new Error('LB SOAP ' + res.status + ' ' + action);
  return res.text();
}

// ─── Autenticación con caché ──────────────────────────────────────────────────

async function getSesion() {
  const now = Date.now();
  if (_llave && (now - _llaveTs) < TTL_MS) return _llave;

  const raw = await restPost('/Api/Sesion/', {
    Usuario:    process.env.LIBROAZUL_USER,
    Contrasena: process.env.LIBROAZUL_PASS,
  });

  // La API devuelve un JSON string con comillas: "NzM0IzI3MT..."
  let llave;
  try   { llave = JSON.parse(raw); }
  catch { llave = raw.trim().replace(/^"|"$/g, ''); }

  if (!llave || typeof llave !== 'string' || llave.length < 4) {
    throw new Error('Sesión inválida — revisa LIBROAZUL_USER y LIBROAZUL_PASS en Vercel');
  }

  _llave   = llave;
  _llaveTs = now;
  return llave;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

/** Catálogo REST: [{ Clave, Nombre }] → [{ clave, nombre }] */
function parseCatalogosREST(raw) {
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error('Respuesta inesperada del catálogo');
  return list.map(function (item) {
    return {
      clave:  String(item.Clave  || item.clave  || ''),
      nombre: String(item.Nombre || item.nombre || item.Clave || ''),
    };
  });
}

/** Extrae el texto de la primera etiqueta XML que coincida */
function xmlTag(xml, name) {
  const m = xml.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>'));
  return m ? m[1].trim() : null;
}

/** Catálogo SOAP: <Catalogo><Clave>…</Clave><Nombre>…</Nombre></Catalogo> */
function parseCatalogosSOAP(xml) {
  const list = [];
  const re   = /<Catalogo[^>]*>([\s\S]*?)<\/Catalogo>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const clave  = xmlTag(m[1], 'Clave');
    const nombre = xmlTag(m[1], 'Nombre');
    if (clave) list.push({ clave, nombre: nombre || clave });
  }
  return list;
}

/**
 * Precio REST: {"Venta":"193900","Compra":"169000","Moneda":"MXN"}
 * Precio SOAP: <Venta>193900</Venta><Compra>169000</Compra><Moneda>MXN</Moneda>
 */
function parsePrecioREST(raw) {
  const d = JSON.parse(raw);
  return {
    // La API real usa "Venta"/"Compra" (no "Precio_Venta"/"Precio_Compra")
    venta:  parseFloat(d.Venta  || d.Precio_Venta  || d.venta  || '0') || 0,
    compra: parseFloat(d.Compra || d.Precio_Compra || d.compra || '0') || 0,
    moneda: String(d.Moneda || d.moneda || 'MXN'),
  };
}

function parsePrecioSOAP(xml) {
  return {
    venta:  parseFloat(xmlTag(xml, 'Venta')  || '0') || 0,
    compra: parseFloat(xmlTag(xml, 'Compra') || '0') || 0,
    moneda: xmlTag(xml, 'Moneda') || 'MXN',
  };
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ─── Handler principal ────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, clase = '0', year, brand, model, version } = req.query;

  if (action === 'config') {
    return res.json({ loanPercentage: parseFloat(process.env.LOAN_PERCENTAGE || '0.70') });
  }

  try {
    const llave = await getSesion();

    switch (action) {

      // ── Años (REST) ────────────────────────────────────────────────────────
      case 'years': {
        const raw = await restPost('/Api/A%C3%B1os/', { Llave: llave, Clase: clase, Edicion: '0' });
        return res.json(parseCatalogosREST(raw));
      }

      // ── Marcas (REST) ──────────────────────────────────────────────────────
      case 'brands': {
        if (!year) return res.status(400).json({ error: 'Falta: year' });
        const raw = await restPost('/Api/Marcas/', { Llave: llave, Clase: clase, ClaveAnio: year, Edicion: '0' });
        return res.json(parseCatalogosREST(raw));
      }

      // ── Modelos (REST) ─────────────────────────────────────────────────────
      case 'models': {
        if (!year || !brand) return res.status(400).json({ error: 'Faltan: year, brand' });
        const raw = await restPost('/Api/Modelos/', { Llave: llave, Clase: clase, ClaveAnio: year, ClaveMarca: brand, Edicion: '0' });
        return res.json(parseCatalogosREST(raw));
      }

      // ── Versiones (SOAP — el endpoint REST devuelve error 500) ─────────────
      case 'versions': {
        if (!year || !brand || !model) {
          return res.status(400).json({ error: 'Faltan: year, brand, model' });
        }
        const xml = await soapPost(
          'ObtenerVersionesPorAnioMarcaModelo',
          `<ObtenerVersionesPorAnioMarcaModelo xmlns="${LB_NS}">
            <Llave>${llave}</Llave>
            <Clase>${clase}</Clase>
            <ClaveAnio>${year}</ClaveAnio>
            <ClaveMarca>${brand}</ClaveMarca>
            <ClaveModelo>${model}</ClaveModelo>
            <Edicion>0</Edicion>
          </ObtenerVersionesPorAnioMarcaModelo>`
        );
        return res.json(parseCatalogosSOAP(xml));
      }

      // ── Precio auto (REST con ClaveVersion real) ───────────────────────────
      case 'price': {
        if (!version) return res.status(400).json({ error: 'Falta: version' });
        const raw = await restPost('/Api/Precio/', { Llave: llave, Clase: clase, ClaveVersion: version, Edicion: '0' });
        return res.json(parsePrecioREST(raw));
      }

      // ── Precio moto (SOAP — el endpoint REST /PrecioMoto/ no existe) ───────
      case 'price-moto': {
        if (!model) return res.status(400).json({ error: 'Falta: model' });
        const xml = await soapPost(
          'ObtenerPrecioMotoPorClave',
          `<ObtenerPrecioMotoPorClave xmlns="${LB_NS}">
            <Llave>${llave}</Llave>
            <Clase>2</Clase>
            <Clave>${model}</Clave>
            <Edicion>0</Edicion>
          </ObtenerPrecioMotoPorClave>`
        );
        return res.json(parsePrecioSOAP(xml));
      }

      default:
        return res.status(400).json({ error: 'Acción no reconocida: ' + action });
    }

  } catch (err) {
    console.error('[libroazul-proxy]', err.message);
    return res.status(502).json({ error: 'No se pudo conectar con el servicio de valuación. Intenta de nuevo.' });
  }
};
