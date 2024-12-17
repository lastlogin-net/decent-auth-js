import { createNodeHandler, callPluginFunction, createWasmHandler } from './wasm.js';

class Server {

  #kvStore = null;
  #storagePrefix = 'decent_auth';
  #config = null;

  constructor(opt) {
    this.#config = opt?.config;
    this.#kvStore = opt?.kvStore;
  }

  async getSession(req) {
    const sessionKey = getCookie(req, `${this.#storagePrefix}_session_key`);
    const key = `/${this.#storagePrefix}/sessions/${sessionKey}`;
    return await this.#kvStore.get(key)
  }

  async serve(handler) {
    const http = await import('http');

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

    http.createServer(createNodeHandler(internalHandler)).listen(3000);
  }
}

class KvStore {
  constructor() {
    this._obj = {};
  }

  get(key) {
    return this._obj[key];
  }

  set(key, value) {
    this._obj[key] = value;
    this.persist();
  }

  delete(key) {
    delete this._obj[key];
    this.persist();
  }

  persist() {
    // noop
    console.log(this._obj);
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
  Server,
  createHandler,
  getSession,
  KvStore,
};
