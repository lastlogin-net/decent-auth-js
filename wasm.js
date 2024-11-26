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


async function createHandler(kvStore) {

  const wasmBytes = await readFile("../decent-auth-rs/target/wasm32-wasip1/release/decent_auth_rs.wasm");
  const module = await WebAssembly.compile(wasmBytes); 

  async function handler(req) {

    const plugin = await createPlugin(
      module,
      {
        runInWorker: true,
        allowedHosts: ['*'],
        logLevel: 'debug',
        logger: console,
        useWasi: true,
        allowHttpResponseHeaders: true,
        config: {
          path_prefix: '/auth',
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
          }
        },
      },
    );

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

    const out = await plugin.call("extism_handle", encReq);
    const pluginRes = out.json();

    return new Response(pluginRes.body, {
      status: pluginRes.code,
      headers: pluginRes.headers,
    });
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
  createHandler,
};
