import fs from 'node:fs/promises';
import * as decentauth from '../../index.js';
import { argv } from 'node:process';


const adminId = argv[2];
const port = argv[3] ? argv[3] : 3000;

const authPrefix = '/auth';

class JsonKvStore extends decentauth.KvStore {
  constructor(path) {
    super();
    this._path = path;

    this._readyPromise = new Promise(async (resolve, reject) => {
      let text;
      try {
        text = await fs.readFile(path, { encoding: 'utf-8' });
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

  async persist() {
    return fs.writeFile(this._path, JSON.stringify(this._obj, null, 2));
  }
}

async function createKvStore(path) {
  const kvStore = new JsonKvStore(path);
  await kvStore.ready;
  return kvStore;
}

function html(session, returnTarget) {

  let content;
  if (session) {
    content = `<h1>Hi there ${session.id}</h1>\n<a href='${authPrefix}/logout?return_target=${returnTarget}'>Logout</a>`;
  }
  else {
    content = `<h1>Hi there</h1>\n<a href='${authPrefix}?return_target=${returnTarget}'>Login</a>`;
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

const server = new decentauth.Server({
  port,
  kvStore,
  config: {
    admin_id: adminId,
    path_prefix: authPrefix,
    login_methods: [
      {
        name: "Admin Code",
        type: "admin-code",
      },
      {
        name: "ATProto",
        type: "atproto",
      },
      {
        name: "Fediverse",
        type: "fediverse",
      },
    ],
    oidc_providers: [
      {
        name: "LastLogin",
        uri: "https://lastlogin.net",
      }
    ],
  },
});

const handler = async (req, ctx) => {
  const url = new URL(req.url);

  const remoteAddr = req.headers.get('X-Forwarded-For');

  const ts = new Date().toISOString();
  console.log(`${ts}\t${req.method}\t${remoteAddr}\t${url.host}\t${url.pathname}`);

  const session = ctx.session;

  return new Response(html(session, url.pathname),{
    headers: {
      'Content-Type': 'text/html',
    },
  });

};

server.serve(handler);

//Deno.serve({ port: 3000}, handler);
//Bun.serve({
//  port: 3000,
//  fetch: handler,
//});
