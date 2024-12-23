import { createNodeHandler, callPluginFunction, createWasmHandler } from './wasm.js';
import { JsonKvStore, SqliteKvStore } from './kv.js';

const LOGIN_METHOD_ATPROTO = 'ATProto';
const LOGIN_METHOD_FEDIVERSE = 'Fediverse';
const LOGIN_METHOD_ADMIN_CODE = 'Admin Code';
const LOGIN_METHOD_OIDC = 'OIDC';

class Server {

  #kvStore;
  #storagePrefix = 'decent_auth';
  #config = null;
  #port = 3000;

  constructor(opt) {
    this.#config = opt?.config;
    this.#port = opt?.port;
    this.#kvStore = opt?.kvStore;

    if (!this.#kvStore) {
      this.#kvStore = new SqliteKvStore({
        path: './decentauth.sqlite',
      });
    }
  }

  async getSession(req) {
    const sessionKey = getCookie(req, `${this.#storagePrefix}_session_key`);
    const key = `/${this.#storagePrefix}/sessions/${sessionKey}`;
    return await this.#kvStore.get(key)
  }

  async serve(handler) {

    await this.#kvStore.ready;

    const http = await import('node:http');

    const authHandler = createHandler(this.#kvStore, {
      prefix: this.#config.path_prefix,
    });

    const wasmHandler = await createWasmHandler(this.#config, this.#kvStore);

    const internalHandler = async (req) => {
      const url = new URL(req.url);
      if (url.pathname.startsWith(this.#config.path_prefix)) {
        //return authHandler(req);
        return wasmHandler(req);
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

function createHandler(kvStore, opt) {

  let pathPrefix = opt?.prefix;

  async function handler(req) {

    const url = new URL(req.url);

    const pathname = url.pathname.slice(pathPrefix.length);
    const path = pathname ? pathname : '/';

    return new Response("Not found", { status: 404 });
  }

  return handler;
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
  LOGIN_METHOD_ADMIN_CODE,
  LOGIN_METHOD_OIDC,
  Server,
  createHandler,
  getSession,
  JsonKvStore,
  SqliteKvStore,
};
