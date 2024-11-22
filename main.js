import createPlugin from '@extism/extism';
import http from 'http';

const plugin = await createPlugin(
  //"http://localhost:8000/target/wasm32-unknown-unknown/debug/decent_auth_rs.wasm",
  //"http://localhost:8000/target/wasm32-wasip1/debug/decent_auth_rs.wasm",
  //"../decent-auth-rs/target/wasm32-unknown-unknown/debug/decent_auth_rs.wasm",
  "../decent-auth-rs/target/wasm32-wasip1/debug/decent_auth_rs.wasm",
  {
    runInWorker: true,
    allowedHosts: ['*'],
    logLevel: 'debug',
    logger: console,
    useWasi: true,
    allowHttpResponseHeaders: true,
  },
);

async function handler(req) {

  const headers = {};

  // TODO: handle headers with multiple values
  for (const key of req.headers.keys()) {
    if (!headers[key]) {
      headers[key] = [];
    }
    headers[key].push(req.headers.get(key));
  }

  const encReq = {
    url: req.url,
    method: req.method,
    headers,
  };

  const out = await plugin.call("handle", JSON.stringify(encReq));
  const pluginRes = out.json();

  return new Response(pluginRes.body, {
    status: pluginRes.code,
    headers: pluginRes.headers,
  });
}

async function nodeHandler(nodeReq, nodeRes) {

  const headers = {};
  for (const key in nodeReq.headers) {
    if (!headers[key]) {
      headers[key] = [];
    }
    headers[key].push(nodeReq.headers[key]);
  }

  const req = new Request(`http://${process.env.HOST ?? 'localhost'}${nodeReq.url}`, {
    method: nodeReq.method,
    headers: nodeReq.headers,
  });

  const res = await handler(req);

  console.log(res);
  nodeRes.setHeaders(res.headers);
  nodeRes.writeHead(res.status);

  for await (const chunk of res.body) {
    nodeRes.write(chunk);
  }

  nodeRes.end();
}

http.createServer(nodeHandler).listen(3000);
