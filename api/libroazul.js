/**
 * api/libroazul.js — Proxy seguro para la API REST del Libro Azul (Guía EBC)
 *
 * La API devuelve JSON (no XML):
 *  - Sesión:   "token_string"  (JSON string con comillas)
 *  - Catálogo: [{ Clave, Nombre }, ...]
 *  - Precio:   { Precio_Venta, Precio_Compra, Moneda }
 *
 * Credenciales guardadas SOLO en variables de entorno de Vercel.
 * El navegador NUNCA las ve.
 */

'use strict';

const LB = 'https://api.libroazul.com';

// ─── Token cache (Fluid Compute reutiliza instancias) ─────────────────────────
// La Llave dura 2 h de inactividad; refrescamos cada 90 min.
let _llave   = null;
let _llaveTs = 0;
const TTL_MS = 90 * 60 * 1000;

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function lbPost(path, params) {
  const qs  = new URLSearchParams(params).toString();
  const url = LB + path + '?' + qs;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Length': '0' },
  });
  if (!res.ok) throw new Error('Libro Azul HTTP ' + res.status + ' → ' + path);
  return res.text(); // parseo manual abajo para manejar distintos formatos
}

// ─── Autenticación con caché ──────────────────────────────────────────────────

async function getSesion() {
  const now = Date.now();
  if (_llave && (now - _llaveTs) < TTL_MS) return _llave; // token vigente

  const raw = await lbPost('/Api/Sesion/', {
    Usuario:    process.env.LIBROAZUL_USER,
    Contrasena: process.env.LIBROAZUL_PASS,
  });

  // La API devuelve un JSON string con comillas: "NzM0IzI3MT..."
  // JSON.parse lo convierte en string limpio.
  let llave;
  try {
    llave = JSON.parse(raw); // quita las comillas externas
  } catch {
    llave = raw.trim().replace(/^"|"$/g, ''); // fallback: quitar comillas manualmente
  }

  if (!llave || typeof llave !== 'string' || llave.length < 4) {
    throw new Error('Sesión inválida — revisa LIBROAZUL_USER y LIBROAZUL_PASS en Vercel');
  }

  _llave   = llave;
  _llaveTs = now;
  return llave;
}

// ─── Parsers JSON ─────────────────────────────────────────────────────────────

/**
 * Catálogo: [{ Clave, Nombre }] → [{ clave, nombre }]
 * Normaliza a minúsculas para el front-end.
 */
function parseCatalogos(raw) {
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error('Respuesta inesperada del catálogo');
  return list.map(function (item) {
    return {
      clave:  String(item.Clave  || item.clave  || ''),
      nombre: String(item.Nombre || item.nombre || item.Clave || ''),
    };
  });
}

/**
 * Precio: { Precio_Venta, Precio_Compra, Moneda }
 * Devuelve { venta, compra, moneda }
 */
function parsePrecio(raw) {
  const data = JSON.parse(raw);
  return {
    venta:  parseFloat(data.Precio_Venta  || data.venta  || '0') || 0,
    compra: parseFloat(data.Precio_Compra || data.compra || '0') || 0,
    moneda: String(data.Moneda || data.moneda || 'MXN'),
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

  const {
    action,
    clase   = '0',
    year,
    brand,
    model,
    version,
  } = req.query;

  // ── Config: solo el porcentaje de préstamo, sin credenciales ─────────────
  if (action === 'config') {
    return res.json({
      loanPercentage: parseFloat(process.env.LOAN_PERCENTAGE || '0.70'),
    });
  }

  try {
    const llave = await getSesion();

    switch (action) {

      case 'years': {
        const raw = await lbPost('/Api/A%C3%B1os/', {
          Llave: llave, Clase: clase, Edicion: '0',
        });
        return res.json(parseCatalogos(raw));
      }

      case 'brands': {
        if (!year) return res.status(400).json({ error: 'Falta: year' });
        const raw = await lbPost('/Api/Marcas/', {
          Llave: llave, Clase: clase, ClaveAnio: year, Edicion: '0',
        });
        return res.json(parseCatalogos(raw));
      }

      case 'models': {
        if (!year || !brand) return res.status(400).json({ error: 'Faltan: year, brand' });
        const raw = await lbPost('/Api/Modelos/', {
          Llave: llave, Clase: clase, ClaveAnio: year, ClaveMarca: brand, Edicion: '0',
        });
        return res.json(parseCatalogos(raw));
      }

      case 'versions': {
        if (!year || !brand || !model) {
          return res.status(400).json({ error: 'Faltan: year, brand, model' });
        }
        const raw = await lbPost('/Api/Versiones/', {
          Llave: llave, Clase: clase, ClaveAnio: year,
          ClaveMarca: brand, ClaveModelo: model, Edicion: '0',
        });
        return res.json(parseCatalogos(raw));
      }

      case 'price': {
        if (!version) return res.status(400).json({ error: 'Falta: version' });
        const raw = await lbPost('/Api/Precio/', {
          Llave: llave, Clase: clase, ClaveVersion: version, Edicion: '0',
        });
        return res.json(parsePrecio(raw));
      }

      case 'price-moto': {
        if (!model) return res.status(400).json({ error: 'Falta: model' });
        const raw = await lbPost('/Api/PrecioMoto/', {
          Llave: llave, Clase: '2', Clave: model, Edicion: '0',
        });
        return res.json(parsePrecio(raw));
      }

      default:
        return res.status(400).json({ error: 'Acción no reconocida: ' + action });
    }

  } catch (err) {
    console.error('[libroazul-proxy]', err.message);
    return res.status(502).json({
      error: 'No se pudo conectar con el servicio de valuación. Intenta de nuevo.',
    });
  }
};
