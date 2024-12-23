import fs from 'node:fs/promises';
import Database from 'libsql';
import { encode, decode } from './utils.js';

// TODO: JsonKvStore assumes that values can always be interpreted as JSON
class JsonKvStore {
  constructor(opt) {
    this._obj = {};

    this._path = opt.path;

    this._readyPromise = new Promise(async (resolve, reject) => {
      let text;
      try {
        text = await fs.readFile(this._path, { encoding: 'utf-8' });
      }
      catch (e) {
        console.log(e);
      }

      if (!text) {
        text = '{}';
      }

      this._obj = JSON.parse(text);
      this.persist();
      resolve();
    });
  }

  get ready() {
    return this._readyPromise;
  }

  get(key) {
    return this._obj[key] ? encode(this._obj[key]) : new Uint8Array();
  }

  async set(key, value) {
    this._obj[key] = decode(value);
    await this.persist();
  }

  list(prefix) {
    return Object.keys(this._obj).filter(k => k.startsWith(prefix));
  }

  delete(key) {
    delete this._obj[key];
    this.persist();
  }

  async persist() {
    return fs.writeFile(this._path, JSON.stringify(this._obj, null, 2));
  }
}

class SqliteKvStore {

  #db
  #tableName
  #readyPromise

  constructor(opt) {
    this.#db = new Database(`${opt.path}`);

    this.#tableName = 'kv';
    const tn = this.#tableName;

    this.#readyPromise = new Promise(async (resolve, reject) => {

      await this.#db.exec(
        `CREATE TABLE IF NOT EXISTS ${tn}(key TEXT NOT NULL PRIMARY KEY, value BLOB NOT NULL)`
      );

      resolve();
    });
  }

  get ready() {
    return this.#readyPromise; 
  }

  async get(key) {
    const result = await this.#db.prepare(`SELECT value FROM ${this.#tableName} WHERE key = ?`)
      .get(key);

    if (!result) {
      return new Uint8Array();
    }

    const value = new Uint8Array(result.value);
    return value;
  }

  async set(key, value) {
    const results = await this.#db.prepare(
      `INSERT OR REPLACE INTO ${this.#tableName}(key, value) VALUES(?, ?)`
    ).run([key, value]);
  }

  async list(prefix) {
    const rows = await this.#db.prepare(`SELECT key FROM ${this.#tableName} WHERE key GLOB ? || '*'`)
      .all(prefix);

    if (rows.length < 1) {
      return [];
    }

    const keys = rows.map(r => r.key);
    return keys;
  }

  async delete(key) {
    const results = await this.#db.prepare(`DELETE from ${this.#tableName} WHERE key = ?`)
      .run(key);
  }
}

export {
  JsonKvStore,
  SqliteKvStore,
};
