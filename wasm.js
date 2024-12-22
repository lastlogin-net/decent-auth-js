import createPlugin from '@extism/extism';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const ERROR_CODE_NO_ERROR = 0;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

function encode(value) {
  return encoder.encode(JSON.stringify(value));
}

function decode(valueBytes) {
  return JSON.parse(decoder.decode(valueBytes));
}

const wasmBytes = await readFile("./decent_auth.wasm");
const module = await WebAssembly.compile(wasmBytes); 

async function createWasmPlugin(config, kvStore) {

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
            const value = await kvStore.get(key);
            const valueBytes = encode(value);
            const resultsArray = new Uint8Array(valueBytes.length + 1);
            resultsArray[0] = ERROR_CODE_NO_ERROR;
            resultsArray.set(valueBytes, 1);
            return currentPlugin.store(resultsArray);
          },
          async kv_write(currentPlugin, keyOffset, valueOffset) {
            const key = currentPlugin.read(keyOffset).text();
            const valueBytes = currentPlugin.read(valueOffset);
            const value = decode(valueBytes);
            await kvStore.set(key, value);
          },
          async kv_delete(currentPlugin, keyOffset, valueOffset) {
            const key = currentPlugin.read(keyOffset).text();
            await kvStore.delete(key);
          },
          async kv_list(currentPlugin, offset) {
            const prefix = currentPlugin.read(offset).text();
            const keys = await kvStore.list(prefix);
            const keysJsonBytes = encode(JSON.stringify(keys));
            const resultsArray = new Uint8Array(keysJsonBytes.length + 1);
            resultsArray[0] = ERROR_CODE_NO_ERROR;
            resultsArray.set(keysJsonBytes, 1);
            return currentPlugin.store(resultsArray);
          },
        }
      },
    },
  );

  return plugin;
}

async function callPluginFunction(funcName, config, kvStore, req) {
  const plugin = await createWasmPlugin(config, kvStore);
  const encReq = await encodePluginReq(req); 
  const out = await plugin.call(funcName, encReq);
  const pluginRes = out.json();
  await plugin.close();
  return pluginRes;
}

async function encodePluginReq(req) {

  const headers = {};

  // TODO: handle headers with multiple values
  for (const key of req.headers.keys()) {
    if (!headers[key]) {
      headers[key] = [];
    }
    headers[key].push(req.headers.get(key));
  }

  let body = '';

  if (req.method !== 'GET' && req.method !== 'HEAD') {
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
      const pluginRes = await callPluginFunction('extism_handle', config, kvStore, req);

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

function createNodeHandler(handler) {
  async function nodeHandler(nodeReq, nodeRes) {

    const headers = {};
    for (const key in nodeReq.headers) {
      if (!headers[key]) {
        headers[key] = [];
      }
      headers[key].push(nodeReq.headers[key]);
    }

    let body;
    if (nodeReq.method !== 'GET' && nodeReq.method !== 'HEAD') {
      // TODO: convert this into a readable stream
      let data = '';
      nodeReq.on('data', (chunk) => {
        data += chunk;
      });

      await new Promise((resolve, reject) => {
        nodeReq.on('end', () => {
          resolve();
        });
      });

      body = data;
    }

    const host = headers.host || process.env.HOST || 'localhost';

    const req = new Request(`http://${host}${nodeReq.url}`, {
      method: nodeReq.method,
      headers: nodeReq.headers,
      body,
    });

    const res = await handler(req);

    nodeRes.setHeaders(res.headers);
    nodeRes.writeHead(res.status);

    if (res.body) {
      for await (const chunk of res.body) {
        nodeRes.write(chunk);
      }
    }

    nodeRes.end();
  }
  return nodeHandler;
}

export {
  createNodeHandler,
  createWasmHandler,
  createWasmPlugin,
  callPluginFunction,
};
