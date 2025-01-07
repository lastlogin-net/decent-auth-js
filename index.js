import { createNodeHandler, callPluginFunction, createWasmHandler } from './wasm.js';
import { JsonKvStore, SqliteKvStore } from './kv.js';

const LOGIN_METHOD_ATPROTO = 'ATProto';
const LOGIN_METHOD_FEDIVERSE = 'Fediverse';
const LOGIN_METHOD_QR_CODE = 'QR Code';
const LOGIN_METHOD_ADMIN_CODE = 'Admin Code';
const LOGIN_METHOD_OIDC = 'OIDC';
const LOGIN_METHOD_EMAIL = 'Email';
const LOGIN_METHOD_FEDCM = 'FedCM';

class Server {

  #kvStore;
  #storagePrefix = 'decent_auth';
  #config = null;
  #port = 3000;
  #wasmHandlerPromise;

  constructor(opt) {
    this.#config = opt?.config;
    this.#port = opt?.port;
    this.#kvStore = opt?.kvStore;

    if (!this.#kvStore) {
      this.#kvStore = new SqliteKvStore({
        path: './decentauth.sqlite',
      });
    }

    this.#wasmHandlerPromise = createWasmHandler(this.#config, this.#kvStore);
  }

  async getSession(req) {
    return callPluginFunction('extism_get_session', this.#config, this.#kvStore, req);
  }

  async handle(req) {
    const handler = await this.#wasmHandlerPromise;
    return handler(req);
  }

  async serve(handler) {

    await this.#kvStore.ready;

    const http = await import('node:http');

    const internalHandler = async (req) => {
      const url = new URL(req.url);
      if (url.pathname.startsWith(this.#config.path_prefix)) {
        return this.handle(req);
      }
      else {
        const session = await callPluginFunction('extism_get_session', this.#config, this.#kvStore, req);
        const ctx = {
          session,
        };
        return handler(req, ctx);
      }
    };

    http.createServer(createNodeHandler(internalHandler)).listen(this.#port);
  }
}

async function getSession(req, kvStore) {
  const sessionKey = getCookie(req, 'session_key');
  return await kvStore.get(`sessions/${sessionKey}`)
}

function getCookie(req, name) {

  const cookiesText = req.headers.get('cookie');

  if (!cookiesText) {
    return null;
  }

  const allCookiesParts = cookiesText.split(';');

  for (const cookie of allCookiesParts) {
    const cookieText = cookie.trim();
    const cookieParts = cookieText.split('=');

    if (cookieParts[0] === name) {
      return cookieParts.slice(1).join('=');
    }
  }
}

export {
  LOGIN_METHOD_ATPROTO,
  LOGIN_METHOD_FEDIVERSE,
  LOGIN_METHOD_QR_CODE,
  LOGIN_METHOD_ADMIN_CODE,
  LOGIN_METHOD_OIDC,
  LOGIN_METHOD_EMAIL,
  LOGIN_METHOD_FEDCM,
  Server,
  getSession,
  JsonKvStore,
  SqliteKvStore,
};
