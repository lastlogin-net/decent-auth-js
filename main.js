//import http from 'http';
//import Worker from 'web-worker';

const worker = new Worker(
  new URL('./worker.js', import.meta.url).href,
  {
    type: 'module',
  },
);

const callbacks = {};

async function handler(req) {
  console.log(req.url);

  const reqId = crypto.randomUUID();

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

  const promise = new Promise((resolve, reject) => {
    callbacks[reqId] = resolve;
  });

  worker.postMessage({
    type: 'request',
    id: reqId,
    req: JSON.stringify(encReq),
  });

  const res = await promise;

  return new Response(res.body, {
    status: res.code,
  });
}

worker.addEventListener('message', (e) => {
  const msg = e.data;

  if (msg.type === 'response') {
    callbacks[msg.id](msg.res);
  }
});

Deno.serve({ port: 3000 }, handler);

//http.createServer(handler).listen(3000);
