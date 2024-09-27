import * as auth from '../../index.js';

const loginPrefix = '/login';

class JsonKvStore extends auth.KvStore {
  constructor(path) {
    super();
    this._path = path;

    this._readyPromise = new Promise(async (resolve, reject) => {
      const text = await Deno.readTextFile(path);
      this._obj = JSON.parse(text);
      resolve();
    });
  }

  get ready() {
    return this._readyPromise;
  }

  async persist() {
    Deno.writeTextFile(this._path, JSON.stringify(this._obj, null, 2));
  }
}

async function createKvStore(path) {
  const kvStore = new JsonKvStore(path);
  await kvStore.ready;
  return kvStore;
}

function html(session) {

  let content;
  if (session) {
    content = `<h1>Hi there ${session.userId}</h1>\n<a href='${loginPrefix}/logout'>Logout</a>`;
  }
  else {
    content = `<h1>Hi there</h1>\n<a href='${loginPrefix}'>Login</a>`;
  }

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1" />

        <style>
          body {
            font-family: Arial;
            font-size: 1.2em;
            display: flex;
            justify-content: center;
          }

          .content {
            width: 640px;
          }
        </style>
      </head>
      <body>
        <main class='content'>
          ${content}
        </main>
      </body>
    </html>
  `;
}

const kvStore = await createKvStore('./store.json');
//const kvStore = new auth.KvStore();

//kvStore.delete('sessions/');
//kvStore.delete('oauth_state/');

const handler = auth.createHandler(kvStore, {
  prefix: loginPrefix, 
});

const handler = async (req) => {
  const url = new URL(req.url);

  const remoteAddr = req.headers.get('X-Forwarded-For');

  const ts = new Date().toISOString();
  console.log(`${ts}\t${req.method}\t${remoteAddr}\t${url.host}\t${url.pathname}`);

  if (url.pathname.startsWith(loginPrefix)) {
    return handler(req);
  }

  const session = await auth.getSession(req, kvStore);

  if (session) {
    return new Response(html(session),{
      headers: {
        'Content-Type': 'text/html',
      },
    });
  }
  else {
    return new Response(html(session),{
      headers: {
        'Content-Type': 'text/html',
      },
    });
  }
};

Deno.serve({ port: 3000}, handler);
//Bun.serve({
//  port: 3000,
//  fetch: handler,
//});
