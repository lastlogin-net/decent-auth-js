import fs from 'node:fs/promises';
import * as libsql from '@libsql/client';
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

  #client
  #tableName
  #readyPromise

  constructor(opt) {
    this.#client = libsql.createClient({
      url: `file:${opt.path}`,
    });

    this.#tableName = 'kv';
    const tn = this.#tableName;

    this.#readyPromise = new Promise(async (resolve, reject) => {

      await this.#client.batch([
        `CREATE TABLE IF NOT EXISTS ${tn}(key TEXT NOT NULL PRIMARY KEY, value BLOB NOT NULL)`,
      ]);

      resolve();
    });
  }

  get ready() {
    return this.#readyPromise; 
  }

  async get(key) {
    const results = await this.#client.execute({
      sql: `SELECT value FROM ${this.#tableName} WHERE key = ?`,
      args: [key],
    });

    const buf = results.rows.length > 0 ? results.rows[0].value : [];
    const value = new Uint8Array(buf);
    return value;
  }

  async set(key, value) {
    const results = await this.#client.execute({
      sql: `INSERT OR REPLACE INTO ${this.#tableName}(key, value) VALUES(?, ?)`,
      args: [key, value],
    });
  }

  async list(prefix) {
    const results = await this.#client.execute({
      sql: `SELECT key FROM ${this.#tableName} WHERE key GLOB ? || '*'`,
      args: [prefix],
    });

    if (results.rows.length < 1) {
      return [];
    }

    const keys = results.rows.map(r => r.key);
    return keys;
  }

  async delete(key) {
    const results = await this.#client.execute({
      sql: `DELETE from ${this.#tableName} WHERE key = ?`,
      args: [key],
    });
  }
}

export {
  JsonKvStore,
  SqliteKvStore,
};
