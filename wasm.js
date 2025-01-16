import createPlugin from '@extism/extism';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { encode, decoder } from './utils.js';
import { Emailer } from './email.js';

const ERROR_CODE_NO_ERROR = 0;

const wasmBytes = await readFile(`${import.meta.dirname}/decentauth.wasm`);
const module = await WebAssembly.compile(wasmBytes); 

async function createWasmPlugin(config, kvStore) {

  let emailer;
  const smtp = config.smtp_config;

  if (smtp) {
    emailer = new Emailer({
      host: smtp.server_address,
      port: smtp.server_port,
      secure: false,
      auth: {
        user: smtp.username,
        pass: smtp.password,
      },
    });
  }

  const plugin = await createPlugin(
    module,
    {
      runInWorker: true,
      allowedHosts: ['*'],
      //logLevel: 'debug',
      logger: console,
      useWasi: true,
      enableWasiOutput: true,
      allowHttpResponseHeaders: true,
      config: {
        config: JSON.stringify(config),
      },
      functions: {
        "extism:host/user": {
          async kv_read(currentPlugin, offset) {
            const key = currentPlugin.read(offset).text();
            const valueBytes = await kvStore.get(key);
            const resultsArray = new Uint8Array(valueBytes.length + 1);
            resultsArray[0] = ERROR_CODE_NO_ERROR;
            resultsArray.set(valueBytes, 1);
            return currentPlugin.store(resultsArray);
          },
          async kv_write(currentPlugin, keyOffset, valueOffset) {
            const key = currentPlugin.read(keyOffset).text();
            const valueDataView = currentPlugin.read(valueOffset);
            await kvStore.set(key, new Uint8Array(valueDataView.buffer));
          },
          async kv_delete(currentPlugin, keyOffset, valueOffset) {
            const key = currentPlugin.read(keyOffset).text();
            await kvStore.delete(key);
          },
          async kv_list(currentPlugin, offset) {
            const prefix = currentPlugin.read(offset).text();
            const keys = await kvStore.list(prefix);
            const keysJsonBytes = encode(keys);
            const resultsArray = new Uint8Array(keysJsonBytes.length + 1);
            resultsArray[0] = ERROR_CODE_NO_ERROR;
            resultsArray.set(keysJsonBytes, 1);
            return currentPlugin.store(resultsArray);
          },
          async extism_send_email(currentPlugin, offset) {
            if (emailer) {
              const emailJson = currentPlugin.read(offset).text();
              const msg = JSON.parse(emailJson);
              // TODO: maybe should await, but we need to avoid timing attacks
              // and everything in the wasm plugin is synchronous
              emailer.sendEmail(msg);
            }
          },
        }
      },
    },
  );

  return plugin;
}

async function callPluginFunction(funcName, config, kvStore, req, consumeBody) {
  const plugin = await createWasmPlugin(config, kvStore);
  const encReq = await encodePluginReq(req, consumeBody); 
  const out = await plugin.call(funcName, encReq);
  const pluginRes = out.json();
  await plugin.close();
  return pluginRes;
}

async function encodePluginReq(req, consumeBody) {

  const headers = {};

  // TODO: handle headers with multiple values
  for (const key of req.headers.keys()) {
    if (!headers[key]) {
      headers[key] = [];
    }
    headers[key].push(req.headers.get(key));
  }

  let body = '';

  if (consumeBody && req.method !== 'GET' && req.method !== 'HEAD') {
    for await (const chunk of req.body) {
      body += decoder.decode(chunk);
    }
  }

  const pluginReq = {
    url: req.url,
    method: req.method,
    headers,
    // TODO: maybe use something other than JSON so we can send actual byte
    // arrays
    body,
  };

  const encReq = JSON.stringify(pluginReq);

  return encReq;
}


async function createWasmHandler(config, kvStore) {

  async function handler(req) { 
    
    try {
      const consumeBody = true;
      const pluginRes = await callPluginFunction('extism_handle', config, kvStore, req, consumeBody);

      return new Response(pluginRes.body, {
        status: pluginRes.code,
        headers: pluginRes.headers,
      });
    }
    catch(e) {
      console.error(e);
      return new Response("Error", {
        status: 500,
      });
    }
  }

  return handler;
}

export {
  createWasmHandler,
  createWasmPlugin,
  callPluginFunction,
};
