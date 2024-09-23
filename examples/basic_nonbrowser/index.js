import lastlogin from '../../index.js';

const loginPrefix = '/lastlogin';

class JsonKvStore extends lastlogin.KvStore {
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

const kvStore = await createKvStore('./store.json');

//kvStore.delete('sessions/');
//kvStore.delete('oauth_state/');

const lastloginHandler = lastlogin.createHandler(loginPrefix, kvStore);

const handler = (req) => {
  const url = new URL(req.url);

  if (url.pathname.startsWith(loginPrefix)) {
    return lastloginHandler(req);
  }

  const session = lastlogin.getSession(req, kvStore);

  if (session) {
    return new Response(`<h1>Hi there ${session.userId}</h1>\n<a href='${loginPrefix}/logout'>Logout</a>`,{
      headers: {
        'Content-Type': 'text/html',
      },
    });
  }
  else {
    return new Response(`<h1>Hi there</h1>\n<a href='${loginPrefix}'>Login</a>`,{
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
