/**
 * api/libroazul.js — Proxy seguro para la API del Libro Azul (Guía EBC)
 *
 * Las credenciales (LIBROAZUL_USER, LIBROAZUL_PASS) viven SOLO en las
 * variables de entorno de Vercel. El navegador NUNCA las ve.
 *
 * Endpoints expuestos:
 *   GET /api/libroazul?action=config
 *   GET /api/libroazul?action=years&clase=0
 *   GET /api/libroazul?action=brands&clase=0&year={clave}
 *   GET /api/libroazul?action=models&clase=0&year={clave}&brand={clave}
 *   GET /api/libroazul?action=versions&clase=0&year={clave}&brand={clave}&model={clave}
 *   GET /api/libroazul?action=price&clase=0&version={clave}
 *   GET /api/libroazul?action=price-moto&model={clave}
 *
 * Clase: 0 = autos usados, 2 = motos usadas
 */

'use strict';

const LB = 'https://api.libroazul.com';

// ─── Token cache (Fluid Compute reutiliza instancias — ahorramos 1 llamada/req) ─
// La Llave del Libro Azul dura 2 h de inactividad; refrescamos cada 90 min.
let _llave    = null;
let _llaveTs  = 0;
const TTL_MS  = 90 * 60 * 1000; // 90 minutos en ms

// ─── XML helpers ──────────────────────────────────────────────────────────────

/** Extrae el texto de la primera etiqueta XML que coincida */
function xmlTag(xml, name) {
  const m = xml.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>'));
  return m ? m[1].trim() : null;
}

/**
 * Parsea un arreglo de <Catalogo><Clave>…</Clave><Nombre>…</Nombre></Catalogo>
 * Devuelve [{ clave, nombre }]
 */
function parseCatalogos(xml) {
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
 * Parsea el objeto <Precio>
 * Devuelve { venta, compra, moneda }
 */
function parsePrecio(xml) {
  return {
    venta:  parseFloat(xmlTag(xml, 'Precio_Venta')  || '0') || 0,
    compra: parseFloat(xmlTag(xml, 'Precio_Compra') || '0') || 0,
    moneda: xmlTag(xml, 'Moneda') || 'MXN',
  };
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

/**
 * Llama al Libro Azul via POST con los parámetros en el query string.
 * (La API acepta POST con params en URL, sin body.)
 */
async function lbPost(path, params) {
  const qs  = new URLSearchParams(params).toString();
  const url = LB + path + '?' + qs;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Length': '0' },
  });
  if (!res.ok) throw new Error('Libro Azul HTTP ' + res.status + ' en ' + path);
  return res.text();
}

// ─── Autenticación con caché ───────────────────────────────────────────────────

async function getSesion() {
  const now = Date.now();
  if (_llave && (now - _llaveTs) < TTL_MS) return _llave; // token vigente en memoria

  const xml   = await lbPost('/Api/Sesion/', {
    Usuario:    process.env.LIBROAZUL_USER,
    Contrasena: process.env.LIBROAZUL_PASS,
  });

  // La respuesta puede venir como texto plano o como <string>…</string>
  const llave = xmlTag(xml, 'string')
    || xmlTag(xml, 'IniciarSesionResult')
    || xml.replace(/<[^>]+>/g, '').trim();

  if (!llave || llave.length < 4) {
    throw new Error('Sesión inválida — revisa LIBROAZUL_USER y LIBROAZUL_PASS en Vercel');
  }

  _llave   = llave;
  _llaveTs = now;
  return llave;
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

function setCors(res) {
  // Permite llamadas desde cualquier origen (Framer, localhost, etc.)
  // Las credenciales de Libro Azul están en el servidor — exponer la URL es seguro.
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
    clase   = '0',   // 0 = autos usados, 2 = motos usadas
    year,
    brand,
    model,
    version,
  } = req.query;

  // ── /api/libroazul?action=config ─────────────────────────────────────────
  // Único endpoint que NO llama a Libro Azul. Solo expone el porcentaje de
  // préstamo al navegador — ninguna credencial sale del servidor.
  if (action === 'config') {
    return res.json({
      loanPercentage: parseFloat(process.env.LOAN_PERCENTAGE || '0.70'),
    });
  }

  // ── Todas las demás acciones requieren sesión ─────────────────────────────
  try {
    const llave = await getSesion();

    switch (action) {

      // Años disponibles para la clase indicada
      case 'years': {
        // Nota: "Años" tiene ñ → encoded como A%C3%B1os
        const xml = await lbPost('/Api/A%C3%B1os/', {
          Llave: llave, Clase: clase, Edicion: '0',
        });
        return res.json(parseCatalogos(xml));
      }

      // Marcas para un año
      case 'brands': {
        if (!year) return res.status(400).json({ error: 'Falta parámetro: year' });
        const xml = await lbPost('/Api/Marcas/', {
          Llave: llave, Clase: clase, ClaveAnio: year, Edicion: '0',
        });
        return res.json(parseCatalogos(xml));
      }

      // Modelos para año + marca
      case 'models': {
        if (!year || !brand) return res.status(400).json({ error: 'Faltan parámetros: year, brand' });
        const xml = await lbPost('/Api/Modelos/', {
          Llave: llave, Clase: clase, ClaveAnio: year, ClaveMarca: brand, Edicion: '0',
        });
        return res.json(parseCatalogos(xml));
      }

      // Versiones/trims para año + marca + modelo (solo autos, Clase 0)
      case 'versions': {
        if (!year || !brand || !model) {
          return res.status(400).json({ error: 'Faltan parámetros: year, brand, model' });
        }
        const xml = await lbPost('/Api/Versiones/', {
          Llave: llave, Clase: clase, ClaveAnio: year,
          ClaveMarca: brand, ClaveModelo: model, Edicion: '0',
        });
        return res.json(parseCatalogos(xml));
      }

      // Precio de una versión específica de auto
      // Devuelve { venta, compra, moneda }
      // "venta" = precio de mercado que mostraremos al usuario
      case 'price': {
        if (!version) return res.status(400).json({ error: 'Falta parámetro: version' });
        const xml = await lbPost('/Api/Precio/', {
          Llave: llave, Clase: clase, ClaveVersion: version, Edicion: '0',
        });
        return res.json(parsePrecio(xml));
      }

      // Precio de una moto (usa la Clave del modelo, no versión)
      case 'price-moto': {
        if (!model) return res.status(400).json({ error: 'Falta parámetro: model' });
        const xml = await lbPost('/Api/PrecioMoto/', {
          Llave: llave, Clase: '2', Clave: model, Edicion: '0',
        });
        return res.json(parsePrecio(xml));
      }

      default:
        return res.status(400).json({ error: 'Acción no reconocida: ' + action });
    }

  } catch (err) {
    console.error('[libroazul-proxy]', err.message);
    // No exponemos detalles internos al cliente — solo un mensaje genérico
    return res.status(502).json({
      error: 'No se pudo conectar con el servicio de valuación. Intenta de nuevo.',
    });
  }
};
