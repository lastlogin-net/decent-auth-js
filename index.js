import { callPluginFunction, createWasmHandler } from './wasm.js';
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
  #wasmHandlerPromise;

  constructor(opt) {
    this.#config = opt?.config;
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
  JsonKvStore,
  SqliteKvStore,
};
